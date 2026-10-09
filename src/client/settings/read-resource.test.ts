import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ReadResource, getReadResource, revokeDriveReadResources } from "./read-resource";
import { useReadResource } from "./use-read-resource";
import { NAVIGATION_FRESH_MS, observeNavigationSession, observeNavigationResponse } from "./navigation-events";
import { SettingsRequestError } from "./settings-request";

afterEach(() => vi.restoreAllMocks());
function deferred<T>() { let resolve!: (data: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
it("reuses only successful confirmations; expiry, manual refresh and failure never renew stale data", async () => {
  let now = 10_000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const resource = new ReadResource<string>();
  const load = vi.fn(async () => "confirmed");
  await resource.read(load, NAVIGATION_FRESH_MS);
  for (let i = 0; i < 10; i++) { now += 1000; await resource.read(load, NAVIGATION_FRESH_MS); }
  expect(load).toHaveBeenCalledTimes(1);
  resource.update("confirmed");
  now = 70_001;
  expect(resource.fresh(NAVIGATION_FRESH_MS)).toBe(false);
  const pending = deferred<string>();
  const refresh = vi.fn(() => pending.promise);
  const one = resource.read(refresh, NAVIGATION_FRESH_MS);
  expect(resource.read(refresh)).toBe(one);
  expect(resource.getSnapshot()).toMatchObject({ data: "confirmed", authority: "confirmed", request: "pending" });
  pending.resolve("updated"); await one;
  await resource.read(async () => { throw new Error("offline"); }).catch(() => {});
  expect(resource.fresh(NAVIGATION_FRESH_MS)).toBe(false);
  expect(resource.getSnapshot()).toMatchObject({ data: "updated", authority: "confirmed" });
  await resource.read(async () => { throw new SettingsRequestError(403); }).catch(() => {});
  expect(resource.getSnapshot()).toMatchObject({ data: null, authority: "revoked" });
});
it("shares reads across consumers, including when the initiating consumer leaves", async () => {
  const result = deferred<string>();
  let signal!: AbortSignal;
  const load = vi.fn((s: AbortSignal) => { signal = s; return result.promise; });
  const first = renderHook(() => useReadResource({ owner: "user", driveId: "drive", kind: "management" }, load, undefined, NAVIGATION_FRESH_MS));
  const second = renderHook(() => useReadResource({ owner: "user", driveId: "drive", kind: "management" }, load, undefined, NAVIGATION_FRESH_MS));
  await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
  first.unmount(); expect(signal.aborted).toBe(false);
  await act(async () => { result.resolve("name"); });
  expect(second.result.current.data).toBe("name");
  act(() => window.dispatchEvent(new Event("focus")));
  expect(load).toHaveBeenCalledTimes(1);
});
it("fences an old response on same-user session replacement and on a confirmed drive mutation", async () => {
  observeNavigationSession("user:session-one");
  const resource = getReadResource<string>({ owner: "user", driveId: "drive", kind: "management" });
  const old = deferred<string>();
  const read = resource.read(() => old.promise);
  await Promise.resolve();
  observeNavigationSession("user:session-two");
  old.resolve("old identity"); await read;
  expect(resource.getSnapshot().data).toBeNull();
  const current = getReadResource<string>({ owner: "user", driveId: "drive", kind: "management" });
  current.confirm("name");
  const beforeWrite = deferred<string>();
  const pending = current.read(() => beforeWrite.promise);
  await Promise.resolve();
  observeNavigationResponse("/api/choirs/drive/name", { method: "PATCH" }, Response.json({ revision: 1 }));
  current.confirm("new name"); beforeWrite.resolve("old name"); await pending;
  expect(current.getSnapshot().data).toBe("new name");
});

it("invalidates only mutation dependencies and fences capabilities after a denied write", async () => {
  const settings = getReadResource<string>({ owner: "member", driveId: "drive", kind: "settings" });
  const usage = getReadResource<string>({ owner: "member", driveId: "drive", kind: "usage" });
  const other = getReadResource<string>({ owner: "member", driveId: "other-drive", kind: "management" });
  settings.confirm("display name"); usage.confirm("old usage"); other.confirm("other drive");
  observeNavigationResponse("/api/choirs/drive/scores/score/restore", { method: "POST" }, Response.json({}));
  expect(settings.fresh(NAVIGATION_FRESH_MS)).toBe(true);
  expect(usage.fresh(NAVIGATION_FRESH_MS)).toBe(false);
  expect(other.fresh(NAVIGATION_FRESH_MS)).toBe(true);
  observeNavigationResponse("/api/choirs/drive/name", { method: "PATCH" }, new Response(null, { status: 403 }));
  expect(settings.getSnapshot().authority).toBe("unconfirmed");
  expect(other.getSnapshot().authority).toBe("confirmed");
});


it("keeps identity fields distinct for reuse, dependency matching and revocation", () => {
  const identity = { owner: "user:one", driveId: "drive", kind: "shared-layer", variant: "settings" } as const;
  const layer = getReadResource<string>(identity);
  expect(getReadResource({ ...identity })).toBe(layer);
  expect(getReadResource({ ...identity, variant: "other" })).not.toBe(layer);
  expect(getReadResource({ ...identity, owner: "user", driveId: "one:drive" })).not.toBe(layer);
  const other = getReadResource<string>({ owner: "drive", driveId: "elsewhere", kind: "settings" });
  layer.confirm("layer"); other.confirm("other");
  observeNavigationResponse("/api/choirs/drive/name", { method: "PATCH" }, Response.json({}));
  expect(layer.fresh(NAVIGATION_FRESH_MS)).toBe(true);
  revokeDriveReadResources("drive");
  expect(layer.getSnapshot()).toMatchObject({ data: null, authority: "revoked" });
  expect(other.getSnapshot()).toMatchObject({ data: "other", authority: "confirmed" });
});

it("pauses cloud authority without discarding the same owner's view or accepting late reads", async () => {
  observeNavigationSession("user:session", "user");
  const resource = getReadResource<string>({ owner: "user", driveId: "drive", kind: "management" });
  resource.confirm("saved view");
  const old = deferred<string>();
  const pending = resource.read(() => old.promise);
  await Promise.resolve();
  observeNavigationSession(null, "user", true);
  expect(resource.getSnapshot()).toMatchObject({ data: "saved view", authority: "unconfirmed", request: "idle" });
  old.resolve("obsolete response"); await pending;
  expect(resource.getSnapshot().data).toBe("saved view");
  observeNavigationSession("user:session", "user");
  expect(getReadResource({ owner: "user", driveId: "drive", kind: "management" })).toBe(resource);
  await resource.read(async () => "reconfirmed view");
  expect(resource.getSnapshot()).toMatchObject({ data: "reconfirmed view", authority: "confirmed" });
  observeNavigationSession(null);
});

it("keeps a mounted read view through suspension and rechecks before allowing writes", async () => {
  observeNavigationSession("user:session", "user");
  const resource = getReadResource<string>({ owner: "user", driveId: "drive", kind: "management" });
  resource.confirm("saved view");
  const next = deferred<string>();
  const load = vi.fn(() => next.promise);
  const view = renderHook(() => useReadResource({ owner: "user", driveId: "drive", kind: "management" }, load, undefined, NAVIGATION_FRESH_MS));
  act(() => observeNavigationSession(null, "user", true));
  expect(view.result.current.data).toBe("saved view");
  expect(view.result.current.canMutate).toBe(false);
  expect(load).not.toHaveBeenCalled();
  act(() => observeNavigationSession("user:session", "user"));
  await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
  expect(view.result.current.data).toBe("saved view");
  expect(view.result.current.canMutate).toBe(false);
  await act(async () => next.resolve("fresh view"));
  expect(view.result.current.canMutate).toBe(true);
  act(() => observeNavigationSession(null));
  expect(view.result.current.data).toBeNull();
});

it.each(["replacement", "other-owner", "signed-out"])("clears suspended display data for definitive %s", reason => {
  observeNavigationSession("user:session", "user");
  const resource = getReadResource<string>({ owner: "user", driveId: "drive", kind: "management" });
  resource.confirm("private view");
  observeNavigationSession(null, "user", true);
  observeNavigationSession(reason === "signed-out" ? null : reason === "replacement" ? "user:next-session" : "other:session", reason === "other-owner" ? "other" : "user");
  expect(resource.getSnapshot().data).toBeNull();
  observeNavigationSession(null);
});


it("accepts an outstanding local restore during same-owner suspension without restoring cloud authority", async () => {
  observeNavigationSession("user:session", "user");
  const local = deferred<string>();
  const view = renderHook(() => useReadResource({ owner: "user", driveId: "drive", kind: "reading-defaults" },
    () => new Promise<string>(() => {}), () => local.promise));
  act(() => observeNavigationSession(null, "user", true));
  await act(async () => local.resolve("local defaults"));
  expect(view.result.current.data).toBe("local defaults");
  expect(view.result.current.authority).toBe("unconfirmed");
  expect(view.result.current.canMutate).toBe(false);
  act(() => observeNavigationSession(null));
});

it("rejects late local restoration into a resource cleared for another identity", async () => {
  observeNavigationSession("user:session", "user");
  const key = { owner: "user", driveId: "drive", kind: "reading-defaults" } as const;
  const resource = getReadResource<string>(key);
  const local = deferred<string>();
  const view = renderHook(() => useReadResource(key, () => new Promise<string>(() => {}), () => local.promise));
  view.unmount();
  observeNavigationSession("other:session", "other");
  local.resolve("private defaults"); await local.promise;
  expect(resource.getSnapshot().data).toBeNull();
  observeNavigationSession(null);
});
