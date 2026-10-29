import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readAttachment } from '../score-library/attachments/api';
import { attachmentFetch } from '../score-library/attachments/request';
import { SettingsRequestError } from '../settings/settings-request';
import { resetNavigation } from '../settings/navigation-events';
import { captureMusicXmlAccess, readOfflineMusicXml, readStoredMusicXml, revokeOfflineMusicXml } from './offline-musicxml';
import { acquirePlaybackPreparation, clearPlaybackPreparations, savePlaybackPreparation } from './playback-preparation';
import { readPlaybackAttachment, resolveMusicXmlSource } from './musicxml-source';
import type { PlaybackSource } from './playback-store';

vi.mock('../score-library/attachments/api', () => ({ readAttachment: vi.fn(), attachmentFileUrl: () => '/file?' }));
vi.mock('../score-library/attachments/request', () => ({ attachmentFetch: vi.fn() }));
vi.mock('./offline-musicxml', () => ({ captureMusicXmlAccess: vi.fn(), readStoredMusicXml: vi.fn(), readOfflineMusicXml: vi.fn(), revokeOfflineMusicXml: vi.fn() }));
const original: PlaybackSource = { ownerKey: 'user:one', sessionId: 'one', choirId: 'drive', score: { id: 'score', choirId: 'drive', fileName: 'a.pdf', updatedAt: 1, currentVersion: { id: 'v', versionNumber: 1, sizeBytes: 1, sha256: 'hash', etag: 'etag', pageCount: 1, createdAt: 1 } }, attachment: { id: 'a', scoreId: 'score', kind: 'musicxml', name: 'a.xml', url: null, revision: 1, sizeBytes: 4, updatedAt: 1, trashExpiresAt: null } };
const bytes = new Uint8Array([1, 2, 3, 4]);
const access = { cacheIdentity: 'fence', assertCurrent: vi.fn(async () => {}), read: vi.fn(), save: vi.fn(async () => {}) };
let source: PlaybackSource;
let leases: ReturnType<typeof acquirePlaybackPreparation>[];
const signal = () => new AbortController().signal;
function resolve(input = source, abort = signal()) { const lease = acquirePlaybackPreparation(input); leases.push(lease); return resolveMusicXmlSource(input, abort, lease); }
beforeEach(() => {
  vi.clearAllMocks(); source = { ...original }; leases = [];
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  vi.mocked(readAttachment).mockResolvedValue(source.attachment);
  vi.mocked(captureMusicXmlAccess).mockResolvedValue(access);
  vi.mocked(readStoredMusicXml).mockResolvedValue(null);
  vi.mocked(readOfflineMusicXml).mockResolvedValue(null);
  vi.mocked(revokeOfflineMusicXml).mockResolvedValue(undefined);
  vi.mocked(attachmentFetch).mockImplementation(async () => new Response(bytes.slice(), { headers: { 'X-Attachment-Revision': '1' } }));
});
afterEach(() => { for (const lease of leases) lease.release(); clearPlaybackPreparations(); vi.useRealTimers(); vi.restoreAllMocks(); });
it('authorizes before choosing prepared input and never reads raw storage on a prepared hit', async () => {
  savePlaybackPreparation(source, bytes, undefined, access.cacheIdentity);
  const result = await resolve();
  expect(result.tier).toBe('prepared'); expect(result.bytes).toBe(bytes);
  expect(readAttachment).toHaveBeenCalledOnce(); expect(readStoredMusicXml).not.toHaveBeenCalled(); expect(attachmentFetch).not.toHaveBeenCalled();
});
it('reuses a validated stored original online without requiring offline eligibility', async () => {
  vi.mocked(readStoredMusicXml).mockResolvedValue(bytes);
  const result = await resolve();
  expect(result.tier).toBe('local'); expect(result.bytes).toEqual(bytes);
  expect(readOfflineMusicXml).not.toHaveBeenCalled(); expect(attachmentFetch).not.toHaveBeenCalled();
});
it.each([null, 'corrupt'])('misses unavailable or damaged local input (%s) and locks network revision', async value => {
  if (value) vi.mocked(readStoredMusicXml).mockRejectedValue(new Error('corrupt'));
  const result = await resolve(); expect(result.tier).toBe('network');
  expect(attachmentFetch).toHaveBeenCalledWith('/file?&revision=1', expect.objectContaining({ signal: expect.any(AbortSignal) }));
});
it('bounds a hung local read and ignores its result after the network source wins', async () => {
  vi.useFakeTimers(); let finishLocal!: (value: Uint8Array<ArrayBuffer>) => void;
  vi.mocked(readStoredMusicXml).mockImplementation(() => new Promise(done => { finishLocal = done; }));
  const result = resolve(); await vi.advanceTimersByTimeAsync(249); expect(attachmentFetch).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1); expect((await result).tier).toBe('network');
  finishLocal(new Uint8Array([9, 9, 9, 9])); await Promise.resolve();
  expect((await result).bytes).toEqual(bytes); expect(attachmentFetch).toHaveBeenCalledOnce();
});
it.each([401, 403, 404])('a metadata denial %s never chooses cached or offline input', async status => {
  savePlaybackPreparation(source, bytes, undefined, access.cacheIdentity); vi.mocked(readAttachment).mockRejectedValue(new SettingsRequestError(status));
  await expect(resolve()).rejects.toBeInstanceOf(SettingsRequestError);
  expect(revokeOfflineMusicXml).toHaveBeenCalledWith(source); expect(readOfflineMusicXml).not.toHaveBeenCalled(); expect(readStoredMusicXml).not.toHaveBeenCalled();
});
it.each(['id', 'scoreId', 'kind', 'revision', 'sizeBytes', 'trashExpiresAt'])('rejects changed metadata %s without offline fallback', async field => {
  const changed = { ...source.attachment, [field]: field === 'revision' || field === 'sizeBytes' || field === 'trashExpiresAt' ? 99 : 'other' };
  vi.mocked(readAttachment).mockResolvedValue(changed);
  await expect(resolve()).rejects.toThrow('附件已更新'); expect(readOfflineMusicXml).not.toHaveBeenCalled(); expect(attachmentFetch).not.toHaveBeenCalled();
});
it.each([undefined, '', 'invalid', '0', '1.5', '9007199254740992'])('rejects an unverifiable response revision (%s) without claiming an update or using old bytes', async revision => {
  vi.mocked(readOfflineMusicXml).mockResolvedValue(bytes);
  vi.mocked(attachmentFetch).mockResolvedValue(new Response(bytes.slice(), { headers: revision === undefined ? {} : { 'X-Attachment-Revision': revision } }));
  await expect(resolve()).rejects.toThrow('暂时无法校验附件版本'); expect(readOfflineMusicXml).not.toHaveBeenCalled(); expect(access.save).not.toHaveBeenCalled();
});
it('rejects an explicitly changed response revision, preserving metadata-to-file consistency', async () => {
  vi.mocked(readOfflineMusicXml).mockResolvedValue(bytes);
  vi.mocked(attachmentFetch).mockResolvedValue(new Response(bytes.slice(), { headers: { 'X-Attachment-Revision': '2' } }));
  await expect(resolve()).rejects.toThrow('附件已更新'); expect(readOfflineMusicXml).not.toHaveBeenCalled();
});
it.each([401, 403, 404, 409])('a file rejection %s never accepts an available offline original', async status => {
  vi.mocked(readOfflineMusicXml).mockResolvedValue(bytes);
  vi.mocked(attachmentFetch).mockResolvedValue(new Response(null, { status }));
  await expect(resolve()).rejects.toMatchObject({ status });
  expect(readOfflineMusicXml).not.toHaveBeenCalled(); expect(access.save).not.toHaveBeenCalled();
  expect(revokeOfflineMusicXml).toHaveBeenCalledTimes(status === 409 ? 0 : 1);
});
it('rejects malformed metadata and original length without selecting old content', async () => {
  vi.mocked(readAttachment).mockRejectedValueOnce(new Error('invalid schema'));
  await expect(resolve()).rejects.toThrow('invalid schema');
  vi.mocked(attachmentFetch).mockResolvedValue(new Response(new Uint8Array([1]), { headers: { 'X-Attachment-Revision': '1' } }));
  await expect(resolve()).rejects.toThrow('musicxml_size_mismatch'); expect(readOfflineMusicXml).not.toHaveBeenCalled();
});
it.each(['metadata', 'file', 'offline'])('temporary %s failure uses the full offline eligibility gate', async stage => {
  if (stage === 'metadata') vi.mocked(readAttachment).mockRejectedValue(new SettingsRequestError(503));
  else if (stage === 'offline') vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  else vi.mocked(attachmentFetch).mockRejectedValue(new TypeError('network'));
  vi.mocked(readOfflineMusicXml).mockResolvedValue(bytes);
  expect((await resolve()).tier).toBe('offline'); expect(readOfflineMusicXml).toHaveBeenCalledWith(source, expect.any(AbortSignal));
});
it('rejects a late local result after navigation changes, and never falls through to network', async () => {
  let complete!: (value: Uint8Array<ArrayBuffer>) => void;
  vi.mocked(readStoredMusicXml).mockImplementation(() => new Promise(done => { complete = done; }));
  const result = resolve(); await vi.waitFor(() => expect(readStoredMusicXml).toHaveBeenCalledOnce());
  resetNavigation(); complete(bytes);
  await expect(result).rejects.toThrow('offline_identity_changed'); expect(attachmentFetch).not.toHaveBeenCalled();
});
it('joins only in-flight metadata for this explicit opening and cancellation keeps another consumer alive', async () => {
  let complete!: (value: typeof source.attachment) => void;
  let underlying!: AbortSignal;
  vi.mocked(readAttachment).mockImplementation((_drive, _score, _id, input) => { underlying = input!; return new Promise(done => { complete = done; }); });
  const firstAbort = new AbortController();
  const first = readPlaybackAttachment(source, firstAbort.signal).catch(reason => reason);
  const second = readPlaybackAttachment(source, signal());
  firstAbort.abort(); expect(underlying.aborted).toBe(false); complete(source.attachment);
  await expect(second).resolves.toEqual(source.attachment); await first; expect(readAttachment).toHaveBeenCalledOnce();
  vi.mocked(readAttachment).mockResolvedValue(source.attachment);
  await readPlaybackAttachment(source, signal()); await readPlaybackAttachment({ ...source }, signal()); expect(readAttachment).toHaveBeenCalledTimes(3);
});
it('aborts the shared metadata request after its last consumer leaves and ignores late completion', async () => {
  let underlying!: AbortSignal; let complete!: (value: typeof source.attachment) => void;
  vi.mocked(readAttachment).mockImplementation((_drive, _score, _id, input) => { underlying = input!; return new Promise(done => { complete = done; }); });
  const abort = new AbortController(); const pending = readPlaybackAttachment(source, abort.signal).catch(reason => reason);
  abort.abort(); expect(underlying.aborted).toBe(true); complete(source.attachment); await expect(pending).resolves.toMatchObject({name:'AbortError'});
});
it('expires a hung shared metadata request even when a lifetime consumer remains, allowing a fresh retry', async () => {
 vi.useFakeTimers();
 vi.mocked(readAttachment).mockImplementationOnce(()=>new Promise(()=>{})).mockResolvedValue(source.attachment);
 const lifetime=readPlaybackAttachment(source,signal()).catch(reason=>reason);
 const opening=readPlaybackAttachment(source,signal()).catch(reason=>reason);
 await vi.advanceTimersByTimeAsync(180_000);
 await expect(lifetime).resolves.toMatchObject({message:'读取附件超时，请重试。'});
 await expect(opening).resolves.toMatchObject({message:'读取附件超时，请重试。'});
 await expect(readPlaybackAttachment(source,signal())).resolves.toEqual(source.attachment);
 expect(readAttachment).toHaveBeenCalledTimes(2);
});
it.each(['capture','first-fence','final-fence'])('bounds the entire local preparation when %s hangs and discards every local capability',async stage=>{
 vi.useFakeTimers();
 let complete!:()=>void;
 if(stage==='capture') vi.mocked(captureMusicXmlAccess).mockImplementationOnce(()=>new Promise(done=>{complete=()=>done(access);}));
 else {
  if(stage==='final-fence') access.assertCurrent.mockResolvedValueOnce(undefined);
  access.assertCurrent.mockImplementationOnce(()=>new Promise<void>(done=>{complete=done;}));
 }
 const pending=resolve();
 await vi.advanceTimersByTimeAsync(250);
 const result=await pending;
 expect(result.tier).toBe('network');expect(result.save).toBeTypeOf('function');expect(result.prepared).toBeUndefined();expect(result.assertCurrent).toBeUndefined();
 expect(attachmentFetch).toHaveBeenCalledOnce();
 expect(vi.mocked(captureMusicXmlAccess).mock.calls[0][1].aborted).toBe(true);
 complete();await Promise.resolve();await Promise.resolve();
 expect(access.save).not.toHaveBeenCalled();expect(attachmentFetch).toHaveBeenCalledOnce();
});
it('retries saving downloaded bytes with fresh authorization and a new bounded workspace after a local timeout',async()=>{
 vi.useFakeTimers();
 vi.mocked(captureMusicXmlAccess).mockImplementationOnce(()=>new Promise(()=>{})).mockRejectedValueOnce(new Error('storage_unavailable')).mockResolvedValue(access);
 const opening=resolve();await vi.advanceTimersByTimeAsync(250);const result=await opening;
 await expect(result.save!(result.bytes,signal())).rejects.toThrow('storage_unavailable');
 await result.save!(result.bytes,signal());
 expect(access.save).toHaveBeenCalledWith(bytes,expect.any(AbortSignal));
 expect(readAttachment).toHaveBeenCalledTimes(2);expect(attachmentFetch).toHaveBeenCalledOnce();
 expect(result.assertCurrent).toBeUndefined();expect(result.cacheIdentity).toBeUndefined();
});
it.each(['revision','identity'])('does not save network bytes on a later %s change after the original local timeout',async change=>{
 vi.useFakeTimers();vi.mocked(captureMusicXmlAccess).mockImplementationOnce(()=>new Promise(()=>{}));
 const opening=resolve();await vi.advanceTimersByTimeAsync(250);const result=await opening;
 if(change==='revision') vi.mocked(readAttachment).mockResolvedValue({...source.attachment,revision:2});
 else resetNavigation();
 await expect(result.save!(result.bytes,signal())).rejects.toThrow(change==='revision'?'附件已更新':'offline_identity_changed');
 expect(access.save).not.toHaveBeenCalled();expect(captureMusicXmlAccess).toHaveBeenCalledTimes(change==='revision'?2:1);
});
it.each(['offline_identity_changed','local_workspace_owner_changed'])('rejects a captured %s fence change while the original network request is in flight',async message=>{
 let complete!:(response:Response)=>void;
 vi.mocked(attachmentFetch).mockImplementationOnce(()=>new Promise(done=>{complete=done;}));
 const opening=resolve();await vi.waitFor(()=>expect(attachmentFetch).toHaveBeenCalledOnce());
 access.assertCurrent.mockRejectedValueOnce(new Error(message));
 complete(new Response(bytes.slice(),{headers:{'X-Attachment-Revision':'1'}}));
 await expect(opening).rejects.toThrow(message);expect(readOfflineMusicXml).not.toHaveBeenCalled();expect(access.save).not.toHaveBeenCalled();
});
it('bounds a captured final network identity guard and rejects instead of silently bypassing it',async()=>{
 vi.useFakeTimers();
 access.assertCurrent.mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockImplementationOnce(()=>new Promise(()=>{}));
 const opening=resolve().catch(reason=>reason);
 await vi.advanceTimersByTimeAsync(250);
 await expect(opening).resolves.toMatchObject({message:'本机状态校验未完成，请重试。'});
 expect(readOfflineMusicXml).not.toHaveBeenCalled();expect(access.save).not.toHaveBeenCalled();
 expect(vi.mocked(captureMusicXmlAccess).mock.calls[0][1].aborted).toBe(true);
});

