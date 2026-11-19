import { MusicXmlError } from './format.ts';
import { prepareMusicXmlDocumentForPlaybackBytes } from './musicxml-preparation.ts';
import { preparedScores } from './musicxml-direction-timing.ts';
self.onmessage = (event: MessageEvent<Uint8Array>) => {
  try {
    const prepared = prepareMusicXmlDocumentForPlaybackBytes(event.data);
    const buffers = new Set<ArrayBuffer>([prepared.bytes.buffer as ArrayBuffer, ...preparedScores(prepared).map(score => score.bytes.buffer as ArrayBuffer)]);
    self.postMessage({ prepared }, { transfer: [...buffers] });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : '无法读取 MusicXML。', code: error instanceof MusicXmlError ? error.code : undefined });
  }
};
