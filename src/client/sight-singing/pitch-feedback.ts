import { PitchDetector } from 'pitchy';
import type { MelodyNote } from './melody';

export type PitchFrame = { time: number; midi: number | null };
// Overlap 43–46 ms windows to sample the middle of short notes at 44.1/48 kHz.
export const pitchWindowSize = 2048;
const fullCreditCents = 25;
const wrongNoteCents = 50;
export const frequency = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
export const formatCents = (cents: number | null) => cents === null ? '—' : cents > 0 ? `+${cents}` : String(cents);
export const pitchName = (midi: number) => `${['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'][((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;

export function createPitchReader(sampleRate: number) {
  const detector = PitchDetector.forFloat32Array(pitchWindowSize);
  detector.minVolumeDecibels = -48;
  return (samples: Float32Array) => {
    const [hz, clarity] = detector.findPitch(samples, sampleRate);
    return clarity >= .87 && hz >= 55 && hz <= 1500 ? 69 + 12 * Math.log2(hz / 440) : null;
  };
}

export function matchTargetPitch(note: MelodyNote, sung: number) {
  const octave = Math.round((sung - note.midi) / 12);
  let best = { midi: note.midi, octave, error: sung - (note.midi + octave * 12) };
  if (note.chord) for (const midi of note.chord) {
    const octave = Math.round((sung - midi) / 12);
    const error = sung - (midi + octave * 12);
    const difference = Math.abs(error) - Math.abs(best.error);
    if (difference < 0 || (difference === 0 && Math.abs(octave) < Math.abs(best.octave))) best = { midi, octave, error };
  }
  return best;
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
      return { note, target: null, octave: null, sung: null, cents: null, interval: null, status: 'insufficientData' } as const;
    }
    pitches.sort((a, b) => a - b);
    const voiced = pitches.length / sampled >= .5;
    const sung = voiced ? (pitches[Math.floor((pitches.length - 1) / 2)] + pitches[Math.floor(pitches.length / 2)]) / 2 : null;
    const match = sung === null ? null : matchTargetPitch(note, sung);
    // Score the pitch class while measuring intervals in the sung register.
    const error = sung === null || !match ? null : (sung - match.midi) * 100;
    const cents = match ? Math.round(match.error * 1000) / 10 : null;
    const interval = error === null || previousError === null ? null : Math.round(error - previousError);
    previousError = error;
    const status = cents === null ? 'missed' : Math.abs(cents) >= wrongNoteCents ? 'wrongNote'
      : cents > fullCreditCents ? 'sharp' : cents < -fullCreditCents ? 'flat' : 'inTune';
    return { note, target: match?.midi ?? null, octave: match?.octave ?? null, sung, cents, interval, status } as const;
  });
}

export function takeScore(review: ReturnType<typeof assessNotes>) {
  let total = 0, matched = 0, points = 0;
  for (const { cents, status } of review) {
    if (status === 'insufficientData') continue;
    total++;
    if (cents === null || status === 'wrongNote') continue;
    matched++;
    points += 100 * Math.min(1, (wrongNoteCents - Math.abs(cents)) / (wrongNoteCents - fullCreditCents));
  }
  return { total, matched, percent: total ? Math.round(points / total) : null };
}
