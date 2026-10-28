import { Blob as NodeBlob } from 'node:buffer';
import { captureAttachmentDirectoryWrite } from '../score-library/attachments/attachment-directory';
import { captureMusicXmlAccess } from './offline-musicxml';
import { prepareOfflinePlayerAssets } from './offline-player-assets';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { localDatabase } from '../platform/local-database';
import { canAcceptUpdate, setUpdateRoute } from '../updates/update-safety';
import { SettingsRequestError } from '../settings/settings-request';
import { activateAuthenticatedLocalOwner, createLocalWorkspace, authenticatedLocalOwnerKey } from '../platform/local-workspace';
import { createPlayerSession } from '@same-page/player';
import { readAttachment } from '../score-library/attachments/api';
import { attachmentFetch } from '../score-library/attachments/request';
import { startPlayback, stopPlayback, playbackStore, type PlaybackSource } from './playback-store';
import { clearPlaybackPreparations } from './playback-preparation';
import { openMusicXmlPlayback, type MusicXmlOpeningSnapshot } from './musicxml-opening';

vi.mock('./offline-player-assets', () => ({ prepareOfflinePlayerAssets: vi.fn(async () => {}), offlinePlayerAssetsReady: async () => false }));
vi.mock('@same-page/player', () => ({ createPlayerSession: vi.fn() }));
vi.mock('../score-library/attachments/api', async original => ({ ...await original<typeof import('../score-library/attachments/api')>(), readAttachment: vi.fn() }));
vi.mock('../score-library/attachments/request', () => ({ attachmentFetch: vi.fn() }));
const input: PlaybackSource = {
  ownerKey: 'user:one', sessionId: 'session', choirId: 'drive',
  score: { id: 'score', choirId: 'drive', fileName: 'a.pdf', updatedAt: 1, attachmentCount: 1, currentVersion: { id: 'v', versionNumber: 1, sizeBytes: 1, sha256: 'hash', etag: 'etag', pageCount: 1, createdAt: 1 } },
  attachment: { id: 'xml', scoreId: 'score', kind: 'musicxml', name: 'a.xml', url: null, revision: 1, sizeBytes: 8, updatedAt: 1, trashExpiresAt: null },
};
let source: PlaybackSource;
let opening: ReturnType<typeof openMusicXmlPlayback>;
let snapshot: MusicXmlOpeningSnapshot;
const dispose = vi.fn();
function open() {
  opening = openMusicXmlPlayback({ source, container: document.createElement('div'), viewport: document.createElement('div') }, value => { snapshot = value; });
  return opening;
}
beforeEach(async () => {
  vi.stubGlobal('Blob', NodeBlob);
  await localDatabase.open();
  await activateAuthenticatedLocalOwner('one');
  vi.useFakeTimers(); vi.clearAllMocks();
  startPlayback(input); source = playbackStore.getSnapshot()!;
  vi.mocked(readAttachment).mockResolvedValue(source.attachment);
  vi.mocked(attachmentFetch).mockImplementation(async () => new Response('<score/>', { headers: { 'X-Attachment-Revision': '1' } }));
  vi.mocked(createPlayerSession).mockReturnValue({ dispose, subscribe: () => () => {}, getSnapshot: () => ({ status: 'ready' }) } as unknown as ReturnType<typeof createPlayerSession>);
});
afterEach(() => { opening?.dispose(); stopPlayback(); clearPlaybackPreparations(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it('retries a timed out opening without accepting its late result', async () => {
  let finishOld!: (value: typeof source.attachment) => void;
  vi.mocked(readAttachment).mockImplementationOnce(() => new Promise(done => { finishOld = done; }));
  open();
  await vi.advanceTimersByTimeAsync(180000);
  expect(snapshot.error).toBe('读取附件超时，请重试。');
  expect(snapshot.session).toBeNull();
  opening.retry();
  await vi.advanceTimersByTimeAsync(300);
  expect(snapshot.error).toBeNull();
  expect(snapshot.session).not.toBeNull();
  finishOld(source.attachment);
  await vi.advanceTimersByTimeAsync(0);
  expect(createPlayerSession).toHaveBeenCalledOnce();
});

it('authorizes the opening once and checks fresh authority on focus before stopping denied playback', async () => {
  open();
  await vi.advanceTimersByTimeAsync(300);
  expect(snapshot.session).not.toBeNull();
  expect(readAttachment).toHaveBeenCalledOnce();
  vi.mocked(readAttachment).mockRejectedValueOnce(new SettingsRequestError(403));
  window.dispatchEvent(new Event('focus'));
  await vi.advanceTimersByTimeAsync(0);
  expect(playbackStore.getSnapshot()).toBeNull();
  expect(dispose).toHaveBeenCalledOnce();
  expect(readAttachment).toHaveBeenCalledTimes(2);
});

it('prepares offline only after readable notation and a ready player, retaining playback when public resources fail', async () => {
  vi.useRealTimers();
  const saveDirectory = await captureAttachmentDirectoryWrite(createLocalWorkspace(authenticatedLocalOwnerKey('one'), 'drive', 'score'));
  await saveDirectory(source.score, [source.attachment], new AbortController().signal);
  let firstSystem = () => {};
  let notify = () => {};
  let state = { status: 'preparing' };
  vi.mocked(createPlayerSession).mockImplementation((_container, _bytes, options) => {
    firstSystem = options?.onFirstReadableSystem ?? (() => {});
    return { dispose, subscribe: (listener: () => void) => { notify = listener; return () => {}; }, getSnapshot: () => state } as unknown as ReturnType<typeof createPlayerSession>;
  });
  vi.mocked(prepareOfflinePlayerAssets).mockRejectedValue(new Error('public_bundle_unavailable'));
  open();
  await vi.waitFor(() => expect(snapshot.session).not.toBeNull());
  const player = snapshot.session;
  const access = await captureMusicXmlAccess(source, new AbortController().signal);
  state = { status: 'ready' }; notify();
  expect(await access.read()).toBeNull();
  firstSystem();
  await vi.waitFor(() => expect(snapshot.offlineStatus).toBe('failed'));
  expect(Array.from((await access.read())!)).toEqual([60, 115, 99, 111, 114, 101, 47, 62]);
  expect(snapshot.session).toBe(player);
  expect(snapshot.error).toBeNull();
});

it('releases a replaced playback immediately and ignores its late focus denial', async () => {
  open();
  await vi.advanceTimersByTimeAsync(300);
  let denyOld!: (reason: unknown) => void;
  vi.mocked(readAttachment).mockImplementationOnce(() => new Promise((_resolve, reject) => { denyOld = reject; }));
  window.dispatchEvent(new Event('focus'));
  startPlayback({ ...input, attachment: { ...input.attachment, id: 'replacement' } });
  const replacement = playbackStore.getSnapshot();
  expect(dispose).toHaveBeenCalledOnce();
  denyOld(new SettingsRequestError(403));
  await vi.advanceTimersByTimeAsync(0);
  expect(playbackStore.getSnapshot()).toBe(replacement);
  opening.dispose();
  expect(dispose).toHaveBeenCalledOnce();
});

it('does not let a pending focus check from a previous attempt revoke a successful retry', async () => {
  open();
  await vi.waitFor(() => expect(snapshot.session).not.toBeNull());
  let denyOld!: (reason: unknown) => void;
  vi.mocked(readAttachment).mockImplementationOnce(() => new Promise((_resolve, reject) => { denyOld = reject; }));
  window.dispatchEvent(new Event('focus'));
  opening.retry();
  await vi.waitFor(() => expect(snapshot.session).not.toBeNull());
  const player = snapshot.session;
  denyOld(new SettingsRequestError(403)); await vi.advanceTimersByTimeAsync(0);
  expect(snapshot.session).toBe(player);
  expect(playbackStore.getSnapshot()).toBe(source);
  expect(dispose).toHaveBeenCalledOnce();
});

it('keeps one offline task through playback changes and cancels it on an engine failure', async () => {
  vi.useRealTimers();
  const saveDirectory = await captureAttachmentDirectoryWrite(createLocalWorkspace(authenticatedLocalOwnerKey('one'), 'drive', 'score'));
  await saveDirectory(source.score, [source.attachment], new AbortController().signal);
  let firstSystem = () => {}, notify = () => {};
  let state = { status: 'preparing', playing: false };
  vi.mocked(createPlayerSession).mockImplementation((_container, _bytes, options) => {
    firstSystem = options?.onFirstReadableSystem ?? (() => {});
    return { dispose, subscribe: (listener: () => void) => { notify = listener; return () => {}; }, getSnapshot: () => state } as unknown as ReturnType<typeof createPlayerSession>;
  });
  let finishAssets!: () => void;
  vi.mocked(prepareOfflinePlayerAssets).mockImplementationOnce(() => new Promise(done => { finishAssets = done; }));
  open(); await vi.waitFor(() => expect(snapshot.session).not.toBeNull());
  // Readable notation may arrive before sound is ready.
  firstSystem();
  expect(prepareOfflinePlayerAssets).not.toHaveBeenCalled();
  state = { status: 'ready', playing: false }; notify();
  await vi.waitFor(() => expect(prepareOfflinePlayerAssets).toHaveBeenCalledOnce());
  const taskSignal = vi.mocked(prepareOfflinePlayerAssets).mock.calls[0][0];
  state = { status: 'ready', playing: true }; notify();
  state = { status: 'ready', playing: false }; notify();
  expect(taskSignal?.aborted).toBe(false);
  expect(prepareOfflinePlayerAssets).toHaveBeenCalledOnce();
  state = { status: 'error', playing: false }; notify();
  expect(taskSignal?.aborted).toBe(true);
  finishAssets(); await Promise.resolve();
  expect(snapshot.offlineStatus).not.toBe('ready');
});

it('continues fresh authority checks after the reading deadline has expired', async () => {
  vi.mocked(readAttachment).mockImplementationOnce(() => new Promise(() => {}));
  open(); await vi.advanceTimersByTimeAsync(180000);
  expect(snapshot.error).toBe('读取附件超时，请重试。');
  vi.mocked(readAttachment).mockRejectedValueOnce(new SettingsRequestError(403));
  window.dispatchEvent(new Event('focus')); await vi.advanceTimersByTimeAsync(0);
  expect(playbackStore.getSnapshot()).toBeNull();
});

it('keeps the update veto across retries and releases it and listeners exactly once on dispose', async () => {
  setUpdateRoute('/about');
  open();
  await vi.waitFor(() => expect(snapshot.session).not.toBeNull());
  expect(canAcceptUpdate(true)).toBe(false);
  opening.retry();
  await vi.waitFor(() => expect(snapshot.session).not.toBeNull());
  expect(canAcceptUpdate(true)).toBe(false);
  opening.dispose(); opening.dispose();
  expect(canAcceptUpdate(true)).toBe(true);
  const requests = vi.mocked(readAttachment).mock.calls.length;
  window.dispatchEvent(new Event('focus'));
  opening.retry(); opening.retryOffline();
  await vi.advanceTimersByTimeAsync(0);
  expect(readAttachment).toHaveBeenCalledTimes(requests);
  expect(dispose).toHaveBeenCalledTimes(2);
});
