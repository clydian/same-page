import { midi, synth } from '@coderline/alphatab';
import { assetUrl } from '../../shared/asset-url';
import { buildId } from '../../shared/build';

export type BeatAccent = 0 | 1 | 2;
export type PracticeClick = { time: number; accent: BeatAccent };

export function practiceBeatAccent(beat: number, numerator: number, denominator: number): BeatAccent {
  if (beat === 0) return 2;
  return denominator === 8 && numerator >= 6 && numerator % 3 === 0 && beat % 3 === 0 ? 1 : 0;
}

const sampleRate = 44100;
const ignore = () => {};
const unusedEvent = { on: () => ignore, off: ignore };

export function renderPracticeClicks(soundFont: Uint8Array) {
  // The XML player and this export use the same alphaTab sequencer, woodblock
  // preset and velocities. One 6/8 bar provides all three accents.
  const player = new synth.AlphaSynth({
    sampleRate, open: ignore, play: ignore, pause: ignore, destroy: ignore, addSamples: ignore,
    resetSamples: ignore, activate: ignore, ready: unusedEvent, sampleRequest: unusedEvent, samplesPlayed: unusedEvent,
    enumerateOutputDevices: async () => [], setOutputDevice: async () => {}, getOutputDevice: async () => null,
  }, 0);
  const file = new midi.MidiFile();
  const handler = new midi.AlphaSynthMidiFileHandler(file);
  handler.addTimeSignature(0, 6, 8);
  handler.addTempo(0, 60);
  file.addEvent(new midi.EndOfTrackEvent(0, 3 * file.division));
  const options = new synth.AudioExportOptions();
  Object.assign(options, { sampleRate, masterVolume: 1, metronomeVolume: .35, soundFonts: [soundFont] });
  const exported = player.exportAudio(options, file, [], new Map()).render(1800);
  player.destroy();
  if (!exported) throw new Error('metronome_export_empty');
  // Synthesis runs in fixed blocks, so keep the original attack offsets.
  return [.5, 1.5, 0].map(time => {
    const start = Math.round(time * sampleRate);
    return Float32Array.from({ length: Math.round(.18 * sampleRate) }, (_, i) => {
      const index = 2 * (start + i);
      return (exported.samples[index] + exported.samples[index + 1]) * .5;
    });
  });
}

let pendingSamples: Promise<Float32Array[]> | undefined;

export async function loadPracticeClicks(context: AudioContext) {
  const soundfont = assetUrl(import.meta.env.DEV ? 'soundfont/sonivox.sf2' : `playback/${encodeURIComponent(buildId)}/soundfont/sonivox.sf2`);
  pendingSamples ??= fetch(soundfont).then(async response => {
    if (!response.ok) throw new Error('metronome_soundfont_unavailable');
    return renderPracticeClicks(new Uint8Array(await response.arrayBuffer()));
  }).catch(error => { pendingSamples = undefined; throw error; });
  return (await pendingSamples).map(samples => {
    const buffer = context.createBuffer(1, samples.length, sampleRate);
    buffer.getChannelData(0).set(samples);
    return buffer;
  });
}

export function schedulePracticeClicks(context: AudioContext, buffers: AudioBuffer[], start: number, clicks: PracticeClick[]) {
  let next = 0;
  const schedule = () => {
    const until = context.currentTime + .75;
    while (next < clicks.length && start + clicks[next].time < until) {
      const { time, accent } = clicks[next++];
      const pulse = context.createBufferSource();
      pulse.buffer = buffers[accent];
      pulse.connect(context.destination);
      pulse.start(start + time);
    }
    if (next === clicks.length) clearInterval(timer);
  };
  const timer = setInterval(schedule, 200);
  schedule();
  return () => clearInterval(timer);
}
