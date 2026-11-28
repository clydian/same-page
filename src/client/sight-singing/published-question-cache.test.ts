import { Blob as NodeBlob } from 'node:buffer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PublishedQuestion } from '../../shared/sight-singing';
import { acceptNewSession, beginLogout, forgetOfflineSession } from '../auth/logout-fence';
import { clearLocalFiles } from '../offline/local-files';
import { localDatabase } from '../platform/local-database';
import { activateAuthenticatedLocalOwner, createLocalWorkspace } from '../platform/local-workspace';
import { publishedQuestionFiles, publishedQuestionStorageId } from '../platform/published-question-files';
import { rememberDriveAccessRevoked, rememberLocalDriveDirectory } from '../score-library/local-drive-directory';
import { capturePublishedCatalog, capturePublishedQuestionCopy, readPublishedQuestionCopies, recordPublishedQuestionChange } from './published-question-cache';

const scope = { userId: 'singer', sessionId: 'session', choirId: 'drive' };
const score: PublishedQuestion = { id: 'd6cd0fb9-ea47-48fe-8ef3-86ac8993b1c3', title: 'Synthesized', first: 0, last: 0,
  version: 1, scoreId: null, attachmentId: null, revision: null, canEdit: true, publisher: { kind: 'official' },
  snapshot: { name: 'question.musicxml', editToken: '2938659c-728e-4819-b2ce-adf1e9444860' } };
const signal = () => new AbortController().signal;
const bytes = new Uint8Array([60, 65, 62]);
const expiresAt = () => Date.now() + 60_000;

async function setupDrive() {
  const owner = await activateAuthenticatedLocalOwner(scope.userId);
  const workspace = createLocalWorkspace(owner, scope.choirId, '');
  await rememberLocalDriveDirectory(workspace, { id: scope.choirId, name: 'Synthetic drive', guestAdmissionMode: 'invite' }, [], signal(), true);
  return workspace;
}

beforeEach(async () => {
  vi.stubGlobal('Blob', NodeBlob);
  await localDatabase.open();
  await localDatabase.system.clear();
  await setupDrive();
  await acceptNewSession(scope.userId, scope.sessionId, Date.now(), expiresAt());
  await (await capturePublishedCatalog(scope, signal()))([score]);
});
afterEach(() => vi.unstubAllGlobals());

it('requires the verified session, drive, question and exact version, and rejects corrupted bytes', async () => {
  const copy = await capturePublishedQuestionCopy(scope, score, signal());
  await copy.save(bytes, signal());
  expect(await copy.read()).toEqual(bytes);
  expect((await readPublishedQuestionCopies(scope))?.copies[0].question.canEdit).toBe(false);
  for (const wrong of [
    capturePublishedQuestionCopy(scope, { ...score, version: 2 }, signal()),
    capturePublishedQuestionCopy({ ...scope, choirId: 'elsewhere' }, score, signal()),
    capturePublishedQuestionCopy({ ...scope, sessionId: 'elsewhere' }, score, signal()),
  ]) expect(await (await wrong).read()).toBeNull();
  const row = (await publishedQuestionFiles('user:singer').toArray()).find(record => record.blob)!;
  await localDatabase.system.put({ ...row, blob: new NodeBlob([new Uint8Array([1, 2, 3])]) as Blob });
  expect(await copy.read()).toBeNull();
});

it('invalidates obsolete copies and fences a pending save after replacement, deletion or cache cleanup', async () => {
  const copy = await capturePublishedQuestionCopy(scope, score, signal());
  await copy.save(bytes, signal());
  const version2 = { ...score, version: 2 };
  await (await capturePublishedCatalog(scope, signal()))([version2]);
  await copy.save(bytes, signal());
  expect(await copy.read()).toBeNull();
  expect((await readPublishedQuestionCopies(scope))?.copies).toEqual([]);

  const opened = await capturePublishedQuestionCopy(scope, version2, signal());
  await opened.save(bytes, signal());
  await clearLocalFiles({ ownerKey: (await setupDrive()).ownerKey, choirId: scope.choirId, scoreId: publishedQuestionStorageId(score.id) });
  await opened.save(bytes, signal());
  expect(await opened.read()).toBeNull();
  const newOpen = await capturePublishedQuestionCopy(scope, version2, signal());
  await newOpen.save(bytes, signal());
  expect(await newOpen.read()).toEqual(bytes);

  await recordPublishedQuestionChange(scope, score.id, null, signal());
  await newOpen.save(bytes, signal());
  expect(await newOpen.read()).toBeNull();
});

it('drops protected copies after denial and rejects storage reads across expiry, logout and user changes', async () => {
  const copy = await capturePublishedQuestionCopy(scope, score, signal());
  await copy.save(bytes, signal());
  const later = vi.spyOn(Date, 'now').mockReturnValue(expiresAt() + 1);
  expect(await copy.read()).toBeNull();
  later.mockRestore();

  const workspace = await setupDrive();
  await rememberDriveAccessRevoked(workspace, signal());
  expect(await copy.read()).toBeNull();
  expect(await readPublishedQuestionCopies(scope)).toBeNull();

  await setupDrive();
  await (await capturePublishedCatalog(scope, signal()))([score]);
  await copy.save(bytes, signal());
  await beginLogout(scope.userId, scope.sessionId);
  expect(await readPublishedQuestionCopies(scope)).toBeNull();
  await forgetOfflineSession();
  expect(await publishedQuestionFiles(workspace.ownerKey).count()).toBe(0);

  const otherId = 'another-user';
  await activateAuthenticatedLocalOwner(otherId);
  await expect(copy.read()).rejects.toThrow('local_workspace_owner_changed');
  expect(await publishedQuestionFiles(`user:${otherId}`).count()).toBe(0);
});
