import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { localDatabase } from "../platform/local-database";
import * as workspace from "../platform/local-workspace";
import { loadMembershipDirectory, membershipSnapshotKey, reconcileMembershipRows, restoreMembershipDirectory } from "./membership-directory";
import { clearPrivateLocalDataAfterLogout } from "../auth/logout-local-data";

beforeEach(() => localDatabase.open());
afterEach(() => vi.unstubAllGlobals());

const memberships = [{ id: "member", displayName: "排练者", isOwner: true, choir: { id: "drive", name: "爱情", guestAdmissionMode: "invite" as const } }];

it("persists complete display membership and restores it without a schema change", async () => {
  await workspace.activateAuthenticatedLocalOwner("one");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ memberships })));
  await loadMembershipDirectory("one", new AbortController().signal);
  const key = membershipSnapshotKey("user:one");
  await vi.waitFor(async () => expect(await localDatabase.system.get(key)).toBeDefined());
  expect(await restoreMembershipDirectory("one")).toMatchObject([{ isOwner: true, choir: { name: "爱情" } }]);
  await workspace.activateAuthenticatedLocalOwner("other");
  await expect(restoreMembershipDirectory("one")).rejects.toThrow();
});

it("does not wait for blocked local storage before displaying an online membership result", async () => {
  const capture = vi.spyOn(workspace, "captureLocalWorkspaceSession").mockImplementation(() => new Promise(() => {}));
  const fetch = vi.fn().mockResolvedValue(Response.json({ memberships })); vi.stubGlobal("fetch", fetch);
  try {
    await expect(loadMembershipDirectory("one", new AbortController().signal)).resolves.toMatchObject([{ isOwner: true }]);
    expect(fetch).toHaveBeenCalledTimes(1);
  } finally { capture.mockRestore(); }
});

it("clears the persisted list after confirmed denial and on explicit logout", async () => {
  await workspace.activateAuthenticatedLocalOwner("one");
  const key = membershipSnapshotKey("user:one");
  await localDatabase.system.put({ key, value: JSON.stringify({ memberships }) });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 403 })));
  await expect(loadMembershipDirectory("one", new AbortController().signal)).rejects.toThrow();
  await vi.waitFor(async () => expect(await localDatabase.system.get(key)).toBeUndefined());
  await localDatabase.system.put({ key, value: JSON.stringify({ memberships }) });
  await clearPrivateLocalDataAfterLogout();
  expect(await localDatabase.system.get(key)).toBeUndefined();
});

it("does not restore old directories after a confirmed empty membership snapshot", async () => {
  await workspace.activateAuthenticatedLocalOwner("one");
  await localDatabase.system.put({ key: membershipSnapshotKey("user:one"), value: JSON.stringify({ memberships: [] }) });
  await localDatabase.driveDirectories.put({ key: "old", ownerKey: workspace.authenticatedLocalOwnerKey("one"), choirId: "old", choir: { id: "old", name: "旧盘", guestAdmissionMode: "invite" }, scores: [], membership: true });
  expect(await restoreMembershipDirectory("one")).toEqual([]);
});

it("does not resurrect a revoked drive from an older complete membership snapshot", async () => {
  await workspace.activateAuthenticatedLocalOwner("one");
  await localDatabase.system.put({ key: membershipSnapshotKey("user:one"), value: JSON.stringify({ memberships }) });
  await localDatabase.driveDirectories.put({ key: "revoked", ownerKey: workspace.authenticatedLocalOwnerKey("one"), choirId: "drive", choir: { id: "drive", name: "爱情", guestAdmissionMode: "invite" }, scores: [], membership: false, accessRevoked: true });
  expect(await restoreMembershipDirectory("one")).toEqual([]);
});

it("preserves confirmed revocation on first presentation and subsequent picker reopening", () => {
  const denied = { choir: memberships[0].choir, isOwner: true, unavailable: true };
  const first = reconcileMembershipRows([], [denied]);
  expect(first[0].unavailable).toBe(true);
  expect(reconcileMembershipRows([], first)[0].unavailable).toBe(true);
});
