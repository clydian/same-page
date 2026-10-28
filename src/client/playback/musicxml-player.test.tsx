import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import MusicXmlPlayer from './musicxml-player';
import { readAttachment } from '../score-library/attachments/api';
import { attachmentFetch } from '../score-library/attachments/request';
import { createPlayerSession } from '@same-page/player';
import { captureMusicXmlAccess, prepareOfflineMusicXml } from './offline-musicxml';
import type { PlaybackSource } from './playback-store';

vi.mock('./musicxml-loading', () => ({ musicXmlLoadingTracker: vi.fn(() => ({ stage: vi.fn(), source: vi.fn(), end: vi.fn() })) }));
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
  await act(async () => { await vi.advanceTimersByTimeAsync(180000); });
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
  await act(async () => { resolve({ ...source.attachment, trashExpiresAt: null }); await vi.advanceTimersByTimeAsync(180000); });
  expect(createPlayerSession).not.toHaveBeenCalled();
});
