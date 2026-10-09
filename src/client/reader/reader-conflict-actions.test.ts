import { beforeEach, expect, it, vi } from "vitest";
import { annotationRecordKey, localDatabase, type AnnotationConflictRecord } from "../platform/local-database";
import { activateAuthenticatedLocalOwner, authenticatedLocalOwnerKey, captureLocalWorkspaceSession, createLocalWorkspace, type LocalWorkspace } from "../platform/local-workspace";
import { applyPushResults, cacheAnnotationLayers, queueScoreDrafts, saveAnnotationDraft } from "../annotations/annotation-state";
import { ReaderAnnotationActions } from "./reader-annotation-actions";
import { noCapabilities } from "../../shared/drive-permissions";
import { syncReader } from "./sync-reader";
vi.mock("./sync-reader", () => ({ syncReader: vi.fn() }));
const active: Awaited<ReturnType<typeof syncReader>> = {
  state: "active", score: { id: "score", choirId: "drive", fileName: "谱.pdf", updatedAt: 1,
    currentVersion: { id: "version", versionNumber: 1, sizeBytes: 10, sha256: "a".repeat(64), etag: "version", pageCount: 1, createdAt: 1 } },
  permissions: { capabilities: noCapabilities() }, layers: { layers: [], sharedLayerRevision: 0, permissions: { canManageLayers: false } },
  annotations: { cursor: 2, hasMore: false, objects: [] },
};
let workspace: LocalWorkspace, conflict: AnnotationConflictRecord, actions: ReaderAnnotationActions;
beforeEach(async () => {
  await localDatabase.open(); await activateAuthenticatedLocalOwner("one");
  workspace = await captureLocalWorkspaceSession(createLocalWorkspace(authenticatedLocalOwnerKey("one"), "drive", "score"));
  await cacheAnnotationLayers(workspace, [{ id: "layer", kind: "personal", sharedSlot: null, name: "我的笔记", sortOrder: 100, subscribed: true, canEdit: true, displayColor: "#dc2626", subscriptionSource: "product", colorSource: "product", adminDefaultColor: "#dc2626", driveSubscribed: null, driveColorOverride: null, scoreSubscriptionOverride: null }]);
  await saveAnnotationDraft(workspace, { id: "note", layerId: "layer", payload: { kind: "text", pageNumber: 1, x: .5, y: .4, fontScale: .024, text: "本机修改" } });
  await queueScoreDrafts(workspace);
  const operations = await localDatabase.annotationOutbox.toArray();
  await applyPushResults(workspace, operations, [{ opId: operations[0].opId, status: "conflict", object: { id: "note", layerId: "layer", version: 2, deleted: false,
    payload: { kind: "text", pageNumber: 1, x: .5, y: .4, fontScale: .024, text: "云端内容" }, createdByDisplayName: "甲", updatedByDisplayName: "乙", updatedAt: 2 } }]);
  conflict = (await localDatabase.annotationConflicts.toArray())[0];
  actions = new ReaderAnnotationActions(workspace, { authenticated: true, online: true, trashed: false, confirmIdentity: vi.fn() });
  vi.mocked(syncReader).mockResolvedValue(active);
});
it("reports a still queued reapply as local-saved even when the request succeeds", async () => {
  expect(await actions.resolveConflict(conflict.opId, "reapply", conflict)).toBe("local-saved");
  expect(await localDatabase.annotationOutbox.count()).toBe(1);
});
it("preserves a queued choice if permission is revoked between review and push", async () => {
  vi.mocked(syncReader).mockResolvedValueOnce(active).mockImplementationOnce(async () => {
    await localDatabase.annotationLayers.update(annotationRecordKey(workspace.scopeKey, "layer"), { canEdit: false });
    return active;
  });
  expect(await actions.resolveConflict(conflict.opId, "reapply", conflict)).toBe("local-saved");
  expect(await localDatabase.annotationOutbox.count()).toBe(1);
  expect(await localDatabase.annotations.get(annotationRecordKey(workspace.scopeKey, "note"))).toMatchObject({ state: "pending", payload: { text: "本机修改" } });
});
it.each(["reapply", "keep-both"] as const)("reports %s as accepted only after its target record is accepted", async strategy => {
  vi.mocked(syncReader).mockResolvedValueOnce(active).mockImplementationOnce(async () => {
    const operations = await localDatabase.annotationOutbox.toArray();
    await applyPushResults(workspace, operations, operations.map(operation => ({ opId: operation.opId, status: "accepted", object: {
      ...conflict.canonical!, id: operation.annotationId, version: strategy === "keep-both" ? 1 : 3, payload: operation.payload,
    } })));
    return active;
  });
  expect(await actions.resolveConflict(conflict.opId, strategy, conflict)).toBe("conflict-reapplied");
  expect(await localDatabase.annotationOutbox.count()).toBe(0);
});
it("a synced original cloud record does not imply a keep-both copy was accepted", async () => {
  expect(await actions.resolveConflict(conflict.opId, "keep-both", conflict)).toBe("local-saved");
  expect(await localDatabase.annotations.get(annotationRecordKey(workspace.scopeKey, "note"))).toMatchObject({ state: "synced", payload: { text: "云端内容" } });
  expect(await localDatabase.annotationOutbox.count()).toBe(1);
});
