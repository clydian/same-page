// Shared by full pages and thumbnails. Leave room for a front bitmap while its
// replacement renders; this is a pixel budget, not a claim about total JS/GPU RAM.
export const MAX_RESIDENT_PIXELS = 24 * 1024 * 1024;
const allocations = new Map<HTMLCanvasElement, number>();
const listeners = new Set<() => void>();
let running = 0;
let scheduled = false;
const waiters: Array<{ priority: number; signal: AbortSignal; start(): void; cancel(): void }> = [];

function drain() {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    waiters.sort((a, b) => a.priority - b.priority);
    while (running < 2 && waiters.length) waiters.shift()!.start();
  });
}

// Visible pages precede speculative pages and thumbnails. Abandoned scroll
// targets leave the queue instead of delaying the new viewport.
export function acquireRenderSlot(signal: AbortSignal, priority = 0): Promise<() => void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const waiter = { priority, signal, start: () => {
      signal.removeEventListener('abort', waiter.cancel);
      running++;
      let released = false;
      resolve(() => { if (released) return; released = true; running--; drain(); });
    }, cancel: () => {
      const index = waiters.indexOf(waiter);
      if (index !== -1) waiters.splice(index, 1);
      reject(signal.reason);
    } };
    waiters.push(waiter);
    signal.addEventListener('abort', waiter.cancel, { once: true });
    drain();
  });
}
export function renderBudgetFacts() {
  return { residentPixels: [...allocations.values()].reduce((sum, pixels) => sum + pixels, 0), residentCanvases: allocations.size };
}
export function subscribeRenderBudget(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function hasRenderCapacity() { return MAX_RESIDENT_PIXELS - renderBudgetFacts().residentPixels >= 64 * 1024; }
export function sizeRenderCanvas(canvas: HTMLCanvasElement, width: number, height: number, maxPixels = 4 * 1024 * 1024) {
  const occupied = renderBudgetFacts().residentPixels - (allocations.get(canvas) ?? 0);
  const budget = Math.min(maxPixels, 4 * 1024 * 1024, MAX_RESIDENT_PIXELS - occupied);
  if (budget < 64 * 1024) throw new Error('canvas_memory_budget');
  const scale = Math.min(1, 4096 / Math.max(width, height), Math.sqrt(budget / (width * height)));
  canvas.width = Math.max(1, Math.floor(width * scale));
  canvas.height = Math.max(1, Math.floor(height * scale));
  allocations.set(canvas, canvas.width * canvas.height);
}
export function releaseRenderCanvas(canvas: HTMLCanvasElement) {
  const freed = allocations.delete(canvas);
  canvas.width = 1; canvas.height = 1;
  if (freed) queueMicrotask(() => listeners.forEach(listener => listener()));
}
