import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { Context } from '../navigation/navigation-context';
import { clearDiagnostics, exportDiagnostics } from '../diagnostics/diagnostics';
import { afterEach, expect, it, vi } from 'vitest';
import { setUpdateStatus } from '../updates/update-status';
import { PlaybackGate } from './playback-gate';
import { playbackStore, playbackViewStore, startPlayback, stopPlayback, type PlaybackSource } from './playback-store';

vi.mock('./musicxml-player', () => { throw new TypeError('Failed to fetch dynamically imported module: /assets/musicxml-player-old.js'); });
const source: PlaybackSource = { ownerKey:'user:one',sessionId:'session',choirId:'drive',
 score:{id:'score',choirId:'drive',fileName:'a.pdf',updatedAt:1,currentVersion:{id:'v',sha256:'hash',etag:'etag',versionNumber:1,sizeBytes:10,pageCount:1,createdAt:1}},
 attachment:{id:'attachment',scoreId:'score',name:'a.musicxml',kind:'musicxml',url:null,sizeBytes:5,revision:1,updatedAt:1,trashExpiresAt:null} };
afterEach(() => { stopPlayback(); vi.restoreAllMocks(); });
it('contains a rejected player import without unmounting the reader, draft or update channel', async () => {
 setUpdateStatus({ phase: 'current', message: '检查完成，当前版本继续运行' });
 vi.spyOn(console, 'error').mockImplementation(() => {});
 const check = vi.fn(); window.addEventListener('same-page-check-update', check);
 try {
  render(<MemoryRouter initialEntries={['/choirs/drive/scores/score']}><label>笔记草稿<input defaultValue="尚未保存的文字" /></label><div>更新通道仍在运行</div><PlaybackGate /></MemoryRouter>);
  const input = screen.getByRole('textbox', {name:'笔记草稿'});
  act(() => startPlayback(source));
  expect(await screen.findByRole('alert')).toHaveTextContent('播放器加载失败');
  expect(screen.getByRole('textbox', {name:'笔记草稿'})).toBe(input);
  expect(input).toHaveValue('尚未保存的文字');
  expect(screen.getByText('更新通道仍在运行')).toBeInTheDocument();
  expect(playbackViewStore.getSnapshot()).toBe('pdf');
  expect(playbackStore.getSnapshot()?.attachment.id).toBe('attachment');
  fireEvent.click(screen.getByRole('button', {name:'检查更新'})); expect(check).toHaveBeenCalledTimes(1);
  act(() => setUpdateStatus({ phase: 'ready', message: '新版本待应用，请先完成其他窗口中的操作，再尝试更新' }));
  expect(screen.getByRole('status')).toHaveTextContent('新版本待应用');
  expect(screen.getByRole('link', {name:'关于合谱与版本更新'})).toHaveAttribute('href','/about');
  fireEvent.click(screen.getByRole('button', {name:'关闭播放器'}));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(playbackStore.getSnapshot()).toBeNull();
  expect(input).toHaveValue('尚未保存的文字');
 } finally { window.removeEventListener('same-page-check-update', check); }
});

it('records module loading separately and waits for guarded saving before offering page recovery', async () => {
 clearDiagnostics(); vi.spyOn(console, 'error').mockImplementation(() => {});
 let finishSaving: (() => void) | undefined;
 const afterEditing = vi.fn((action: () => void) => { finishSaving = action; });
 function Location() { const location = useLocation(); return <output aria-label="位置">{location.pathname}:{String(location.state?.recoverPlayer === true)}</output>; }
 render(<MemoryRouter initialEntries={['/choirs/drive/scores/score']}><Context value={{ register: () => () => {}, back: () => {}, afterEditing, returnState: new Map() }}><label>笔记草稿<input defaultValue="保留的草稿" /></label><Location /><PlaybackGate /></Context></MemoryRouter>);
 act(() => startPlayback(source)); await screen.findByRole('alert');
 expect(JSON.parse(exportDiagnostics()).records).toEqual(expect.arrayContaining([expect.objectContaining({ stage: 'request', step: 'attachment-entry', errorType: 'TypeError' })]));
 fireEvent.click(screen.getByRole('button', { name: '恢复播放器' }));
 expect(afterEditing).toHaveBeenCalledOnce();
 expect(screen.getByLabelText('位置')).toHaveTextContent('/choirs/drive/scores/score:false');
 expect(screen.getByRole('textbox')).toHaveValue('保留的草稿');
 expect(playbackStore.getSnapshot()).not.toBeNull();
 act(() => finishSaving?.());
 expect(screen.getByLabelText('位置')).toHaveTextContent('/about:true');
 expect(playbackStore.getSnapshot()).toBeNull();
});
