import { prepareMusicXmlSource } from '@itscly2026/chorus-player/format';
self.onmessage = (event: MessageEvent<Uint8Array>) => {
  try { prepareMusicXmlSource(event.data); self.postMessage({ ok: true }); }
  catch (error) { self.postMessage({ error: error instanceof Error ? error.message : '无法读取 MusicXML。' }); }
};
