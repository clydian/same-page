import { beforeEach, expect, it } from "vitest";
import { annotationRecordKey, localDatabase, type AnnotationConflictRecord } from "../platform/local-database";
import { activateAuthenticatedLocalOwner, authenticatedLocalOwnerKey, captureLocalWorkspaceSession, createLocalWorkspace, type LocalWorkspace } from "../platform/local-workspace";
import { AnnotationConflictChangedError, applyPulledAnnotations, applyPushResults, cacheAnnotationLayers, discardAnnotationConflict, queueScoreDrafts, reapplyAnnotationConflict, saveAnnotationDraft } from "./annotation-state";
let workspace: LocalWorkspace;
let conflict: AnnotationConflictRecord;
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
});
it("a cloud pull refreshes only the canonical variant and an old discard cannot erase the local conflict", async () => {
  const canonical = { ...conflict.canonical!, version: 3, payload: { ...conflict.canonical!.payload!, kind: "text" as const, text: "云端再次修改", pageNumber: 1, x: .5, y: .4, fontScale: .024 } };
  await applyPulledAnnotations(workspace, 3, [canonical]);
  const latest = await localDatabase.annotationConflicts.get(conflict.opId);
  expect(latest?.canonical).toEqual(canonical);
  expect(latest?.localPayload).toEqual(conflict.localPayload);
  await expect(discardAnnotationConflict(workspace, conflict.opId, conflict)).rejects.toBeInstanceOf(AnnotationConflictChangedError);
  expect(await localDatabase.annotations.get(annotationRecordKey(workspace.scopeKey, "note"))).toMatchObject({ state: "conflict", payload: { text: "本机修改" } });
  await discardAnnotationConflict(workspace, conflict.opId, latest!);
  expect(await localDatabase.annotations.get(annotationRecordKey(workspace.scopeKey, "note"))).toMatchObject({ state: "synced", version: 3, payload: { text: "云端再次修改" } });
});
it("a local edit arriving after review invalidates both reapply and discard", async () => {
  await saveAnnotationDraft(workspace, { id: "note", layerId: "layer", payload: { ...conflict.localPayload!, kind: "text", pageNumber: 1, x: .5, y: .4, fontScale: .024, text: "本机最新内容" } });
  await expect(reapplyAnnotationConflict(workspace, conflict.opId, false, conflict)).rejects.toBeInstanceOf(AnnotationConflictChangedError);
  await expect(discardAnnotationConflict(workspace, conflict.opId, conflict)).rejects.toBeInstanceOf(AnnotationConflictChangedError);
  expect(await localDatabase.annotationConflicts.get(conflict.opId)).toMatchObject({ localPayload: { text: "本机最新内容" } });
});
it("reapply is blocked by a revoked layer grant without removing the conflict", async () => {
  await localDatabase.annotationLayers.update(annotationRecordKey(workspace.scopeKey, "layer"), { canEdit: false });
  await expect(reapplyAnnotationConflict(workspace, conflict.opId, false, conflict)).rejects.toThrow("conflict_permission_denied");
  expect(await localDatabase.annotationConflicts.get(conflict.opId)).toBeDefined();
  expect(await localDatabase.annotationOutbox.count()).toBe(0);
});
it("a reviewed local deletion cannot turn keep-both into a silent discard", async () => {
  await saveAnnotationDraft(workspace, { id: "note", layerId: "layer", payload: null, deleted: true });
  const deleted = (await localDatabase.annotationConflicts.get(conflict.opId))!;
  await expect(reapplyAnnotationConflict(workspace, conflict.opId, true, deleted)).rejects.toBeInstanceOf(AnnotationConflictChangedError);
  expect(await localDatabase.annotationConflicts.get(conflict.opId)).toBeDefined();
  await reapplyAnnotationConflict(workspace, conflict.opId, false, deleted);
  await queueScoreDrafts(workspace);
  expect(await localDatabase.annotationOutbox.toArray()).toEqual([expect.objectContaining({ type: "delete", baseVersion: 2 })]);
});
