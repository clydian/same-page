export function waveFile(chunks: ArrayBuffer[], length: number, sampleRate: number) {
  const header = new DataView(new ArrayBuffer(44));
  const tag = (at: number, text: string) => [...text].forEach((character, index) => header.setUint8(at + index, character.charCodeAt(0)));
  tag(0, 'RIFF'); header.setUint32(4, 36 + length * 2, true); tag(8, 'WAVE'); tag(12, 'fmt ');
  header.setUint32(16, 16, true); header.setUint16(20, 1, true); header.setUint16(22, 1, true);
  header.setUint32(24, sampleRate, true); header.setUint32(28, sampleRate * 2, true);
  header.setUint16(32, 2, true); header.setUint16(34, 16, true); tag(36, 'data'); header.setUint32(40, length * 2, true);
  return new Blob([header.buffer, ...chunks], { type: 'audio/wav' });
}

export function pcm16(samples: Float32Array) {
  const pcm = new DataView(new ArrayBuffer(samples.length * 2));
  for (let index = 0; index < samples.length; index++) {
    const level = Math.max(-1, Math.min(1, samples[index]));
    pcm.setInt16(index * 2, level * (level < 0 ? 32768 : 32767), true);
  }
  return pcm.buffer;
}
