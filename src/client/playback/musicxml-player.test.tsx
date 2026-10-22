import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import MusicXmlPlayer from './musicxml-player';
import { readAttachment } from '../score-library/attachments/api';
import { attachmentFetch } from '../score-library/attachments/request';
import { createPlayerSession } from '@same-page/player';
import { musicXmlLoadingTracker } from './musicxml-loading';
import { captureMusicXmlAccess, prepareOfflineMusicXml } from './offline-musicxml';
import type { PlaybackSource } from './playback-store';

vi.mock('./musicxml-loading', () => ({ musicXmlLoadingTracker: vi.fn(() => ({ stage: vi.fn(), source: vi.fn(), end: vi.fn() })) }));
vi.mock('./use-playback-lifetime', () => ({ usePlaybackLifetime: vi.fn() }));
vi.mock('../score-library/attachments/api', () => ({ readAttachment: vi.fn(), attachmentFileUrl: () => '/file' }));
vi.mock('../score-library/attachments/request', () => ({ attachmentFetch: vi.fn() }));
vi.mock('@same-page/player', () => ({ createPlayerSession: vi.fn() }));
vi.mock('./offline-musicxml', () => ({ captureMusicXmlAccess: vi.fn(async () => null), readStoredMusicXml: async () => null, readOfflineMusicXml: async () => null, revokeOfflineMusicXml: vi.fn(), prepareOfflineMusicXml: vi.fn() }));
vi.mock('./musicxml-practice', () => ({ MusicXmlPractice: ({ error, retry, session, container, viewport }: { error: string | null; retry(): void; session: unknown; container: React.RefObject<HTMLDivElement>; viewport: React.RefObject<HTMLDivElement> }) => <div ref={viewport}><div ref={container} /><p>{error ?? (session ? '已就绪' : '准备中')}</p><button onClick={retry}>重试</button></div> }));
const source = { choirId: 'drive', ownerKey: 'user:one', sessionId: 'session', score: { id: 'score' }, attachment: { id: 'xml', scoreId: 'score', kind: 'musicxml', revision: 1, sizeBytes: 8 } } as PlaybackSource;
const dispose = vi.fn();
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks();
  vi.mocked(createPlayerSession).mockReturnValue({ dispose, subscribe: () => () => {}, getSnapshot: () => ({ status: 'ready' }) } as unknown as ReturnType<typeof createPlayerSession>);
  vi.mocked(prepareOfflineMusicXml).mockResolvedValue(undefined);
  vi.mocked(captureMusicXmlAccess).mockRejectedValue(new Error('storage_unavailable'));
  vi.mocked(attachmentFetch).mockImplementation(async () => new Response('<score/>', { headers: { 'X-Attachment-Revision': '1' } }));
});
afterEach(() => { cleanup(); vi.useRealTimers(); });
const stallUntilAbort = (_drive: string, _score: string, _id: string, signal?: AbortSignal) => new Promise<never>((_resolve, reject) => signal?.addEventListener('abort', () => reject(signal.reason), { once: true }));
it('turns a read timeout into a retryable failure, and a retry creates only one new session', async () => {
  vi.mocked(readAttachment).mockImplementationOnce(stallUntilAbort).mockResolvedValue({ ...source.attachment, trashExpiresAt: null });
  render(<MusicXmlPlayer source={source} />);
  await act(async () => {});
  await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
  expect(screen.getByText('读取附件超时，请重试。')).toBeInTheDocument();
  expect(createPlayerSession).not.toHaveBeenCalled();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '重试' })); });
  expect(screen.getByText('已就绪')).toBeInTheDocument();
  expect(createPlayerSession).toHaveBeenCalledOnce();
});
it('abandoning an in-flight read is silent and never creates a late session', async () => {
  let resolve!: (value: Awaited<ReturnType<typeof readAttachment>>) => void;
  vi.mocked(readAttachment).mockImplementation(() => new Promise(done => { resolve = done; }));
  const { unmount } = render(<MusicXmlPlayer source={source} />);
  await act(async () => {});
  unmount();
  await act(async () => { resolve({ ...source.attachment, trashExpiresAt: null }); await vi.advanceTimersByTimeAsync(60000); });
  expect(createPlayerSession).not.toHaveBeenCalled();
});

it('shows the deadline even when a reader ignores abort, and rejects its late result after retry', async () => {
  let resolveOld!: (value: Awaited<ReturnType<typeof readAttachment>>) => void;
  vi.mocked(readAttachment).mockImplementationOnce(() => new Promise(done => { resolveOld = done; })).mockResolvedValue({ ...source.attachment, trashExpiresAt: null });
  render(<MusicXmlPlayer source={source} />);
  await act(async () => {});
  await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
  expect(screen.getByText('读取附件超时，请重试。')).toBeInTheDocument();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '重试' })); });
  expect(screen.getByText('已就绪')).toBeInTheDocument();
  await act(async () => { resolveOld({ ...source.attachment, trashExpiresAt: null }); });
  expect(screen.getByText('已就绪')).toBeInTheDocument();
  expect(createPlayerSession).toHaveBeenCalledOnce();
});

