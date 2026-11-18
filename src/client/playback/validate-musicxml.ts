import { untilAborted } from '../platform/abortable';

export async function validateMusicXmlFile(file: File, signal: AbortSignal) {
  signal.throwIfAborted();
  const deadline = new AbortController();
  const checking = AbortSignal.any([signal, deadline.signal]);
  const timeout = setTimeout(() => deadline.abort(new Error('乐谱检查超时，请重试。')), 30_000);
  let worker: Worker | undefined;
  try {
    const bytes = await untilAborted(file.arrayBuffer(), checking);
    checking.throwIfAborted();
    await untilAborted(new Promise<void>((resolve, reject) => {
      worker = new Worker(new URL('./musicxml-validation.worker.ts', import.meta.url), { type: 'module' });
      worker.onerror = () => reject(new Error('无法检查乐谱，请重试。'));
      worker.onmessage = (event: MessageEvent<{ ok?: boolean; error?: string }>) => event.data.ok ? resolve() : reject(new Error(event.data.error ?? '无法读取 MusicXML。'));
      worker.postMessage(new Uint8Array(bytes), [bytes]);
    }), checking);
  } finally {
    clearTimeout(timeout);
    worker?.terminate();
  }
}
