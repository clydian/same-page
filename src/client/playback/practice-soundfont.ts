import { midi, synth } from '@coderline/alphatab';
import { assetUrl } from '../../shared/asset-url';
import { buildId } from '../../shared/build';

const ignore = () => {};
const unusedEvent = { on: () => ignore, off: ignore };

export function exportPracticeAudio(file: midi.MidiFile, soundFont: Uint8Array, sampleRate: number, masterVolume: number, metronomeVolume = 0) {
  const player = new synth.AlphaSynth({
    sampleRate, open: ignore, play: ignore, pause: ignore, destroy: ignore, addSamples: ignore,
    resetSamples: ignore, activate: ignore, ready: unusedEvent, sampleRequest: unusedEvent, samplesPlayed: unusedEvent,
    enumerateOutputDevices: async () => [], setOutputDevice: async () => {}, getOutputDevice: async () => null,
  }, 0);
  try {
    const options = new synth.AudioExportOptions();
    Object.assign(options, { sampleRate, masterVolume, metronomeVolume, soundFonts: [soundFont] });
    return player.exportAudio(options, file, [], new Map());
  } finally {
    player.destroy();
  }
}

let pendingSoundFont: Promise<Uint8Array> | undefined;

export function loadPracticeSoundFont() {
  const soundfont = assetUrl(import.meta.env.DEV ? 'soundfont/sonivox.sf2' : `playback/${encodeURIComponent(buildId)}/soundfont/sonivox.sf2`);
  pendingSoundFont ??= fetch(soundfont).then(async response => {
    if (!response.ok) throw new Error('practice_soundfont_unavailable');
    return new Uint8Array(await response.arrayBuffer());
  }).catch(error => { pendingSoundFont = undefined; throw error; });
  return pendingSoundFont;
}
