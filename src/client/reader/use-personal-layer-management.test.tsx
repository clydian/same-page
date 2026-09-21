import { noCapabilities } from "../../shared/drive-permissions";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { guestNoteLayer } from "../annotations/guest-notes";
import { cacheAnnotationLayers } from "../annotations/annotation-state";
import { localDatabase } from "../platform/local-database";
import { activateAuthenticatedLocalOwner, authenticatedLocalOwnerKey, createLocalWorkspace } from "../platform/local-workspace";
import { usePersonalLayerManagement } from "./use-personal-layer-management";

const workspace = createLocalWorkspace(authenticatedLocalOwnerKey("reader"), "drive", "score");
const own = { ...guestNoteLayer(), name: "我的笔记", canShare: true, revision: 4 };

beforeEach(async () => {
  await localDatabase.open();
  await activateAuthenticatedLocalOwner("reader");
  await cacheAnnotationLayers(workspace, [own]);
});
afterEach(() => vi.unstubAllGlobals());

it("retires a lost response from an earlier local-owner session instead of offering its retry", async () => {
  let rejectWrite: (reason: Error) => void = () => undefined;
  const remote = vi.fn<typeof fetch>(() => new Promise((_resolve, reject) => { rejectWrite = reject; }));
  vi.stubGlobal("fetch", remote);
  const { result } = renderHook(() => usePersonalLayerManagement(workspace, true));
  let completion: Promise<boolean>;
  act(() => { completion = result.current.change(own, { sharing: true }); });
  await waitFor(() => expect(remote).toHaveBeenCalledTimes(1));
  await activateAuthenticatedLocalOwner("another-user");
  await activateAuthenticatedLocalOwner("reader");
  await act(async () => { rejectWrite(new Error("response lost")); await completion; });
  expect(result.current.feedback).toBeNull();
  expect(result.current.retry).toBeNull();
  expect(result.current.blocked).toBe(true);
});

it("refreshes a revision conflict without replaying the old change or admitting another write", async () => {
  const remote = vi.fn<typeof fetch>(async (_input, init) => init?.method === "PUT"
    ? new Response(null, { status: 409 }) : Response.json(syncResponse));
  vi.stubGlobal("fetch", remote);
  const { result } = renderHook(() => usePersonalLayerManagement(workspace, true));
  await act(async () => { expect(await result.current.change(own, { name: "旧名称" })).toBe(false); });
  expect(result.current.blocked).toBe(true);
  await act(async () => { expect(await result.current.change(own, { sharing: true })).toBe(false); });
  await act(async () => { expect(await result.current.retry?.()).toBe(true); });
  expect(result.current.feedback?.message).toContain("核对当前状态后重新操作");
  expect(result.current.blocked).toBe(false);
  expect(remote.mock.calls.filter(([, init]) => init?.method === "PUT")).toHaveLength(1);
});

const syncResponse = {
  state: "active", score: { id: "score", choirId: "drive", fileName: "谱.pdf", updatedAt: 1,
    currentVersion: { id: "version", versionNumber: 1, sizeBytes: 10, sha256: "a".repeat(64), etag: "v", pageCount: 1, createdAt: 1 } },
  permissions: { capabilities: noCapabilities() },
  layers: { layers: [own], sharedLayerRevision: 0, permissions: { canManageLayers: false } },
  annotations: { cursor: 0, objects: [] },
};

it("retires an unconfirmed creation retry when the user cancels that input", async () => {
  const remote = vi.fn<typeof fetch>(async () => { throw new Error("offline"); });
  vi.stubGlobal("fetch", remote);
  const { result } = renderHook(() => usePersonalLayerManagement(workspace, true));
  act(() => result.current.startCreation());
  await act(async () => { await result.current.create("排练记录"); });
  expect(result.current.retry).not.toBeNull();
  act(() => result.current.cancelCreation());
  expect(result.current.creating).toBe(false);
  expect(result.current.retry).toBeNull();
  expect(result.current.feedback).toBeNull();
});

