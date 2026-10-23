import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { attachmentFetch } from '../score-library/attachments/request';
import { holdUpdate } from '../updates/update-safety';
import { playbackStore, startPlayback, stopPlayback, type PlaybackSource } from './playback-store';
import { readPlaybackPreparation, savePlaybackPreparation, clearPlaybackPreparations } from './playback-preparation';
import { usePlaybackLifetime } from './use-playback-lifetime';

vi.mock('../score-library/attachments/request', () => ({ attachmentFetch: vi.fn() }));
vi.mock('../updates/update-safety', () => ({ holdUpdate: vi.fn() }));
const releaseUpdate = vi.fn();
const inputSource: PlaybackSource = {
  choirId: 'drive', ownerKey: 'user:one', sessionId: 'session',
  score: { id: 'score', choirId: 'drive', fileName: 'a.pdf', updatedAt: 1, currentVersion: { id: 'v', sha256: 'hash', etag: 'etag', versionNumber: 1, sizeBytes: 10, pageCount: 1, createdAt: 1 } },
  attachment: { id: 'audio', scoreId: 'score', name: 'a.wav', kind: 'audio', url: null, sizeBytes: 5, revision: 1, updatedAt: 1, trashExpiresAt: null },
};
let source: PlaybackSource;
function Probe({ source }: { source: PlaybackSource }) { usePlaybackLifetime(source); return null; }
beforeEach(() => { vi.clearAllMocks(); vi.mocked(holdUpdate).mockReturnValue(releaseUpdate); startPlayback(inputSource); source = playbackStore.getSnapshot()!; });
afterEach(() => { cleanup(); stopPlayback(); clearPlaybackPreparations(); });

it.each([401, 403, 404])('stops either playback engine when initial authority check returns %s', async status => {
  vi.mocked(attachmentFetch).mockResolvedValue(new Response(null, { status }));
  savePlaybackPreparation(source,new Uint8Array([1]));
  render(<Probe source={source} />);
  await waitFor(() => expect(playbackStore.getSnapshot()).toBeNull());
  expect(readPlaybackPreparation(source)).toBeUndefined();
});

it('retains loaded practice after a temporary network failure and checks again on focus', async () => {
  vi.mocked(attachmentFetch).mockRejectedValueOnce(new Error('offline')).mockResolvedValue(new Response(null, { status: 403 }));
  render(<Probe source={source} />);
  await act(async () => {});
  expect(playbackStore.getSnapshot()).toBe(source);
  act(() => window.dispatchEvent(new Event('focus')));
  await waitFor(() => expect(playbackStore.getSnapshot()).toBeNull());
});

it.each(['replacement','audio'])('a late denial cannot stop a fresh session for %s and update leases are released', async id => {
  let resolveOld!: (response: Response) => void;
  vi.mocked(attachmentFetch).mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; })).mockResolvedValue(new Response(null));
  const view = render(<Probe source={source} />);
  startPlayback({ ...source, attachment: { ...source.attachment, id } });
  const replacement = playbackStore.getSnapshot()!;
  view.rerender(<Probe source={replacement} />);
  await act(async () => resolveOld(new Response(null, { status: 403 })));
  expect(playbackStore.getSnapshot()).toBe(replacement);
  expect(releaseUpdate).toHaveBeenCalledTimes(1);
  view.unmount();
  expect(releaseUpdate).toHaveBeenCalledTimes(2);
});

it('joins the XML mount authorization in flight, then requests fresh metadata on focus', async () => {
 const xmlSource={...source,attachment:{...source.attachment,kind:'musicxml' as const}};
 startPlayback(xmlSource);source=playbackStore.getSnapshot()!;
 let complete!:(response:Response)=>void;
 vi.mocked(attachmentFetch).mockImplementationOnce(()=>new Promise(done=>{complete=done;})).mockResolvedValue(new Response(null,{status:403}));
 render(<Probe source={source}/>);
 const {readPlaybackAttachment}=await import('./musicxml-source');
 const shared=readPlaybackAttachment(source,new AbortController().signal);
 await act(async()=>complete(new Response(JSON.stringify({attachment:source.attachment}),{headers:{'content-type':'application/json'}})));
 await expect(shared).resolves.toEqual(source.attachment);
 expect(attachmentFetch).toHaveBeenCalledOnce();
 act(()=>window.dispatchEvent(new Event('focus')));
 await waitFor(()=>expect(playbackStore.getSnapshot()).toBeNull());
 expect(attachmentFetch).toHaveBeenCalledTimes(2);
});
