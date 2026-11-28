import Dexie from 'dexie';
import { publishedQuestionSchema, SIGHT_SINGING_SCORE_MAX_BYTES, type PublishedQuestion } from '../../shared/sight-singing';
import { readAvailableOfflineSession } from '../auth/offline-session';
import { captureOfflineFileFence } from '../offline/local-files';
import { readOfflineFileBytes, sha256Hex } from '../offline/offline-score-verification';
import { ACTIVE_LOCAL_OWNER_KEY, localDatabase, type SystemRecord } from '../platform/local-database';
import { authenticatedLocalOwnerKey, captureLocalWorkspaceSession, createLocalWorkspace, withLocalWorkspaceTransaction } from '../platform/local-workspace';
import { publishedQuestionFilePrefix, publishedQuestionFiles, publishedQuestionStorageId } from '../platform/published-question-files';

export type PublishedQuestionScope = { userId: string; choirId: string; sessionId: string };
const prefix = (scope: PublishedQuestionScope) => publishedQuestionFilePrefix(authenticatedLocalOwnerKey(scope.userId), scope.choirId);
const catalogKey = (scope: PublishedQuestionScope) => prefix(scope) + '"catalog"]';
const copyKey = (scope: PublishedQuestionScope, { id, version }: Pick<PublishedQuestion, 'id' | 'version'>) => prefix(scope) + `${JSON.stringify(id)},${version}]`;

type Catalog = { sessionId: string; expiresAt: number; checkedAt: number; versions: Record<string, number> };
type Copy = { sessionId: string; question: PublishedQuestion; sha256: string; savedAt: number };
const MAX_COPIES = 24;
const MAX_BYTES = 2 * SIGHT_SINGING_SCORE_MAX_BYTES;

function decodeCopy(row: SystemRecord | undefined, scope: PublishedQuestionScope) {
  if (!row?.blob || row.blob.size < 1 || row.blob.size > SIGHT_SINGING_SCORE_MAX_BYTES) return null;
  try {
    const data: Copy = JSON.parse(row.value);
    const question = publishedQuestionSchema.parse(data.question);
    if (data.sessionId !== scope.sessionId || row.key !== copyKey(scope, question) || typeof data.sha256 !== 'string' || !Number.isFinite(data.savedAt)) return null;
    return { ...data, question, blob: row.blob, key: row.key };
  } catch { return null; }
}

function readCatalog(scope: PublishedQuestionScope) {
  return localDatabase.system.get(catalogKey(scope)).then((row): Catalog | null => {
    try { return row ? JSON.parse(row.value) : null; }
    catch { return null; }
  });
}

async function captureWorkspace(scope: PublishedQuestionScope, id = '') {
  return captureLocalWorkspaceSession(createLocalWorkspace(authenticatedLocalOwnerKey(scope.userId), scope.choirId, id));
}

function currentSession(scope: PublishedQuestionScope) {
  return readAvailableOfflineSession(scope.userId).then(session => session?.sessionId === scope.sessionId ? session : null);
}

function currentCatalog(scope: PublishedQuestionScope) {
  return Dexie.Promise.all([currentSession(scope), readCatalog(scope)]).then(([session, catalog]) =>
    session && catalog?.sessionId === session.sessionId && Math.min(session.expiresAt, catalog.expiresAt) > Date.now()
      ? { ...catalog, expiresAt: Math.min(session.expiresAt, catalog.expiresAt) } : null);
}

export async function capturePublishedCatalog(scope: PublishedQuestionScope, signal: AbortSignal) {
  const checkedAt = Date.now();
  const workspace = await captureWorkspace(scope);
  return (questions: PublishedQuestion[]) => withLocalWorkspaceTransaction(workspace, 'rw', [], async () => {
    signal.throwIfAborted();
    const session = await currentSession(scope);
    if (!session) return;
    const previous = await readCatalog(scope);
    if (previous?.sessionId === scope.sessionId && previous.checkedAt > checkedAt) return;
    const versions = Object.fromEntries(questions.map(question => [question.id, question.version]));
    const catalog: Catalog = { sessionId: scope.sessionId, expiresAt: session.expiresAt, checkedAt, versions };
    await localDatabase.system.put({ key: catalogKey(scope), value: JSON.stringify(catalog) });
    const obsolete = await publishedQuestionFiles(workspace.ownerKey, scope.choirId).filter(row => {
      if (row.key === catalogKey(scope)) return false;
      const copy = decodeCopy(row, scope);
      return !copy || versions[copy.question.id] !== copy.question.version;
    }).primaryKeys();
    await localDatabase.system.bulkDelete(obsolete);
    signal.throwIfAborted();
  });
}

