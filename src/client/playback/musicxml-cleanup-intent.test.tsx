import { Blob as NodeBlob } from 'node:buffer';
import { waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { openMusicXmlPlayback, type MusicXmlOpeningSnapshot } from './musicxml-opening';
import { startPlayback, stopPlayback, playbackStore } from './playback-store';
import { createPlayerSession } from '@same-page/player';
import { readAttachment } from '../score-library/attachments/api';
import { attachmentFetch } from '../score-library/attachments/request';
import { captureMusicXmlAccess } from './offline-musicxml';
import { clearPlaybackPreparations } from './playback-preparation';
import { localDatabase } from '../platform/local-database';
import { activateAuthenticatedLocalOwner, createLocalWorkspace } from '../platform/local-workspace';
import { captureAttachmentDirectoryWrite } from '../score-library/attachments/attachment-directory';
import { clearLocalFiles } from '../offline/local-files';
import { musicXmlFiles } from '../platform/musicxml-files';
import type { PlaybackSource } from './playback-store';

vi.mock('@same-page/player', () => ({ createPlayerSession: vi.fn() }));
vi.mock('../score-library/attachments/api', () => ({ readAttachment: vi.fn(), attachmentFileUrl: () => '/file' }));
vi.mock('../score-library/attachments/request', () => ({ attachmentFetch: vi.fn() }));
vi.mock('./offline-musicxml', async original => {
  const actual = await original<typeof import('./offline-musicxml')>();
  return { ...actual, captureMusicXmlAccess: vi.fn(actual.captureMusicXmlAccess) };
});
vi.mock('./offline-player-assets', () => ({ prepareOfflinePlayerAssets: async () => { throw new Error('public_bundle_unavailable'); }, offlinePlayerAssetsReady: async () => false }));
vi.mock('../offline/offline-score-verification', async original => ({ ...await original<typeof import('../offline/offline-score-verification')>(), findVerifiedOfflineScore: async () => ({}) }));
const inputSource: PlaybackSource = { ownerKey: 'user:one', sessionId: 'session', choirId: 'drive', score: { id: 'score', choirId: 'drive', fileName: 'a.pdf', updatedAt: 1, attachmentCount: 1, currentVersion: { id: 'v', versionNumber: 1, sizeBytes: 1, sha256: 'hash', etag: 'etag', pageCount: 1, createdAt: 1 } }, attachment: { id: 'a', scoreId: 'score', kind: 'musicxml', name: 'a.xml', url: null, revision: 1, sizeBytes: 4, updatedAt: 1, trashExpiresAt: null } };
const bytes = new Uint8Array([80, 75, 3, 4]);
const signal = () => new AbortController().signal;
let source: PlaybackSource;
let opening: ReturnType<typeof openMusicXmlPlayback>;
let snapshot: MusicXmlOpeningSnapshot;
let firstSystem: () => void, notify: () => void, finishFile: (response: Response) => void;
let state: { status: 'preparing' | 'ready' };
let captureActual: typeof captureMusicXmlAccess;
beforeEach(async () => {
  vi.clearAllMocks(); clearPlaybackPreparations(); vi.stubGlobal('Blob', NodeBlob);
  const actual = await vi.importActual<typeof import('./offline-musicxml')>('./offline-musicxml');
  captureActual = actual.captureMusicXmlAccess;
  vi.mocked(captureMusicXmlAccess).mockImplementation(captureActual).mockImplementationOnce(() => new Promise(() => {}));
  await localDatabase.open(); await activateAuthenticatedLocalOwner('one');
  startPlayback(inputSource); source = playbackStore.getSnapshot()!;
  await (await captureAttachmentDirectoryWrite(createLocalWorkspace('user:one' as never, 'drive', 'score')))(source.score, [source.attachment], signal());
  vi.mocked(readAttachment).mockResolvedValue(source.attachment);
  vi.mocked(attachmentFetch).mockImplementation(() => new Promise(done => { finishFile = done; }));
  state = { status: 'preparing' };
  vi.mocked(createPlayerSession).mockImplementation((_element, _bytes, options) => {
    firstSystem = options?.onFirstReadableSystem ?? (() => {});
    return { dispose() {}, getSnapshot: () => state, subscribe: (listener: () => void) => { notify = listener; return () => {}; } } as unknown as ReturnType<typeof createPlayerSession>;
  });
});
afterEach(() => { opening?.dispose(); stopPlayback(); clearPlaybackPreparations(); vi.unstubAllGlobals(); });
async function openWithTimedOutLocalStorage() {
  opening = openMusicXmlPlayback({ source, container: document.createElement('div'), viewport: document.createElement('div') }, value => { snapshot = value; });
  await waitFor(() => expect(attachmentFetch).toHaveBeenCalledOnce());
}
async function finishOpening() {
  finishFile(new Response(bytes.slice(), { headers: { 'X-Attachment-Revision': '1' } }));
  await waitFor(() => expect(createPlayerSession).toHaveBeenCalledOnce());
  state = { status: 'ready' }; firstSystem(); notify();
  await waitFor(() => expect(snapshot.offlineStatus).toBe('failed'));
}
it('does not restore a cleaned raw original automatically after local timeout and a late network/worker result', async () => {
  await openWithTimedOutLocalStorage();
  await clearLocalFiles({ ownerKey: 'user:one' as never });
  await finishOpening();
  expect(await musicXmlFiles({ ownerKey: 'user:one' }).count()).toBe(0);
  expect(captureMusicXmlAccess).toHaveBeenCalledOnce();
});
it('allows an explicit offline retry to capture a new intent after cleanup without reopening or downloading again', async () => {
  await openWithTimedOutLocalStorage();
  await clearLocalFiles({ ownerKey: 'user:one' as never });
  await finishOpening();
  opening.retryOffline();
  await waitFor(async () => expect(await musicXmlFiles({ ownerKey: 'user:one' }).count()).toBe(1));
  expect(captureMusicXmlAccess).toHaveBeenCalledTimes(2);
  expect(readAttachment).toHaveBeenCalledTimes(2);
  expect(attachmentFetch).toHaveBeenCalledOnce(); expect(createPlayerSession).toHaveBeenCalledOnce();
});
it('captures the explicit retry cleanup fence before its fresh metadata read and rejects cleanup during that read', async () => {
  await openWithTimedOutLocalStorage(); await finishOpening();
  let completeMetadata!: (attachment: typeof source.attachment) => void;
  vi.mocked(readAttachment).mockImplementationOnce(() => new Promise(done => { completeMetadata = done; }));
  opening.retryOffline();
  await waitFor(() => expect(completeMetadata).toBeTypeOf('function'));
  expect(captureMusicXmlAccess).toHaveBeenCalledTimes(2);
  // Finish the real workspace/fence capture while metadata is still pending.
  await vi.mocked(captureMusicXmlAccess).mock.results[1].value;
  await clearLocalFiles({ ownerKey: 'user:one' as never });
  completeMetadata(source.attachment);
  await waitFor(() => expect(snapshot.offlineStatus).toBe('failed'));
  expect(await musicXmlFiles({ ownerKey: 'user:one' }).count()).toBe(0);
});
