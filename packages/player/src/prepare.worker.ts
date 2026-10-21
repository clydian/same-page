import { prepareMusicXmlSource } from './format.ts';
import { prepareMusicXmlForAlphaTabBytes } from './musicxml-direction-timing.ts';
self.onmessage = (event: MessageEvent<Uint8Array>) => {
  try {
    const prepared = prepareMusicXmlForAlphaTabBytes(prepareMusicXmlSource(event.data));
    self.postMessage({ prepared }, { transfer: [prepared.bytes.buffer] });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : '无法读取 MusicXML。' });
  }
};
