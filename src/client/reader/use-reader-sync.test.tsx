import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AnnotationLayerSummary } from "../../shared/annotations";
import { noCapabilities } from "../../shared/drive-permissions";
import { applyPushResults, cacheAnnotationLayers, queueScoreDrafts, saveAnnotationDraft } from "../annotations/annotation-state";
import { GUEST_NOTE_LAYER_ID } from "../annotations/guest-notes";
import { localDatabase } from "../platform/local-database";
import { activateAuthenticatedLocalOwner, activateGuestLocalOwner, experienceOwnerKey, authenticatedLocalOwnerKey, captureLocalWorkspaceSession, createLocalWorkspace, type LocalWorkspace } from "../platform/local-workspace";
import { useReaderSync } from "./use-reader-sync";

let workspace: LocalWorkspace;
const layer: AnnotationLayerSummary = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", kind: "personal", sharedSlot: null,
  name: "我的笔记", sortOrder: 0, subscribed: true, subscriptionSource: "personal",
  displayColor: "#dc2626", colorSource: "personal", adminDefaultColor: null,
  driveSubscribed: null, driveColorOverride: null, scoreSubscriptionOverride: null, canEdit: true,
};
const access = { authenticatedUserId: "reader", sessionId: "session", trashed: false, confirmIdentity: async () => undefined };
const draft = { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", layerId: layer.id,
  payload: { kind: "text" as const, pageNumber: 1, x: 0.1, y: 0.2, fontScale: 0.024, text: "渐弱" } };
