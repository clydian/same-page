import type { MusicXmlErrorCode } from '@same-page/player/format';
import { getMessages, sourceLocale, type AppLocale } from '../../i18n';
import { untilAborted } from '../platform/abortable';

export async function validateMusicXmlFile(file: File, signal: AbortSignal, locale: AppLocale = sourceLocale) {
  signal.throwIfAborted();
  const t = getMessages(locale, 'practice');
  const deadline = new AbortController();
  const checking = AbortSignal.any([signal, deadline.signal]);
  const timeout = setTimeout(() => deadline.abort(new Error(t('validationTimeout'))), 30_000);
  let worker: Worker | undefined;
  try {
    const bytes = await untilAborted(file.arrayBuffer(), checking);
    checking.throwIfAborted();
    await untilAborted(new Promise<void>((resolve, reject) => {
      worker = new Worker(new URL('./musicxml-validation.worker.ts', import.meta.url), { type: 'module' });
      worker.onerror = () => reject(new Error(t('validationFailure')));
      worker.onmessage = (event: MessageEvent<{ ok?: boolean; code?: MusicXmlErrorCode; error?: string }>) => {
        if (event.data.ok) { resolve(); return; }
        const { code, error } = event.data;
        const message = code ? t(code) : locale === sourceLocale && error ? error : t('musicXmlUnreadable');
        reject(new Error(message));
      };
      worker.postMessage(new Uint8Array(bytes), [bytes]);
    }), checking);
  } finally {
    clearTimeout(timeout);
    worker?.terminate();
  }
}