it("admits only one refresh retry after a confirmed write and never repeats that write", async () => {
  let failRefresh = true;
  let releaseRefresh: (response: Response) => void = () => undefined;
  const remote = vi.fn<typeof fetch>(async (_input, init) => {
    if (init?.method === "PUT") return Response.json({ revision: 5 });
    if (failRefresh) throw new Error("offline after confirmation");
    return new Promise<Response>(resolve => { releaseRefresh = resolve; });
  });
  vi.stubGlobal("fetch", remote);
  const { result } = renderHook(() => usePersonalLayerManagement(workspace, true));
  await act(async () => { await result.current.change(own, { sharing: true }); });
  expect(result.current.feedback?.message).toContain("修改已保存");
  failRefresh = false;
  let recovery: Promise<boolean>;
  let duplicate: Promise<boolean>;
  let anotherWrite: Promise<boolean>;
  act(() => {
    recovery = result.current.retry!();
    duplicate = result.current.retry!();
    anotherWrite = result.current.change(own, { name: "不应提交" });
  });
  await waitFor(() => expect(remote).toHaveBeenCalledTimes(3));
  await act(async () => { releaseRefresh(Response.json(syncResponse)); expect(await recovery).toBe(true); });
  expect(await duplicate!).toBe(false);
  expect(await anotherWrite!).toBe(false);
  expect(result.current.feedback).toBeNull();
  expect(remote.mock.calls.filter(([, init]) => init?.method === "PUT")).toHaveLength(1);
});

it("does not refresh or publish a confirmed write after its panel unmounts", async () => {
  let releaseWrite: (response: Response) => void = () => undefined;
  const remote = vi.fn<typeof fetch>(() => new Promise(resolve => { releaseWrite = resolve; }));
  vi.stubGlobal("fetch", remote);
  const { result, unmount } = renderHook(() => usePersonalLayerManagement(workspace, true));
  let completion: Promise<boolean>;
  act(() => { completion = result.current.change(own, { sharing: true }); });
  await waitFor(() => expect(remote).toHaveBeenCalledTimes(1));
  unmount();
  releaseWrite(Response.json({ revision: 5 }));
  expect(await completion!).toBe(false);
  expect(remote).toHaveBeenCalledTimes(1);
});

it("fails closed when Local Drafts cannot be read before deletion", async () => {
  const remote = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", remote);
  const read = vi.spyOn(localDatabase.annotations, "where").mockImplementationOnce(() => { throw new Error("storage unavailable"); });
  const { result } = renderHook(() => usePersonalLayerManagement(workspace, true));
  try {
    await act(async () => { expect(await result.current.change(own, { action: "delete" })).toBe(false); });
    expect(result.current.feedback?.message).toBe("无法确认本机内容，请重试。");
    expect(remote).not.toHaveBeenCalled();
  } finally { read.mockRestore(); }
});

it.each(["submit", "retry"])("retains one creation identity after a lost response through %s", async route => {
  const creations: Array<{ id: string; name: string }> = [];
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (_input, init) => {
    if (init?.method === "POST") {
      creations.push(JSON.parse(String(init.body)));
      if (creations.length === 1) throw new Error("response lost after commit");
      return Response.json({ id: creations[0].id }, { status: 201 });
    }
    return Response.json({ ...syncResponse, layers: { ...syncResponse.layers,
      layers: [own, { ...own, ...creations[0] }] } });
  }));
  const { result } = renderHook(() => usePersonalLayerManagement(workspace, true));
  act(() => result.current.startCreation());
  await act(async () => { expect(await result.current.create("排练记录")).toBe(false); });
  expect(result.current.creating).toBe(true);
  await act(async () => {
    expect(await (route === "retry" ? result.current.retry!() : result.current.create("排练记录"))).toBe(true);
  });
  expect(creations).toHaveLength(2);
  expect(creations[0].name).toBe("排练记录");
  expect(creations[1]).toEqual(creations[0]);
  expect(result.current.creating).toBe(false);
  expect(result.current.feedback).toBeNull();
});
