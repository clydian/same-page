import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { clearDiagnostics, exportDiagnostics } from '../diagnostics/diagnostics';
import { PdfPageCanvas } from './pdf-page';
import type { PDFDocumentProxy } from './pdf-document';
import { MAX_RESIDENT_PIXELS, renderBudgetFacts } from './render-budget';
const draw = vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() }));
const pdf = { numPages: 30, getPage: async () => ({ getViewport: () => ({width: 600, height: 800}), render: draw }) } as unknown as PDFDocumentProxy;
beforeEach(() => { clearDiagnostics(); draw.mockClear(); vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as CanvasRenderingContext2D); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
it('automatically retries a stranded page when other pages release their budget', async () => {
  const pages = (all: boolean) => <>{(all ? [1,2,3,4,5,6,7] : [7]).map(page => <PdfPageCanvas key={page} document={pdf} pageNumber={page} width={2000} mode="continuous" />)}</>;
  const view = render(pages(true));
  await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  expect(renderBudgetFacts().residentPixels).toBeLessThanOrEqual(MAX_RESIDENT_PIXELS);
  const record = JSON.parse(exportDiagnostics()).records[0];
  expect(record.render).toMatchObject({ reason: 'budget', page: 7, pageCount: 30, mode: 'continuous', automaticRetries: 0 });
  view.rerender(pages(false));
  await waitFor(() => expect(view.container.querySelector('[data-pdf-canvas-active]')).not.toBeNull());
  expect(screen.queryByRole('alert')).toBeNull();
});
it('records context loss and recovers a fresh backing store even without a restored event', async () => {
  vi.useFakeTimers();
  const view = render(<PdfPageCanvas document={pdf} pageNumber={1} width={600}/>);
  await act(async () => {});
  const old = view.container.querySelector('[data-pdf-canvas-active]')!;
  fireEvent(old, new Event('contextlost'));
  expect(JSON.parse(exportDiagnostics()).records[0].render.reason).toBe('context-lost');
  await act(async () => { await vi.advanceTimersByTimeAsync(251); });
  expect(view.container.querySelector('[data-pdf-canvas-active]')).not.toBeNull();
  expect(view.container.querySelector('[data-pdf-canvas-active]')).not.toBe(old);
});
it('bounds automatic resource retries and leaves a manual recovery after persistent canvas failure', async () => {
  vi.useFakeTimers();
  vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(null);
  render(<PdfPageCanvas document={pdf} pageNumber={1} width={600}/>);
  await act(async () => {});
  for (let retry = 0; retry < 2; retry++) await act(async () => { await vi.advanceTimersByTimeAsync(251); });
  expect(HTMLCanvasElement.prototype.getContext).toHaveBeenCalledTimes(6); // two resolutions x three attempts
  expect(screen.getByRole('button', {name: '重试本页'})).toBeVisible();
  await act(async () => {});
  for (let retry = 0; retry < 2; retry++) await act(async () => { await vi.advanceTimersByTimeAsync(251); });
  expect(HTMLCanvasElement.prototype.getContext).toHaveBeenCalledTimes(6);
});
it('never retries corrupt page content on resource notifications or elapsed time', async () => {
  vi.useFakeTimers();
  draw.mockImplementationOnce(() => ({promise: Promise.reject(new Error('corrupt fixture')), cancel: vi.fn()}));
  draw.mockImplementationOnce(() => ({promise: Promise.reject(new Error('corrupt fixture')), cancel: vi.fn()}));
  render(<PdfPageCanvas document={pdf} pageNumber={1} width={600}/>);
  await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
  expect(draw).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('button', {name: '重试本页'})).toBeVisible();
});
