export async function validateMusicXmlFile(file: File, signal: AbortSignal) {
  const bytes = await file.arrayBuffer();
  signal.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const worker = new Worker(new URL('./musicxml-validation.worker.ts', import.meta.url), { type: 'module' });
    const finish = (error?: Error) => { clearTimeout(timeout); signal.removeEventListener('abort', cancel); worker.terminate(); if (error) reject(error); else resolve(); };
    const cancel = () => finish(new DOMException('Aborted', 'AbortError'));
    const timeout = setTimeout(() => finish(new Error('乐谱检查超时，请尝试较小的文件。')), 30000);
    signal.addEventListener('abort', cancel, { once: true });
    worker.onerror = () => finish(new Error('无法检查乐谱，请重试。'));
    worker.onmessage = (event: MessageEvent<{ ok?: boolean; error?: string }>) => finish(event.data.ok ? undefined : new Error(event.data.error ?? '无法读取 MusicXML。'));
    worker.postMessage(new Uint8Array(bytes), [bytes]);
  });
}
