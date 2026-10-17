import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { ScoreSummary } from '../../../shared/scores';
import type { ScoreAttachment } from '../../../shared/attachments';
import { localDatabase } from '../../platform/local-database';
import { resolveLocalWorkspace } from '../../platform/local-workspace';
import { captureAttachmentDirectoryWrite, readAttachmentDirectory } from './attachment-directory';
import { useLibraryAttachmentPresentation } from './use-library-attachment-presentation';

const legacy: ScoreSummary = { id: 'score', choirId: 'drive', fileName: '排练.pdf', updatedAt: 1, attachmentCount: 1, currentVersion: { id: 'version', versionNumber: 1, sizeBytes: 100, sha256: 'a'.repeat(64), etag: 'v', pageCount: 1, createdAt: 1 } };
const generated: ScoreAttachment = { id: 'xml', scoreId: legacy.id, name: '生成.xml', kind: 'musicxml', source: 'generated', url: null, sizeBytes: 10, revision: 1, updatedAt: 1, trashExpiresAt: null };
const userXml: ScoreAttachment = { ...generated, id: 'user-xml', source: 'user' };
const audio: ScoreAttachment = { ...generated, id: 'audio', name: '排练.wav', kind: 'audio', source: 'user' };
const collapsed = new Set<string>();
beforeEach(async () => { vi.restoreAllMocks(); await localDatabase.open(); });

it.each([
  { name: 'generated only', items: [generated], count: 0, hasGeneratedXml: true },
  { name: 'generated, user XML and audio', items: [generated, userXml, audio], count: 2, hasGeneratedXml: true },
  { name: 'user XML only', items: [userXml], count: 1, hasGeneratedXml: false },
  { name: 'empty directory', items: [], count: 0, hasGeneratedXml: false },
])('restores collapsed legacy $name presentation offline without changing raw summaries or directories', async ({ items, count, hasGeneratedXml }) => {
  const raw = { ...legacy, attachmentCount: items.length || 1 };
  const workspace = await resolveLocalWorkspace({ authenticatedUserId: 'user', choirId: 'drive', scoreId: 'score' });
  const save = await captureAttachmentDirectoryWrite(workspace);
  await save(raw, items, new AbortController().signal);
  const fetcher = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
  const view = renderHook(() => useLibraryAttachmentPresentation('drive', [raw], collapsed, false, 'offline', 'user:user'));
  await waitFor(() => expect(view.result.current.statusFor(raw.id)).toBe('ready'));
  expect(view.result.current.forScore(raw)).toEqual({ count, hasGeneratedXml });
  expect(raw.attachmentCount).toBe(items.length || 1);
  expect(raw.hasGeneratedXml).toBeUndefined();
  expect(await readAttachmentDirectory(workspace, raw)).toEqual(items);
  expect(fetcher).not.toHaveBeenCalled();
});

it('does not infer generated availability from a directory for a different score revision', async () => {
  const workspace = await resolveLocalWorkspace({ authenticatedUserId: 'user', choirId: 'drive', scoreId: 'score' });
  const save = await captureAttachmentDirectoryWrite(workspace);
  await save(legacy, [generated], new AbortController().signal);
  const newer = { ...legacy, updatedAt: 2 };
  const view = renderHook(() => useLibraryAttachmentPresentation('drive', [newer], collapsed, false, 'offline', 'user:user'));
  await waitFor(() => expect(view.result.current.statusFor(newer.id)).toBe('unavailable'));
  expect(view.result.current.forScore(newer)).toEqual({ count: 1, hasGeneratedXml: false });
});

it('keeps modern collapsed summaries on demand without fetching their directories', async () => {
  const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ attachments: [] }));
  const modern = { ...legacy, hasGeneratedXml: true, musicXmlCount: 1 };
  const view = renderHook(() => useLibraryAttachmentPresentation('drive', [modern], collapsed, true, 'online'));
  await waitFor(() => expect(view.result.current.refreshing).toBe(false));
  expect(view.result.current.forScore(modern)).toEqual({ count: 0, hasGeneratedXml: true });
  expect(fetcher).not.toHaveBeenCalled();
});
