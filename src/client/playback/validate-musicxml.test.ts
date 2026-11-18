import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { validateMusicXmlFile } from './validate-musicxml';

class ValidationWorker {
  static instances: ValidationWorker[] = [];
  onmessage?: (event: { data: { ok?: boolean; error?: string } }) => void;
  onerror?: () => void;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() { ValidationWorker.instances.push(this); }
}
const bytes = new ArrayBuffer(4);
function pendingFile() {
  let complete!: (bytes: ArrayBuffer) => void;
  const arrayBuffer = vi.fn(() => new Promise<ArrayBuffer>(resolve => { complete = resolve; }));
  return { file: { arrayBuffer } as unknown as File, complete: () => complete(bytes) };
}
function readyFile() { return { arrayBuffer: async () => bytes } as File; }
beforeEach(() => { vi.useFakeTimers(); ValidationWorker.instances = []; vi.stubGlobal('Worker', ValidationWorker); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it('times out stalled file reading and ignores a late read', async () => {
  const { file, complete } = pendingFile();
  const checking = validateMusicXmlFile(file, new AbortController().signal);
  const rejected = expect(checking).rejects.toThrow('乐谱检查超时');
  await vi.advanceTimersByTimeAsync(30_000);
  await rejected;
  complete(); await vi.advanceTimersByTimeAsync(0);
  expect(ValidationWorker.instances).toHaveLength(0);
  expect(vi.getTimerCount()).toBe(0);
});

it('uses one deadline for file reading and Worker validation', async () => {
  const { file, complete } = pendingFile();
  const checking = validateMusicXmlFile(file, new AbortController().signal);
  const rejected = expect(checking).rejects.toThrow('乐谱检查超时');
  await vi.advanceTimersByTimeAsync(29_000);
  complete(); await vi.advanceTimersByTimeAsync(0);
  const worker = ValidationWorker.instances[0]!;
  expect(worker.postMessage).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1_000);
  await rejected;
  expect(worker.terminate).toHaveBeenCalledOnce();
  worker.onmessage?.({ data: { ok: true } });
  expect(vi.getTimerCount()).toBe(0);
});

it.each(['read', 'worker'])('cancels during %s without accepting late completion', async stage => {
  const controller = new AbortController();
  const { file, complete } = pendingFile();
  const checking = validateMusicXmlFile(file, controller.signal);
  const rejected = expect(checking).rejects.toMatchObject({ name: 'AbortError' });
  if (stage === 'worker') { complete(); await vi.advanceTimersByTimeAsync(0); }
  controller.abort();
  await rejected;
  complete(); await vi.advanceTimersByTimeAsync(0);
  if (stage === 'read') expect(ValidationWorker.instances).toHaveLength(0);
  else {
    const worker = ValidationWorker.instances[0]!;
    expect(worker.terminate).toHaveBeenCalledOnce();
    worker.onmessage?.({ data: { ok: true } });
  }
  expect(vi.getTimerCount()).toBe(0);
});

it.each([true, false])('keeps the Worker validation result (ok=%s)', async ok => {
  const checking = validateMusicXmlFile(readyFile(), new AbortController().signal);
  const result = ok ? expect(checking).resolves.toBeUndefined() : expect(checking).rejects.toThrow('invalid score');
  await vi.advanceTimersByTimeAsync(0);
  const worker = ValidationWorker.instances[0]!;
  worker.onmessage?.({ data: ok ? { ok: true } : { error: 'invalid score' } });
  await result;
  expect(worker.terminate).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});
