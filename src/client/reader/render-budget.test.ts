import { afterEach, expect, it } from 'vitest';
import { acquireRenderSlot, MAX_RESIDENT_PIXELS, releaseRenderCanvas, renderBudgetFacts, sizeRenderCanvas } from './render-budget';
const canvases: HTMLCanvasElement[] = [];
afterEach(() => canvases.splice(0).forEach(releaseRenderCanvas));
it('fits multiple pages without exceeding the shared ceiling and frees reservations', () => {
  for (let index = 0; index < 6; index++) {
    const canvas = document.createElement('canvas'); canvases.push(canvas);
    sizeRenderCanvas(canvas, 4000, 5000);
  }
  expect(renderBudgetFacts().residentPixels).toBeLessThanOrEqual(MAX_RESIDENT_PIXELS);
  const next = document.createElement('canvas'); canvases.push(next);
  expect(() => sizeRenderCanvas(next, 4000, 5000)).toThrow('canvas_memory_budget');
  releaseRenderCanvas(canvases[0]);
  expect(() => sizeRenderCanvas(next, 4000, 5000, 256 * 1024)).not.toThrow();
  expect(next.width * next.height).toBeLessThanOrEqual(256 * 1024);
});
it('admits visible pages before preloads and cancels abandoned queued work', async () => {
  const signal = new AbortController().signal;
  const releases = await Promise.all([acquireRenderSlot(signal), acquireRenderSlot(signal)]);
  const order: string[] = [];
  const preload = acquireRenderSlot(signal, 1).then(release => { order.push('preload'); release(); });
  const abandoned = new AbortController();
  const cancelled = acquireRenderSlot(abandoned.signal).catch(error => error.name);
  abandoned.abort();
  const visible = acquireRenderSlot(signal).then(release => { order.push('visible'); release(); });
  releases[0]();
  await Promise.all([preload, visible]);
  releases[1](); releases[1](); // A cancelled owner cannot free another owner's slot.
  expect(await cancelled).toBe('AbortError');
  expect(order).toEqual(['visible', 'preload']);
});
