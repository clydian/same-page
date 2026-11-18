import type { MusicXmlErrorCode } from '@same-page/player/format';
import { getMessages, sourceLocale, type AppLocale } from '../../i18n';

export async function validateMusicXmlFile(file: File, signal: AbortSignal, locale: AppLocale = sourceLocale) {
  const t = getMessages(locale, 'practice');
  const bytes = await file.arrayBuffer();
  signal.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const worker = new Worker(new URL('./musicxml-validation.worker.ts', import.meta.url), { type: 'module' });
    const finish = (error?: Error) => { clearTimeout(timeout); signal.removeEventListener('abort', cancel); worker.terminate(); if (error) reject(error); else resolve(); };
    const cancel = () => finish(new DOMException('Aborted', 'AbortError'));
    const timeout = setTimeout(() => finish(new Error(t('validationTimeout'))), 30000);
    signal.addEventListener('abort', cancel, { once: true });
    worker.onerror = () => finish(new Error(t('validationFailure')));
    worker.onmessage = (event: MessageEvent<{ ok?: boolean; code?: MusicXmlErrorCode; error?: string }>) => {
      if (event.data.ok) { finish(); return; }
      const { code, error } = event.data;
      const message = code ? t(code) : locale === sourceLocale && error ? error : t('musicXmlUnreadable');
      finish(new Error(message));
    };
    worker.postMessage(new Uint8Array(bytes), [bytes]);
  });
}
