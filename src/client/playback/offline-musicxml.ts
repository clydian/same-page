import { musicXmlFiles } from '../platform/musicxml-files';
import { localDatabase } from '../platform/local-database';
import { createLocalWorkspace, captureLocalWorkspaceSession, withLocalWorkspaceTransaction, type LocalWorkspaceOwnerKey } from '../platform/local-workspace';
import { attachmentDirectoryFence, attachmentWorkspace, readAttachmentDirectory, clearAttachmentDirectories } from '../score-library/attachments/attachment-directory';
import { captureOfflineFileFence } from '../offline/local-files';
import { readLogoutFence } from '../auth/logout-fence';
import { findVerifiedOfflineScore, sha256Hex } from '../offline/offline-score-verification';
import { captureNavigationIdentity } from '../settings/navigation-events';
import type { PlaybackSource } from './playback-store';
import { offlinePlayerAssetsReady, prepareOfflinePlayerAssets } from './offline-player-assets';

const keyFor = (source: PlaybackSource, owner: string) => JSON.stringify(['offline-musicxml', owner, source.choirId, source.score.id, source.attachment.id, source.attachment.revision]);
export async function playbackWorkspace(source: PlaybackSource) {
  const base = await attachmentWorkspace(source.ownerKey.replace(/^experience:/, ''), source.choirId, source.score.id);
  if (!base) throw new Error('offline_identity_unavailable');
  return captureLocalWorkspaceSession(createLocalWorkspace((source.experience || source.ownerKey.startsWith('experience:') ? `experience:${base.ownerKey}` : base.ownerKey) as LocalWorkspaceOwnerKey, source.choirId, source.score.id));
}
/** Capture before authorization/download yields. Local files convey bytes, never authority. */
export async function captureMusicXmlAccess(source: PlaybackSource, signal: AbortSignal) {
  const current = captureNavigationIdentity();
  const workspace = await playbackWorkspace(source);
  const fence = await captureOfflineFileFence(workspace);
  const directoryFence = await attachmentDirectoryFence(workspace);
  // captureOfflineFileFence also verifies active owner and captured workspace
  // session epoch inside its read transaction; it is part of every current guard.
  const assertCurrent = async () => {
    signal.throwIfAborted();
    const logout = await readLogoutFence();
    if (!current() || directoryFence !== await attachmentDirectoryFence(workspace) || logout && workspace.ownerKey.replace(/^experience:/, '') === `user:${logout.userId}` || fence !== await captureOfflineFileFence(workspace)) throw new Error('offline_identity_changed');
    signal.throwIfAborted();
  };
  await assertCurrent();
  return {
    cacheIdentity: JSON.stringify([workspace.sessionEpoch, directoryFence, fence]),
    assertCurrent,
    async read() {
      await assertCurrent();
      const record = await withLocalWorkspaceTransaction(workspace, 'r', [], () => localDatabase.system.get(keyFor(source, workspace.ownerKey)));
      if (!record?.blob || record.blob.size !== source.attachment.sizeBytes) return null;
      const bytes = await record.blob.arrayBuffer();
      try { if (await sha256Hex(bytes) !== JSON.parse(record.value).sha256) return null; }
      catch { return null; }
      await assertCurrent();
      return new Uint8Array(bytes);
    },
    async save(bytes: Uint8Array, taskSignal?: AbortSignal) {
      taskSignal?.throwIfAborted();
      if (bytes.byteLength !== source.attachment.sizeBytes) throw new Error('musicxml_size_mismatch');
      const blob = new Blob([bytes.slice().buffer]);
      const sha256 = await sha256Hex(await blob.arrayBuffer());
      await withLocalWorkspaceTransaction(workspace, 'rw', [], async () => {
        await assertCurrent();
        taskSignal?.throwIfAborted();
        const key = keyFor(source, workspace.ownerKey);
        await localDatabase.system.put({ key, value: JSON.stringify({ sha256 }), blob });
        await musicXmlFiles({ ...workspace, attachmentId: source.attachment.id }).filter(record => record.key !== key).delete();
        await assertCurrent(); // Roll back if cancellation/navigation arrived during the writes.
        taskSignal?.throwIfAborted();
      });
    },
  };
}
export async function captureMusicXmlWrite(source: PlaybackSource, signal: AbortSignal) {
  return (await captureMusicXmlAccess(source, signal)).save;
}
/** Used only after fresh online metadata authorization by the source resolver. */
export function readStoredMusicXml(access: Awaited<ReturnType<typeof captureMusicXmlAccess>>) { return access.read(); }
// Private: capture all protected-content eligibility and its read lifetime. The
// caller separately establishes current public-bundle validity for this task.
async function captureOfflineMusicXmlRead(source: PlaybackSource, signal: AbortSignal) {
  const access = await captureMusicXmlAccess(source, signal);
  const workspace = await playbackWorkspace(source);
  const directory = await readAttachmentDirectory(workspace, source.score, source.score.attachmentCount === undefined);
  if (!directory?.some(item => item.id === source.attachment.id && item.scoreId === source.score.id && item.revision === source.attachment.revision && item.sizeBytes === source.attachment.sizeBytes && item.kind === 'musicxml' && !item.trashExpiresAt)) return null;
  // Retained PDF authority is required in addition to original-byte integrity.
  if (!await findVerifiedOfflineScore(workspace)) return null;
  return async () => { await access.assertCurrent(); return readStoredMusicXml(access); };
}
export async function readOfflineMusicXml(source: PlaybackSource, signal: AbortSignal = new AbortController().signal) {
  const read = await captureOfflineMusicXmlRead(source, signal);
  // Independent reads always audit the currently stored public bundle.
  if (!read || !await offlinePlayerAssetsReady()) return null;
  return read();
}
export async function revokeOfflineMusicXml(source: PlaybackSource) {
  const current = captureNavigationIdentity();
  const workspace = await playbackWorkspace(source);
  await withLocalWorkspaceTransaction(workspace, 'rw', [], async () => {
    if (!current()) return;
    await clearAttachmentDirectories(workspace);
    await musicXmlFiles({ ...workspace, attachmentId: source.attachment.id }).delete();
  });
}

export async function prepareOfflineMusicXml(source: PlaybackSource, save: () => Promise<void>, signal?: AbortSignal) {
  // Raw originals also accelerate online opens when the full offline bundle
  // is unavailable. Saving them must not depend on public asset preparation.
  signal?.throwIfAborted();
  await save();
  signal?.throwIfAborted();
  await prepareOfflinePlayerAssets(signal);
  // Only this preparation may reuse the public audit it has just awaited. The
  // private read still checks directory/PDF authority, raw SHA and all fences.
  const read = await captureOfflineMusicXmlRead(source, signal ?? new AbortController().signal);
  if (!read || !await read()) throw new Error('offline_musicxml_incomplete');
}
