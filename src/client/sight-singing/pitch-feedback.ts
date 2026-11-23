import { PitchDetector } from 'pitchy';
import { targetPitches, type MelodyNote } from './melody';

export type PitchFrame = { time: number; midi: number | null };
// Overlap 43–46 ms windows to sample the middle of short notes at 44.1/48 kHz.
export const pitchWindowSize = 2048;
export const frequency = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
export const pitchName = (midi: number) => `${['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'][((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;

export function createPitchReader(sampleRate: number) {
  const detector = PitchDetector.forFloat32Array(pitchWindowSize);
  detector.minVolumeDecibels = -48;
  return (samples: Float32Array) => {
    const [hz, clarity] = detector.findPitch(samples, sampleRate);
    return clarity >= .87 && hz >= 55 && hz <= 1500 ? 69 + 12 * Math.log2(hz / 440) : null;
  };
}

export function assessNotes(notes: MelodyNote[], frames: PitchFrame[]) {
  let cursor = 0, previousError: number | null = null;
  return notes.map(note => {
    const edge = Math.min(.065, (note.end - note.start) * .2);
    const insideStart = note.start + edge, insideEnd = note.end - edge;
    const pitches: number[] = [];
    while (cursor < frames.length && frames[cursor].time < insideStart) cursor++;
    const first = cursor;
    while (cursor < frames.length && frames[cursor].time < insideEnd) {
      const midi = frames[cursor++].midi;
      if (midi !== null) pitches.push(midi);
    }
    const sampled = cursor - first;
    // A short note's scoring window may fall between pitch analysis frames.
    if (sampled === 0) {
      previousError = null;
      return { note, target: null, sung: null, cents: null, interval: null, status: 'insufficientData' } as const;
    }
    pitches.sort((a, b) => a - b);
    const voiced = pitches.length / sampled >= .5;
    const sung = voiced ? (pitches[Math.floor((pitches.length - 1) / 2)] + pitches[Math.floor(pitches.length / 2)]) / 2 : null;
    const target = sung === null ? null : targetPitches(note).reduce((nearest, midi) => Math.abs(sung - midi) < Math.abs(sung - nearest) ? midi : nearest, note.midi);
    const error = sung === null || target === null ? null : (sung - target) * 100;
    const cents = error === null ? null : Math.round(error);
    const interval = error === null || previousError === null ? null : Math.round(error - previousError);
    previousError = error;
    const status = cents === null ? 'missed' : Math.abs(cents) >= 50 ? 'wrongNote' : cents > 25 ? 'sharp' : cents < -25 ? 'flat' : 'inTune';
    return { note, target, sung, cents, interval, status } as const;
  });
}
