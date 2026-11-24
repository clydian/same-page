import { midi } from '@coderline/alphatab';
import { exportPracticeAudio, loadPracticeSoundFont } from './practice-soundfont';

export type BeatAccent = 0 | 1 | 2;
export type PracticeClick = { time: number; accent: BeatAccent };

export function practiceBeatAccent(beat: number, numerator: number, denominator: number): BeatAccent {
  if (beat === 0) return 2;
  return denominator === 8 && numerator >= 6 && numerator % 3 === 0 && beat % 3 === 0 ? 1 : 0;
}

const sampleRate = 44100;

export function renderPracticeClicks(soundFont: Uint8Array) {
  // The XML player and this export use the same alphaTab sequencer, woodblock
  // preset and velocities. One 6/8 bar provides all three accents.
  const file = new midi.MidiFile();
  const handler = new midi.AlphaSynthMidiFileHandler(file);
  handler.addTimeSignature(0, 6, 8);
  handler.addTempo(0, 60);
  file.addEvent(new midi.EndOfTrackEvent(0, 3 * file.division));
  const exported = exportPracticeAudio(file, soundFont, sampleRate, 1, .35).render(1800);
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
  pendingSamples ??= loadPracticeSoundFont().then(renderPracticeClicks).catch(error => { pendingSamples = undefined; throw error; });
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
