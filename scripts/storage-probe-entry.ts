// Private, sealed compatibility artifact. Never published as a frontend URL.
import { localDatabase as db, annotationRecordKey } from '../src/client/platform/local-database';
import { activateAuthenticatedLocalOwner, createLocalWorkspace } from '../src/client/platform/local-workspace';
import { saveAnnotationDraft, queueScoreDrafts, prepareAnnotationPush, applyPushResults, applyPulledAnnotations } from '../src/client/annotations/annotation-state';
import { toWireOperation } from '../src/client/annotations/push-request';
import { annotationOperationSchema, annotationPushResponseSchema, annotationPullResponseSchema } from '../src/shared/annotations';
declare const __SAME_PAGE_PROBE_BUILD__: string;
export const sourceBuild = __SAME_PAGE_PROBE_BUILD__;
const owner = 'release-matrix-user';
const check = (value: unknown, message: string) => { if (!value) throw new Error(message); };
export async function phase(label: string, seed = false) {
  await db.open();
  try {
    const ownerKey = await activateAuthenticatedLocalOwner(owner);
    const workspace = createLocalWorkspace(ownerKey, 'release-drive', 'release-score');
    const payload = (text: string) => ({ kind: 'text' as const, pageNumber: 1, x: .2, y: .3, fontScale: .024, text, textAlign: 'center' as const });
    if (seed) {
      const fixture = { note: crypto.randomUUID(), layer: crypto.randomUUID(), conflict: crypto.randomUUID(), attempt: crypto.randomUUID() };
      await db.system.put({ key: 'release-fixture', value: JSON.stringify(fixture) });
      await db.system.put({ key: 'experience:fixture', value: JSON.stringify({ text: 'guest-local-only' }) });
      await db.offlineScores.put({ key:'pdf', ...workspace, versionId:'pdf-v1', fileName:'fixture.pdf', sha256:'a'.repeat(64), pageCount:1, blob:new Blob(['%PDF-1.7 release matrix'],{type:'application/pdf'}), active:1, verifiedAt:42 });
      await db.offlineSnapshots.put({ key:'pdf', ...workspace, annotationSnapshot:{layers:[],annotations:[],cursor:12,verifiedAt:42} });
      await db.annotationOutbox.put({ ...workspace, opId:fixture.attempt, annotationId:crypto.randomUUID(), layerId:fixture.layer, baseVersion:1, type:'upsert', payload:payload('attempted'), attemptedAt:1, createdAt:1 });
      await db.annotationConflicts.put({ ...workspace, opId:fixture.conflict, annotationId:crypto.randomUUID(), layerId:fixture.layer, baseVersion:1, localPayload:payload('conflict-local'),localDeleted:false,canonical:null,createdAt:1 });
      await db.readingPreferences.put({ key:'preference', ownerKey, choirId:workspace.choirId, scoreId:workspace.scoreId, kind:'personal', id:fixture.layer, subscribed:true, version:'fixture-v1', pending:true, error:null });
      await db.guestLayerPreferences.put({ key:'guest-preference',...workspace,layerId:fixture.layer,visible:true });
      await db.system.put({key:'fixture-session-fence',value:'same-owner-epoch'});
    }
    const fixture = JSON.parse((await db.system.get('release-fixture'))!.value);
    check(await (await db.offlineScores.get('pdf'))!.blob.text() === '%PDF-1.7 release matrix', 'PDF bytes lost');
    check((await db.offlineSnapshots.get('pdf'))?.annotationSnapshot.cursor === 12, 'snapshot lost');
    const attempted = await db.annotationOutbox.get(fixture.attempt);
    check(attempted?.attemptedAt !== null && attempted?.payload?.kind === 'text' && attempted.payload.text === 'attempted' && attempted.baseVersion === 1, 'attempted operation changed');
    check((await db.annotationConflicts.get(fixture.conflict))?.localPayload?.kind === 'text', 'conflict lost');
    check((await db.system.get('experience:fixture'))?.value.includes('guest-local-only'), 'experience lost');
    check((await db.system.get('fixture-session-fence'))?.value === 'same-owner-epoch', 'identity fence lost');
    check(await db.readingPreferences.get('preference'), 'reading preference lost');
    const prior = await db.annotations.get(annotationRecordKey(workspace.scopeKey, fixture.note));
    if (!seed) check(prior?.state === 'synced' && prior.payload?.kind === 'text', 'previous artifact write unreadable');
    await saveAnnotationDraft(workspace, { id:fixture.note,layerId:fixture.layer,payload:payload(label) });
    await queueScoreDrafts(workspace);
    const operations = (await prepareAnnotationPush(workspace,100)).filter(o=>o.annotationId===fixture.note);
    check(operations.length === 1, 'draft did not become one operation');
    const operation = operations[0];
    const wire = annotationOperationSchema.parse(toWireOperation(operation));
    const object = { id:wire.annotationId, layerId:wire.layerId, version:wire.baseVersion+1, deleted:false, payload:wire.payload, createdByDisplayName:'fixture', updatedByDisplayName:'fixture', updatedAt:Date.now() };
    // Use each artifact's real response parser and state merger. Current backend
    // route integration tests separately exercise the SQL/API side of this protocol.
    const push = annotationPushResponseSchema.parse({results:[{opId:wire.opId,status:'accepted',object}]});
    await applyPushResults(workspace,operations,push.results);
    const pull = annotationPullResponseSchema.parse({cursor:object.version,objects:[object]});
    await applyPulledAnnotations(workspace,pull.cursor,pull.objects);
    const saved=await db.annotations.get(annotationRecordKey(workspace.scopeKey,fixture.note));
    check(saved?.state==='synced' && saved.payload?.kind==='text' && saved.payload.text===label, 'edit/sync roundtrip changed content');
    check(await db.annotationOutbox.get(fixture.attempt), 'unrelated attempted op deleted');
    check(await db.annotationConflicts.get(fixture.conflict), 'unrelated conflict deleted');
    return {sourceBuild,phase:label,schema:db.verno,blob:true,draft:true,sync:true,attemptedOp:true,conflict:true,identity:true};
  } finally { db.close(); }
}