it('reports authorized original download progress from received bytes', async () => {
 const updates: unknown[] = [];
 vi.mocked(attachmentFetch).mockImplementation(async () => new Response(new ReadableStream({start(controller) {
  controller.enqueue(new Uint8Array([1,2]));controller.enqueue(new Uint8Array([3,4]));controller.close();
 }}), {headers:{'X-Attachment-Revision':'1'}}));
 const lease=acquirePlaybackPreparation(source);leases.push(lease);
 const result=await resolveMusicXmlSource(source,signal(),lease,undefined,progress=>updates.push(progress));
 expect(result.bytes).toEqual(bytes);
 expect(updates).toEqual([{phase:'access'},{phase:'local'},{phase:'download',loaded:0,total:4},{phase:'download',loaded:2,total:4},{phase:'download',loaded:4,total:4}]);
});
it('cancels a stalled original stream without accepting bytes or offline fallback', async () => {
 const cancel = vi.fn(), abort = new AbortController();
 let stream!: ReadableStreamDefaultController<Uint8Array>;
 vi.mocked(attachmentFetch).mockImplementation(async () => new Response(new ReadableStream<Uint8Array>({
  start(controller) { stream = controller; }, cancel,
 }), { headers: { 'X-Attachment-Revision': '1' } }));
 const updates: unknown[] = [], lease = acquirePlaybackPreparation(source); leases.push(lease);
 const result = resolveMusicXmlSource(source, abort.signal, lease, undefined, progress => updates.push(progress));
 const rejection = expect(result).rejects.toThrow('cancelled');
 await vi.waitFor(() => expect(updates).toContainEqual({ phase: 'download', loaded: 0, total: 4 }));
 stream.enqueue(new Uint8Array([1, 2]));
 await vi.waitFor(() => expect(updates).toContainEqual({ phase: 'download', loaded: 2, total: 4 }));
 abort.abort(new Error('cancelled'));
 await rejection;
 expect(cancel).toHaveBeenCalledOnce(); expect(readOfflineMusicXml).not.toHaveBeenCalled();
 expect(updates).not.toContainEqual({ phase: 'download', loaded: 4, total: 4 });
});
