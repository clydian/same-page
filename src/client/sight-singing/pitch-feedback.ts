import { PitchDetector } from 'pitchy';
import type { MelodyNote } from './melody';

export type PitchFrame = { time: number; midi: number | null };
// Overlap 43–46 ms windows to sample the middle of short notes at 44.1/48 kHz.
export const pitchWindowSize = 2048;
const fullCreditCents = 15;
const maxMatchedCents = 50;
// Include the same sharp-side tolerance at C8 as at any other target note.
export const sightSingingMaxMidi = 108 + maxMatchedCents / 100;
export const frequency = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
export function formatCents(cents: number) {
  const rounded = Math.sign(cents) * Math.round(Math.abs(cents));
  return rounded > 0 ? `+${rounded}` : String(rounded);
}
export const pitchName = (midi: number) => `${['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'][((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;

export function createPitchReader(sampleRate: number, maxHz = frequency(sightSingingMaxMidi)) {
  const detector = PitchDetector.forFloat32Array(pitchWindowSize);
  detector.minVolumeDecibels = -48;
  return (samples: Float32Array) => {
    const [hz, clarity] = detector.findPitch(samples, sampleRate);
    return clarity >= .87 && hz >= 55 && hz <= maxHz ? 69 + 12 * Math.log2(hz / 440) : null;
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

function circularPitchMedian(pitches: number[], target: number) {
  let x = 0, y = 0;
  for (const pitch of pitches) {
    const angle = ((pitch - target) % 12) * Math.PI / 6;
    x += Math.cos(angle);
    y += Math.sin(angle);
  }
  // Nearly opposing pitches do not provide a reliable place to cut the circle.
  if (Math.hypot(x, y) < .1 * pitches.length) return null;

  const anchor = target + Math.atan2(y, x) * 6 / Math.PI;
  // Unwrap into the octave centered on the circular mean, then use an ordinary median.
  const unwrapped = pitches.map(pitch => pitch - 12 * Math.floor((pitch - anchor + 6) / 12)).sort((a, b) => a - b);
  const median = (unwrapped[Math.floor((pitches.length - 1) / 2)] + unwrapped[Math.floor(pitches.length / 2)]) / 2;

  // Register is independent of pitch class. Only report a clearly dominant octave.
  const octaves = new Map<number, number>();
  for (const pitch of pitches) {
    const octave = Math.round((pitch - median) / 12);
    const count = (octaves.get(octave) ?? 0) + 1;
    octaves.set(octave, count);
    if (count > pitches.length * 2 / 3) return { median, sung: median + octave * 12 };
  }
  return { median, sung: null };
}

export function assessNotes(notes: MelodyNote[], frames: PitchFrame[]) {
  let cursor = 0;
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
      return { note, target: null, octave: null, sung: null, cents: null, status: 'insufficientData' } as const;
    }
    if (pitches.length / sampled < .5) {
      return { note, target: null, octave: null, sung: null, cents: null, status: 'missed' } as const;
    }
    const pitch = circularPitchMedian(pitches, note.midi);
    if (!pitch) {
      return { note, target: null, octave: null, sung: null, cents: null, status: 'wrongNote' } as const;
    }
    // Compare one representative pitch with the chord, not one chord tone per frame.
    const match = matchTargetPitch(note, pitch.sung ?? pitch.median);
    const cents = Math.round(match.error * 1000) / 10;
    const status = Math.abs(cents) > maxMatchedCents ? 'wrongNote'
      : cents > fullCreditCents ? 'sharp' : cents < -fullCreditCents ? 'flat' : 'inTune';
    return { note, target: match.midi, octave: pitch.sung === null ? null : match.octave, sung: pitch.sung, cents, status } as const;
  });
}

export function takeScore(review: ReturnType<typeof assessNotes>) {
  let total = 0, matched = 0, points = 0;
  for (const { cents, status } of review) {
    if (status === 'insufficientData') continue;
    total++;
    if (cents === null || status === 'wrongNote') continue;
    matched++;
    const excessCents = Math.max(0, Math.abs(cents) - fullCreditCents);
    points += 100 - 50 * excessCents / (maxMatchedCents - fullCreditCents);
  }
  const perfect = matched > 0 && matched === review.length;
  return { total, matched, perfect, writtenOctave: perfect && review.every(row => row.octave === 0),
    percent: total ? Math.round(points * 100 / total) / 100 : null };
}
