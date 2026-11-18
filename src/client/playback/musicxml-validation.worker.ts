import { MusicXmlError, validateMusicXmlSource } from '@same-page/player/format';

self.onmessage = (event: MessageEvent<Uint8Array>) => {
  try {
    validateMusicXmlSource(event.data);
    self.postMessage({ ok: true });
  } catch (error) {
    self.postMessage({
      code: error instanceof MusicXmlError ? error.code : undefined,
      error: error instanceof Error ? error.message : undefined,
    });
  }
};