// A confirmed write invalidates the exact old tuple even if the subsequent
// background list request cannot reach the server.
export async function recordPublishedQuestionChange(scope: PublishedQuestionScope, id: string, question: PublishedQuestion | null, signal: AbortSignal) {
  const checkedAt = Date.now();
  const workspace = await captureWorkspace(scope);
  await withLocalWorkspaceTransaction(workspace, 'rw', [], async () => {
    signal.throwIfAborted();
    const catalog = await currentCatalog(scope);
    if (!catalog || catalog.checkedAt > checkedAt) return;
    if (!question || catalog.versions[id] !== question.version) await publishedQuestionFiles(workspace.ownerKey, scope.choirId, id).delete();
    if (question) catalog.versions[id] = question.version;
    else delete catalog.versions[id];
    await localDatabase.system.put({ key: catalogKey(scope), value: JSON.stringify({ ...catalog, checkedAt }) });
    signal.throwIfAborted();
  });
}

export function readPublishedQuestionCopies(scope: PublishedQuestionScope) {
  const owner = authenticatedLocalOwnerKey(scope.userId);
  // Schedule the IndexedDB reads together so the transaction stays alive
  // inside Dexie's live query on browsers with native async/await.
  return localDatabase.transaction('r', [localDatabase.system, localDatabase.driveDirectories], () =>
    Dexie.Promise.all([
      localDatabase.system.get(ACTIVE_LOCAL_OWNER_KEY), currentCatalog(scope),
      localDatabase.driveDirectories.get(JSON.stringify([owner, scope.choirId])),
      publishedQuestionFiles(owner, scope.choirId).toArray(),
    ]).then(([active, catalog, drive, rows]) => {
      if (active?.value !== owner || !catalog || !drive?.membership || drive.accessRevoked || drive.choir.isPreviewEntry) return null;
      const copies = rows.map(row => decodeCopy(row, scope)).filter(copy => copy !== null)
        .filter(copy => catalog.versions[copy.question.id] === copy.question.version);
      return { expiresAt: catalog.expiresAt, copies };
    }));
}

export async function capturePublishedQuestionCopy(scope: PublishedQuestionScope, question: PublishedQuestion, signal: AbortSignal) {
  const workspace = await captureWorkspace(scope, publishedQuestionStorageId(question.id));
  const fence = await captureOfflineFileFence(workspace);
  const key = copyKey(scope, question);
  const hasAccess = async () => {
    signal.throwIfAborted();
    return (await currentCatalog(scope))?.versions[question.id] === question.version &&
      fence === await captureOfflineFileFence(workspace);
  };
  return {
    async read() {
      const copy = await withLocalWorkspaceTransaction(workspace, 'r', [], async () =>
        await hasAccess() ? decodeCopy(await localDatabase.system.get(key), scope) : null);
      if (!copy) return null;
      const bytes = await readOfflineFileBytes(copy.blob);
      if (await sha256Hex(bytes) !== copy.sha256) return null;
      return await withLocalWorkspaceTransaction(workspace, 'r', [], async () =>
        await hasAccess() && Boolean(await localDatabase.system.get(key)) ? new Uint8Array(bytes) : null);
    },
    async save(bytes: Uint8Array<ArrayBuffer>, task: AbortSignal) {
      task.throwIfAborted();
      const blob = new Blob([bytes]);
      const value = JSON.stringify({ sessionId: scope.sessionId, question: { ...question, canEdit: false }, sha256: await sha256Hex(await blob.arrayBuffer()), savedAt: Date.now() } satisfies Copy);
      await withLocalWorkspaceTransaction(workspace, 'rw', [], async () => {
        task.throwIfAborted();
        if (!await hasAccess()) return;
        await localDatabase.system.put({ key, value, blob });
        const copies = (await publishedQuestionFiles(workspace.ownerKey).toArray()).filter(row => row.blob)
          .sort((a, b) => (JSON.parse(b.value) as Copy).savedAt - (JSON.parse(a.value) as Copy).savedAt);
        let total = 0;
        await localDatabase.system.bulkDelete(copies.filter((row, index) => {
          total += row.blob!.size;
          return index >= MAX_COPIES || total > MAX_BYTES;
        }).map(row => row.key));
        task.throwIfAborted();
      });
    },
  };
}
