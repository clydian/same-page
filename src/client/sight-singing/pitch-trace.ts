import type { PitchFrame } from './pitch-feedback';

const maxFrameGap = .065;
const maxPitchStep = 3;

export function pitchFramesConnect(previous: PitchFrame, next: PitchFrame) {
  return previous.midi !== null && next.midi !== null && next.time - previous.time <= maxFrameGap &&
    Math.abs(next.midi - previous.midi) <= maxPitchStep;
}

export function firstFrameAt(frames: PitchFrame[], time: number) {
  let first = 0, last = frames.length;
  while (first < last) {
    const middle = (first + last) >>> 1;
    if (frames[middle].time < time) first = middle + 1;
    else last = middle;
  }
  return first;
}

export function lastFrameThrough(frames: PitchFrame[], time: number) {
  return firstFrameAt(frames, time + 1e-6) - 1;
}

export function octaveGuides(pitches: number[], low: number, high: number) {
  const written = new Set(pitches), guides = new Set<number>();
  for (const midi of written) {
    const first = midi + 12 * Math.ceil((low - midi) / 12);
    for (let pitch = first; pitch <= high; pitch += 12) {
      if (!written.has(pitch)) guides.add(pitch);
    }
  }
  return [...guides];
}
