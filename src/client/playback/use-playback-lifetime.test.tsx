import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { attachmentFetch } from '../score-library/attachments/request';
import { holdUpdate } from '../updates/update-safety';
import { playbackStore, startPlayback, stopPlayback, type PlaybackSource } from './playback-store';
import { usePlaybackLifetime } from './use-playback-lifetime';

vi.mock('../score-library/attachments/request', () => ({ attachmentFetch: vi.fn() }));
vi.mock('../updates/update-safety', () => ({ holdUpdate: vi.fn() }));
const releaseUpdate = vi.fn();
const source: PlaybackSource = {
  choirId: 'drive', ownerKey: 'user:one', sessionId: 'session',
  score: { id: 'score', choirId: 'drive', fileName: 'a.pdf', updatedAt: 1, currentVersion: { id: 'v', sha256: 'hash', etag: 'etag', versionNumber: 1, sizeBytes: 10, pageCount: 1, createdAt: 1 } },
  attachment: { id: 'audio', scoreId: 'score', name: 'a.wav', kind: 'audio', url: null, sizeBytes: 5, revision: 1, updatedAt: 1, trashExpiresAt: null },
};
function Probe({ source }: { source: PlaybackSource }) { usePlaybackLifetime(source); return null; }
beforeEach(() => { vi.clearAllMocks(); vi.mocked(holdUpdate).mockReturnValue(releaseUpdate); startPlayback(source); });
afterEach(() => { cleanup(); stopPlayback(); });

it.each([401, 403, 404])('stops either playback engine when initial authority check returns %s', async status => {
  vi.mocked(attachmentFetch).mockResolvedValue(new Response(null, { status }));
  render(<Probe source={source} />);
  await waitFor(() => expect(playbackStore.getSnapshot()).toBeNull());
});

it('retains loaded practice after a temporary network failure and checks again on focus', async () => {
  vi.mocked(attachmentFetch).mockRejectedValueOnce(new Error('offline')).mockResolvedValue(new Response(null, { status: 403 }));
  render(<Probe source={source} />);
  await act(async () => {});
  expect(playbackStore.getSnapshot()).toBe(source);
  act(() => window.dispatchEvent(new Event('focus')));
  await waitFor(() => expect(playbackStore.getSnapshot()).toBeNull());
});

it('a late denial for the old source cannot stop a replacement and update leases are released', async () => {
  let resolveOld!: (response: Response) => void;
  vi.mocked(attachmentFetch).mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; })).mockResolvedValue(new Response(null));
  const view = render(<Probe source={source} />);
  const replacement = { ...source, attachment: { ...source.attachment, id: 'replacement' } };
  startPlayback(replacement);
  view.rerender(<Probe source={replacement} />);
  await act(async () => resolveOld(new Response(null, { status: 403 })));
  expect(playbackStore.getSnapshot()).toBe(replacement);
  expect(releaseUpdate).toHaveBeenCalledTimes(1);
  view.unmount();
  expect(releaseUpdate).toHaveBeenCalledTimes(2);
});
