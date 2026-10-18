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

const keyFor = (source: PlaybackSource, owner: string) => JSON.stringify(["offline-musicxml", owner, source.choirId, source.score.id, source.attachment.id, source.attachment.revision]);
export async function playbackWorkspace(source: PlaybackSource) {
  const base = await attachmentWorkspace(source.ownerKey.replace(/^experience:/, ""), source.choirId, source.score.id);
  if (!base) throw new Error('offline_identity_unavailable');
  return captureLocalWorkspaceSession(createLocalWorkspace((source.experience || source.ownerKey.startsWith("experience:") ? `experience:${base.ownerKey}` : base.ownerKey) as LocalWorkspaceOwnerKey, source.choirId, source.score.id));
}
export async function captureMusicXmlWrite(source: PlaybackSource, signal: AbortSignal) {
  const current = captureNavigationIdentity();
  const workspace = await playbackWorkspace(source);
  const fence = await captureOfflineFileFence(workspace);
  const directoryFence = await attachmentDirectoryFence(workspace);
  return async (bytes: Uint8Array) => {
    if (bytes.byteLength !== source.attachment.sizeBytes) throw new Error('musicxml_size_mismatch');
    const blob = new Blob([bytes.slice().buffer]);
    const sha256 = await sha256Hex(await blob.arrayBuffer());
    await withLocalWorkspaceTransaction(workspace, 'rw', [], async () => {
      signal.throwIfAborted();
      const logout = await readLogoutFence();
      if (!current() || directoryFence !== await attachmentDirectoryFence(workspace) || logout && workspace.ownerKey.replace(/^experience:/, '') === `user:${logout.userId}` || fence !== await captureOfflineFileFence(workspace)) throw new Error('offline_identity_changed');
      const key = keyFor(source, workspace.ownerKey);
      await localDatabase.system.put({ key, value: JSON.stringify({ sha256 }), blob });
      await musicXmlFiles({ ...workspace, attachmentId: source.attachment.id }).filter(record => record.key !== key).delete();
    });
  };
}
export async function readOfflineMusicXml(source: PlaybackSource) {
  const workspace = await playbackWorkspace(source);
  const directory = await readAttachmentDirectory(workspace, source.score, source.score.attachmentCount === undefined);
  if (!directory?.some(item => item.id === source.attachment.id && item.revision === source.attachment.revision && item.kind === 'musicxml' && !item.trashExpiresAt)) return null;
  // Reuse the same verified retained-score authority as offline reading.
  if (!await findVerifiedOfflineScore(workspace) || !await offlinePlayerAssetsReady()) return null;
  const record = await withLocalWorkspaceTransaction(workspace, 'r', [], () => localDatabase.system.get(keyFor(source, workspace.ownerKey)));
  if (!record?.blob || record.blob.size !== source.attachment.sizeBytes) return null;
  const bytes = await record.blob.arrayBuffer();
  try { if (await sha256Hex(bytes) !== JSON.parse(record.value).sha256) return null; }
  catch { return null; }
  await withLocalWorkspaceTransaction(workspace, 'r', [], async () => {
    const logout = await readLogoutFence();
    if (logout && workspace.ownerKey.replace(/^experience:/, '') === `user:${logout.userId}`) throw new Error('offline_identity_changed');
  });
  return new Uint8Array(bytes);
}
export async function revokeOfflineMusicXml(source: PlaybackSource) {
  const workspace = await playbackWorkspace(source);
  await clearAttachmentDirectories(workspace);
  await withLocalWorkspaceTransaction(workspace, 'rw', [], () => musicXmlFiles({ ...workspace, attachmentId: source.attachment.id }).delete());
}
export async function prepareOfflineMusicXml(source: PlaybackSource, save: () => Promise<void>) {
  await prepareOfflinePlayerAssets();
  await save();
  if (!await readOfflineMusicXml(source)) throw new Error('offline_musicxml_incomplete');
}
