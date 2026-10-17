import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { ScoreSummary } from '../../shared/scores';
import { diagnosticFetch } from '../diagnostics/diagnostics';
import { ReaderPracticeLauncher } from './reader-practice-launcher';

vi.mock('../auth/application-identity', () => ({ useApplicationIdentity: () => ({ onlineState: 'authenticated', authenticatedSessionId: 'session' }) }));
vi.mock('../diagnostics/diagnostics', () => ({ diagnosticFetch: vi.fn() }));
const fetchMock = vi.mocked(diagnosticFetch);
const score: ScoreSummary = { id: 'score', choirId: 'drive', fileName: '排练.pdf', updatedAt: 1, attachmentCount: 2, musicXmlCount: 1, currentVersion: { id: 'version', versionNumber: 1, sizeBytes: 100, sha256: 'a'.repeat(64), etag: 'v', pageCount: 1, createdAt: 1 } };
const source = { score, choirId: 'drive', ownerKey: 'user:review', sessionId: 'session' };
const audio = { id: 'audio', scoreId: score.id, name: '排练.wav', kind: 'audio', source: 'user', url: null, sizeBytes: 10, revision: 1, updatedAt: 1, trashExpiresAt: null };
beforeEach(() => fetchMock.mockReset());

it('uses the resolved attachment directory to hide a stale positive XML entry', async () => {
  let resolve!: (response: Response) => void;
  fetchMock.mockReturnValue(new Promise<Response>(yes => { resolve = yes; }));
  render(<ReaderPracticeLauncher source={source} enabled open={false} onOpenChange={() => {}} />);
  expect(screen.getByRole('button', { name: '练习谱' })).toBeVisible();
  expect(screen.getByLabelText('练习谱', { selector: '.reader-playback-entries' })).toHaveAttribute('aria-busy', 'true');
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  await act(async () => resolve(Response.json({ attachments: [audio] })));
  await waitFor(() => expect(screen.queryByRole('button', { name: '练习谱' })).toBeNull());
});

it('keeps a known XML entry available for retry after a transient directory error', async () => {
  fetchMock.mockResolvedValueOnce(new Response(null, { status: 503 }))
    .mockResolvedValueOnce(Response.json({ attachments: [{ ...audio, id: 'xml', name: '练习.xml', kind: 'musicxml' }] }));
  render(<ReaderPracticeLauncher source={source} enabled open onOpenChange={() => {}} />);
  await waitFor(() => expect(screen.getByRole('button', { name: '重试' })).toBeVisible());
  fireEvent.click(screen.getByRole('button', { name: '重试' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '练习.xml' })).toBeVisible());
  expect(screen.getByLabelText('练习谱', { selector: '.reader-playback-entries' })).toHaveAttribute('aria-busy', 'false');
});
