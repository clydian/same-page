import { prepareMusicXmlForPlaybackBytes } from './musicxml-preparation.ts';
self.onmessage = (event: MessageEvent<Uint8Array>) => {
  try {
    const prepared = prepareMusicXmlForPlaybackBytes(event.data);
    self.postMessage({ prepared }, { transfer: [prepared.bytes.buffer] });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : '无法读取 MusicXML。' });
  }
};