it('keeps an early failure instead of replacing it with a later timeout', async () => {
  vi.mocked(readAttachment).mockRejectedValue(new Error('附件已更新，请重新打开。'));
  render(<MusicXmlPlayer source={source} />);
  await act(async () => {});
  expect(screen.getByText('附件已更新，请重新打开。')).toBeInTheDocument();
  await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
  expect(screen.getByText('附件已更新，请重新打开。')).toBeInTheDocument();
});

it('starts automatic offline preparation only after both playback readiness and a readable system', async () => {
 const save=vi.fn(async()=>{});
 vi.mocked(captureMusicXmlAccess).mockResolvedValue({cacheIdentity:'fence',save,assertCurrent:async()=>{},read:async()=>null});
 vi.mocked(readAttachment).mockResolvedValue({...source.attachment,trashExpiresAt:null});
 let state={status:'preparing'},notify=()=>{};
 let firstSystem=()=>{};
 vi.mocked(createPlayerSession).mockImplementation((_element,_bytes,options)=>{
  firstSystem=options?.onFirstReadableSystem??(()=>{});
  return {dispose,subscribe:(listener:()=>void)=>{notify=listener;return ()=>{};},getSnapshot:()=>state} as unknown as ReturnType<typeof createPlayerSession>;
 });
 render(<MusicXmlPlayer source={source}/>);await act(async()=>{});
 expect(prepareOfflineMusicXml).not.toHaveBeenCalled();
 await act(async()=>{state={status:'ready'};notify();});
 expect(prepareOfflineMusicXml).not.toHaveBeenCalled();
 await act(async()=>firstSystem());
 expect(prepareOfflineMusicXml).toHaveBeenCalledOnce();
 const taskSignal=vi.mocked(prepareOfflineMusicXml).mock.calls[0][2];
 expect(taskSignal?.aborted).toBe(false);
 cleanup();expect(taskSignal?.aborted).toBe(true);
});
it('records an asynchronous player failure and cancels automatic offline work already in progress', async () => {
 const save=vi.fn(async()=>{});
 vi.mocked(captureMusicXmlAccess).mockResolvedValue({cacheIdentity:'fence',save,assertCurrent:async()=>{},read:async()=>null});
 vi.mocked(readAttachment).mockResolvedValue({...source.attachment,trashExpiresAt:null});
 let state={status:'preparing'},notify=()=>{},firstSystem=()=>{};
 vi.mocked(createPlayerSession).mockImplementation((_element,_bytes,options)=>{
  firstSystem=options?.onFirstReadableSystem??(()=>{});
  return {dispose,subscribe:(listener:()=>void)=>{notify=listener;return ()=>{};},getSnapshot:()=>state} as unknown as ReturnType<typeof createPlayerSession>;
 });
 vi.mocked(prepareOfflineMusicXml).mockImplementation(()=>new Promise(()=>{}));
 render(<MusicXmlPlayer source={source}/>);await act(async()=>{});
 const tracker=vi.mocked(musicXmlLoadingTracker).mock.results[0].value;
 await act(async()=>{state={status:'ready'};firstSystem();notify();});
 expect(prepareOfflineMusicXml).toHaveBeenCalledOnce();
 const taskSignal=vi.mocked(prepareOfflineMusicXml).mock.calls[0][2];
 expect(taskSignal?.aborted).toBe(false);
 await act(async()=>{state={status:'error'};notify();});
 expect(tracker.end).toHaveBeenCalledWith('error');expect(taskSignal?.aborted).toBe(true);
});
it('keeps one automatic offline task through playback and pause snapshot changes',async()=>{
 const save=vi.fn(async()=>{});
 vi.mocked(captureMusicXmlAccess).mockResolvedValue({cacheIdentity:'fence',save,assertCurrent:async()=>{},read:async()=>null});
 vi.mocked(readAttachment).mockResolvedValue({...source.attachment,trashExpiresAt:null});
 let state={status:'preparing',playing:false},notify=()=>{},firstSystem=()=>{};
 vi.mocked(createPlayerSession).mockImplementation((_element,_bytes,options)=>{
  firstSystem=options?.onFirstReadableSystem??(()=>{});
  return {dispose,subscribe:(listener:()=>void)=>{notify=listener;return ()=>{};},getSnapshot:()=>state} as unknown as ReturnType<typeof createPlayerSession>;
 });
 vi.mocked(prepareOfflineMusicXml).mockImplementation(()=>new Promise(()=>{}));
 render(<MusicXmlPlayer source={source}/>);await act(async()=>{});
 await act(async()=>{state={status:'ready',playing:false};firstSystem();notify();});
 const taskSignal=vi.mocked(prepareOfflineMusicXml).mock.calls[0][2];
 await act(async()=>{state={status:'ready',playing:true};notify();});
 await act(async()=>{state={status:'ready',playing:false};notify();});
 expect(prepareOfflineMusicXml).toHaveBeenCalledOnce();expect(taskSignal?.aborted).toBe(false);
});
