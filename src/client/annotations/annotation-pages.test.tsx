import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AnnotationLayerSummary, AnnotationPayload } from '../../shared/annotations';
import { localDatabase, annotationRecordKey, type LocalAnnotationRecord } from '../platform/local-database';
import { activateAuthenticatedLocalOwner, authenticatedLocalOwnerKey, createLocalWorkspace } from '../platform/local-workspace';
import { useReaderGestures } from '../reader/use-reader-gestures';
import { AnnotationEditor } from './annotation-editor';
import { AnnotationPages, AnnotationPagesContext } from './annotation-pages';
import { AnnotationOverlay, type AnnotationTool } from './annotation-overlay';
import * as annotationState from './annotation-state';
const workspace = createLocalWorkspace(authenticatedLocalOwnerKey('page-editor'), 'drive', 'score');
const layerId = '11111111-1111-4111-8111-111111111111';
const layers = [{id: layerId, kind: 'personal', name: '我的笔记', subscribed: true, canEdit: true}] as AnnotationLayerSummary[];
let editor: AnnotationEditor;
let pages: AnnotationPages;
beforeEach(async () => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  await localDatabase.open(); await activateAuthenticatedLocalOwner('page-editor');
  editor = new AnnotationEditor(workspace); editor.begin(); pages = new AnnotationPages(editor); pages.activate(1);
});
afterEach(() => { editor.cancel(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function Reader({tool, availableLayers = layers}: {tool: AnnotationTool; availableLayers?: AnnotationLayerSummary[]}) {
  const annotations = useLiveQuery(() => localDatabase.annotations.toArray(), [], []);
  useEffect(() => pages.connect(), []);
  const ref = useRef<HTMLDivElement>(null);
  const gestures = useReaderGestures({containerRef: ref, contentRef: ref, disabled: false, twoFingerOnly: true, zoom: 1,
    onZoomChange() {}, onTap() {}, onNavigationStart: pages.interrupt, isObjectGestureActive: pages.ownsObjectGesture});
  return <AnnotationPagesContext.Provider value={pages}><div ref={ref} {...gestures} data-testid="viewport">
    {[1, 2].map(page => <AnnotationOverlay key={page} editor={editor} pageNumber={page} layers={availableLayers} annotations={annotations} editing tool={tool} activeLayerId={layerId} />)}
  </div></AnnotationPagesContext.Provider>;
}
function bounds(element: Element, top: number, height = 100) {
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({x: 0, y: top, left: 0, right: 100, top, bottom: top + height, width: 100, height, toJSON() {return {}}});
}
function mount(tool: AnnotationTool) {
  render(<Reader tool={tool}/>);
  const a = screen.getByLabelText('第 1 页笔记层'), b = screen.getByLabelText('第 2 页笔记层');
  for (const [el, top] of [[a, 0], [b, 108]] as const) { bounds(el, top); bounds(el.parentElement!, top); }
  bounds(screen.getByTestId('viewport'), 0, 216);
  return {a, b};
}
const pen = (id: number, x: number, y: number) => ({pointerId: id, pointerType: 'pen', clientX: x, clientY: y, buttons: 1});
function stroke(el: Element, id: number, top: number) {
  fireEvent.pointerDown(el, pen(id, 20, top + 20)); fireEvent.pointerMove(el, pen(id, 60, top + 30)); fireEvent.pointerUp(el, pen(id, 60, top + 30));
}
const rows = () => localDatabase.annotations.filter(note => !note.deleted).toArray();
async function idle() { await waitFor(() => expect(editor.getSnapshot()).toBe('idle')); }
async function seed(id: string, payload: AnnotationPayload) {
  const note: LocalAnnotationRecord = {key: annotationRecordKey(workspace.scopeKey, id), ...workspace, id, layerId, payload,
    version: 1, baseVersion: 1, deleted: false, state: 'synced', lastOpId: null, syncErrorCode: null, updatedAt: 1};
  await localDatabase.annotations.put(note); return note;
}
it('ends ink at the origin boundary, ignores the same contact returning, and shares undo across pages', async () => {
  const {a, b} = mount('ink');
  fireEvent.pointerDown(a, pen(1, 20, 80)); fireEvent.pointerMove(a, pen(1, 40, 90));
  fireEvent.pointerMove(a, pen(1, 50, 120)); fireEvent.pointerMove(a, pen(1, 90, 80));
  fireEvent.pointerMove(b, pen(1, 90, 140)); fireEvent.pointerUp(a, pen(1, 90, 80));
  await idle();
  let saved = await rows(); expect(saved).toHaveLength(1);
  expect(saved[0].payload).toMatchObject({kind: 'ink', pageNumber: 1});
  if (saved[0].payload?.kind !== 'ink') throw new Error('expected ink');
  expect(saved[0].payload.points.at(-1)).toMatchObject({x: .43333, y: 1});
  stroke(b, 2, 108); await idle();
  saved = await rows(); expect(saved.map(n => n.payload?.pageNumber).sort()).toEqual([1, 2]);
  fireEvent.keyDown(document.body, {key: "z", ctrlKey: true});
  await idle();
  expect((await rows()).map(n => n.payload?.pageNumber)).toEqual([1]);
  await act(async () => { await editor.redo(layerId); });
  expect((await rows()).map(n => n.payload?.pageNumber).sort()).toEqual([1, 2]);
});
it('erases only the origin page even when the pointer moves through another page', async () => {
  const ink = (pageNumber: number): AnnotationPayload => ({kind: 'ink', pageNumber, brush: 'pen', nib: 'round', pressureMode: 'uniform', points: [{x: .2,y: .3},{x: .6,y: .3}], strokeWidth: .003});
  await seed('first', ink(1)); await seed('second', ink(2));
  const {a} = mount('eraser');
  await waitFor(() => expect(screen.getByLabelText('第 1 页笔记层').querySelector('[data-ink-stroke]')).not.toBeNull());
  fireEvent.pointerDown(a, pen(1, 30, 30)); fireEvent.pointerMove(a, pen(1, 30, 138)); fireEvent.pointerUp(a, pen(1, 30, 138));
  await idle(); expect((await rows()).map(n => n.id)).toEqual(['second']);
});
it('routes a second finger on the other page to the original object', async () => {
  const first = await seed('first', {kind: 'text', pageNumber: 1, x: .2, y: .3, text: '第一页', fontScale: .024});
  const second = await seed('second', {kind: 'text', pageNumber: 2, x: .2, y: .3, text: '第二页', fontScale: .024});
  const {b} = mount('text');
  const button = await screen.findByRole('button', {name: '第一页'});
  const touch = (pointerId: number, clientX: number, clientY: number) => ({pointerId, pointerType: 'touch', clientX, clientY});
  fireEvent.pointerDown(button, touch(1, 20, 30)); fireEvent.pointerDown(b, touch(2, 40, 140));
  fireEvent.pointerMove(b, touch(2, 80, 140)); fireEvent.pointerUp(b, touch(2, 80, 140)); fireEvent.pointerUp(button, touch(1, 20, 30));
  await idle();
  expect((await localDatabase.annotations.get(first.key))?.payload).toMatchObject({pageNumber: 1});
  expect((await localDatabase.annotations.get(first.key))?.payload).not.toEqual(first.payload);
  expect((await localDatabase.annotations.get(second.key))?.payload).toEqual(second.payload);
  expect(screen.queryByRole('textbox', {name: '笔记文本'})).toBeNull();
});
it('retains both outgoing pages while writes are pending and recovers each page after a storage failure', async () => {
  const {a, b} = mount('ink');
  let fail!: (error: unknown) => void;
  const save = vi.spyOn(annotationState, 'saveAnnotationDraft').mockReturnValueOnce(new Promise((_, reject) => { fail = reject; }));
  stroke(a, 1, 0); await waitFor(() => expect(save).toHaveBeenCalled());
  stroke(b, 2, 108);
  expect(pages.getSnapshot().pinnedPages).toEqual([1, 2]);
  await act(async () => { fail(new DOMException('full', 'QuotaExceededError')); });
  expect(editor.getSnapshot()).toBe('failed');
  expect(screen.getAllByRole('button', {name: '重试本机保存'})).toHaveLength(1);
  stroke(a, 3, 0); // Cannot switch input owner away from the failed page.
  expect(pages.getSnapshot().activePage).toBe(2);
  save.mockRestore();
  await act(async () => { expect(await editor.retry()).toBe(true); });
  expect((await rows()).map(n => n.payload?.pageNumber).sort()).toEqual([1, 2]);
  expect(pages.getSnapshot().pinnedPages).toEqual([2]);
});
it('keeps failed text on its original page and does not create another composer', async () => {
  const {a, b} = mount('text');
  fireEvent.pointerDown(a, pen(1, 20, 30)); fireEvent.pointerUp(a, pen(1, 20, 30));
  const input = screen.getByRole('textbox', {name: '笔记文本'});
  fireEvent.change(input, {target: {value: '保留在第一页'}});
  const save = vi.spyOn(annotationState, 'saveAnnotationDraft').mockRejectedValueOnce(new DOMException('full', 'QuotaExceededError'));
  fireEvent.submit(input.closest('form')!);
  await waitFor(() => expect(editor.getSnapshot()).toBe('failed'));
  fireEvent.pointerDown(b, pen(2, 20, 138)); fireEvent.pointerUp(b, pen(2, 20, 138));
  expect(screen.getAllByRole('textbox', {name: '笔记文本'})).toHaveLength(1);
  expect(input).toHaveValue('保留在第一页');
  save.mockRestore(); fireEvent.submit(input.closest('form')!);
  await waitFor(() => expect(screen.queryByRole('textbox', {name: '笔记文本'})).toBeNull());
  expect((await rows()).map(n => n.payload)).toMatchObject([{pageNumber: 1, text: '保留在第一页'}]);
});

it.each(["highlighter", "rectangle", "ellipse"] as const)("keeps %s page identity at a boundary and permits the next contact on page two", async tool => {
  const {a, b} = mount(tool);
  fireEvent.pointerDown(a, pen(1, 20, 80)); fireEvent.pointerMove(a, pen(1, 40, 90));
  fireEvent.pointerMove(a, pen(1, 50, 120)); fireEvent.pointerUp(a, pen(1, 90, 80));
  stroke(b, 2, 108); await idle();
  const saved = await rows();
  expect(saved.map(n => n.payload?.pageNumber).sort()).toEqual([1, 2]);
  expect(saved.every(note => note.payload?.kind === (tool === "highlighter" ? "ink" : "shape"))).toBe(true);
});
it('two-finger browsing across the page seam interrupts only the unfinished stroke', async () => {
  const {a, b} = mount('ink'); stroke(a, 10, 0); await idle();
  const before = (await rows()).map(note => note.id);
  const touch = (pointerId: number, clientY: number) => ({pointerId, pointerType: 'touch', clientX: 30 + pointerId * 10, clientY});
  fireEvent.pointerDown(a, touch(1, 80)); fireEvent.pointerMove(a, touch(1, 85));
  fireEvent.pointerDown(b, touch(2, 130));
  fireEvent.pointerUp(b, touch(2, 130)); fireEvent.pointerUp(a, touch(1, 85));
  await idle(); expect((await rows()).map(note => note.id)).toEqual(before);
});

it('does not let shared input ownership bypass a read-only layer on either page', async () => {
  const denied = layers.map(layer => ({...layer, canEdit: false}));
  render(<Reader tool="ink" availableLayers={denied}/>);
  const a = screen.getByLabelText('第 1 页笔记层'), b = screen.getByLabelText('第 2 页笔记层');
  for (const [element, top] of [[a, 0], [b, 108]] as const) { bounds(element, top); bounds(element.parentElement!, top); }
  stroke(a, 1, 0); stroke(b, 2, 108);
  await act(async () => {});
  expect(pages.getSnapshot().activePage).toBe(2);
  expect(editor.getEditRevision()).toBe(0);
  expect(await rows()).toEqual([]);
});