function response() {
  return Response.json({ state: "active", score: { id: "score", choirId: "drive", fileName: "谱.pdf", updatedAt: 1,
    currentVersion: { id: "version", versionNumber: 1, sizeBytes: 10, sha256: "a".repeat(64), etag: "version", pageCount: 1, createdAt: 1 } },
    permissions: { capabilities: noCapabilities() },
    layers: { layers: [layer], sharedLayerRevision: 0, permissions: { canManageLayers: false } },
    annotations: { cursor: 0, objects: [] } });
}
beforeEach(async () => {
  await localDatabase.open();
  await activateAuthenticatedLocalOwner("reader");
  workspace = await captureLocalWorkspaceSession(createLocalWorkspace(authenticatedLocalOwnerKey("reader"), "drive", "score"));
  await cacheAnnotationLayers(workspace, [layer]);
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  vi.stubGlobal("fetch", vi.fn(async () => response()));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("observes durable Local Draft, queued work, offline waiting and permission loss", async () => {
  const { result } = renderHook(() => useReaderSync(workspace, access));
  await waitFor(() => expect(result.current.status.message).toBe("尚无笔记修改"));
  await act(async () => { await saveAnnotationDraft(workspace, draft); });
  await waitFor(() => expect(result.current.status.message).toBe("已保存在本机 · 完成编辑后同步"));
  await act(async () => { await queueScoreDrafts(workspace); result.current.reportOutcome("local-saved"); });
  await waitFor(() => expect(result.current.status.message).toBe("已保存在本机 · 1 项等待同步"));
  act(() => { vi.spyOn(navigator, "onLine", "get").mockReturnValue(false); window.dispatchEvent(new Event("offline")); });
  expect(result.current.status.message).toBe("已保存在本机 · 等待联网");
  expect(result.current.canRetry).toBe(false);
  await act(async () => { await cacheAnnotationLayers(workspace, [{ ...layer, canEdit: false }]); });
  await waitFor(() => expect(result.current.status.message).toContain("编辑权已撤销"));
  expect(result.current.annotationState?.annotations[0].payload).toMatchObject({ text: "渐弱" });
  act(() => { vi.spyOn(navigator, "onLine", "get").mockReturnValue(true); window.dispatchEvent(new Event("online")); });
  expect(fetch).not.toHaveBeenCalled();
});

it("keeps Local Conflicts ahead of failures and resolves them through the owning interface", async () => {
  await saveAnnotationDraft(workspace, draft);
  await queueScoreDrafts(workspace);
  const operations = await localDatabase.annotationOutbox.toArray();
  await applyPushResults(workspace, operations, [{ opId: operations[0].opId, status: "conflict", object: null }]);
  const { result } = renderHook(() => useReaderSync(workspace, access));
  await waitFor(() => expect(result.current.status.kind).toBe("conflict"));
  act(() => result.current.reportOutcome("failed"));
  expect(result.current.status.message).toBe("仍有 1 项本机冲突待处理。");
  await act(async () => { await result.current.resolveConflict(operations[0].opId, "discard"); });
  await waitFor(() => expect(result.current.status.message).toBe("尚无笔记修改"));
});

it("coalesces immediate retry clicks and records a cloud check without claiming an upload", async () => {
  let release!: () => void;
  vi.mocked(fetch).mockImplementation(async () => { await new Promise<void>(resolve => { release = resolve; }); return response(); });
  const { result } = renderHook(() => useReaderSync(workspace, access));
  await waitFor(() => expect(result.current.annotationState).not.toBeNull());
  let retry!: Promise<void>;
  act(() => { retry = result.current.retry(); void result.current.retry(); });
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  expect(result.current.syncing).toBe(true);
  expect(result.current.canRetry).toBe(false);
  expect(result.current.lastCheckedAt).toBeNull();
  await act(async () => { release(); await retry; });
  expect(result.current.syncing).toBe(false);
  expect(result.current.status.message).toBe("尚无笔记修改");
  expect(result.current.lastCheckedAt).toEqual(expect.any(Number));
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("keeps failed checks actionable and does not advance the last successful check", async () => {
  const { result } = renderHook(() => useReaderSync(workspace, access));
  await act(async () => { await result.current.retry(); });
  const checked = result.current.lastCheckedAt;
  vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 503 }));
  await act(async () => { await result.current.retry(); });
  expect(result.current.status.kind).toBe("failed");
  expect(result.current.canRetry).toBe(true);
  expect(result.current.lastCheckedAt).toBe(checked);
});

it("fences a delayed result and a retained callback when the reader changes scores", async () => {
  let release!: () => void;
  vi.mocked(fetch).mockImplementation(async () => { await new Promise<void>(resolve => { release = resolve; }); return new Response(null, { status: 503 }); });
  const view = renderHook(({ scope }) => useReaderSync(scope, access), { initialProps: { scope: workspace } });
  await waitFor(() => expect(view.result.current.annotationState).not.toBeNull());
  const oldReport = view.result.current.reportOutcome;
  let pending!: Promise<void>;
  act(() => { pending = view.result.current.retry(); });
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  const next = await captureLocalWorkspaceSession(createLocalWorkspace(authenticatedLocalOwnerKey("reader"), "drive", "next"));
  view.rerender({ scope: next });
  await waitFor(() => expect(view.result.current.annotationState?.scopeKey).toBe(next.scopeKey));
  await act(async () => { release(); await pending; oldReport("failed"); });
  expect(view.result.current.status.message).toBe("尚无笔记修改");
  expect(view.result.current.syncing).toBe(false);
  expect(view.result.current.lastCheckedAt).toBeNull();
});

it("preserves trash feedback and blocks retries without altering Local Drafts", async () => {
  await saveAnnotationDraft(workspace, draft);
  const { result } = renderHook(() => useReaderSync(workspace, { ...access, trashed: true }));
  await waitFor(() => expect(result.current.annotationState?.annotations).toHaveLength(1));
  expect(result.current.status.kind).toBe("risk");
  expect(result.current.status.message).toContain("回收站");
  expect(result.current.canRetry).toBe(false);
  await act(async () => { await result.current.retry(); });
  expect(fetch).not.toHaveBeenCalled();
  expect(result.current.annotationState?.annotations[0].state).toBe("draft");
});


it("reports cloud acceptance only from accepted annotation facts", async () => {
  await saveAnnotationDraft(workspace, draft);
  await queueScoreDrafts(workspace);
  const operations = await localDatabase.annotationOutbox.toArray();
  const { result } = renderHook(() => useReaderSync(workspace, access));
  await waitFor(() => expect(result.current.status.kind).toBe("pending"));
  act(() => result.current.reportOutcome("synced"));
  expect(result.current.status.kind).toBe("pending");
  await act(async () => {
    await applyPushResults(workspace, operations, [{ opId: operations[0].opId, status: "accepted", object: {
      id: draft.id, layerId: layer.id, version: 1, deleted: false, payload: draft.payload,
      createdByDisplayName: "reader", updatedByDisplayName: "reader", updatedAt: 1,
    } }]);
  });
  await waitFor(() => expect(result.current.status.message).toBe("没有待上传的修改"));
});

it("keeps local experience notes local and never exposes a cloud retry", async () => {
  const owner = await activateGuestLocalOwner("drive");
  const guest = await captureLocalWorkspaceSession(createLocalWorkspace(experienceOwnerKey(owner), "drive", "score"));
  await cacheAnnotationLayers(guest, []);
  await saveAnnotationDraft(guest, { ...draft, layerId: GUEST_NOTE_LAYER_ID });
  const { result } = renderHook(() => useReaderSync(guest, access));
  await waitFor(() => expect(result.current.status.message).toBe("体验笔记仅保存在此浏览器"));
  expect(result.current.localOnly).toBe(true);
  expect(result.current.canRetry).toBe(false);
  await act(async () => { await result.current.retry(); });
  expect(fetch).not.toHaveBeenCalled();
  act(() => result.current.reportOutcome("failed"));
  expect(result.current.status.message).toBe("本机操作未完成，请重试。");
});

it("hides old facts immediately when the same score is reopened in a new owner session", async () => {
  await saveAnnotationDraft(workspace, draft);
  const view = renderHook(({ scope }) => useReaderSync(scope, access), { initialProps: { scope: workspace } });
  await waitFor(() => expect(view.result.current.status.kind).toBe("pending"));
  const oldReport = view.result.current.reportOutcome;
  await activateAuthenticatedLocalOwner("other");
  await activateAuthenticatedLocalOwner("reader");
  const next = await captureLocalWorkspaceSession(createLocalWorkspace(authenticatedLocalOwnerKey("reader"), "drive", "score"));
  view.rerender({ scope: next });
  expect(view.result.current.annotationState).toBeNull();
  expect(view.result.current.status.message).toBe("尚未确认本机笔记状态，请稍后重试。");
  act(() => oldReport("failed"));
  await waitFor(() => expect(view.result.current.status.kind).toBe("pending"));
});

it("cancels an in-flight retry when the reader unmounts", async () => {
  let release!: () => void;
  vi.mocked(fetch).mockImplementation(async () => { await new Promise<void>(resolve => { release = resolve; }); return response(); });
  const view = renderHook(() => useReaderSync(workspace, access));
  let pending!: Promise<void>;
  act(() => { pending = view.result.current.retry(); });
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  const signal = vi.mocked(fetch).mock.calls[0][1]?.signal;
  view.unmount();
  await pending;
  expect(signal?.aborted).toBe(true);
  release();
});


it("does not carry a previous owner session's failed request into a reopened score", async () => {
  vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 503 }));
  const view = renderHook(({ scope }) => useReaderSync(scope, access), { initialProps: { scope: workspace } });
  await act(async () => { await view.result.current.retry(); });
  expect(view.result.current.status.kind).toBe("failed");
  await activateAuthenticatedLocalOwner("other");
  await activateAuthenticatedLocalOwner("reader");
  const next = await captureLocalWorkspaceSession(createLocalWorkspace(authenticatedLocalOwnerKey("reader"), "drive", "score"));
  view.rerender({ scope: next });
  await waitFor(() => expect(view.result.current.status.message).toBe("尚无笔记修改"));
  expect(view.result.current.lastCheckedAt).toBeNull();
  expect(fetch).toHaveBeenCalledTimes(1);
});
