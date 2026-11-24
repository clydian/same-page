import type { PitchFrame } from './pitch-feedback';

const maxFrameGap = .065;
const maxPitchStep = 3;
const confirmationFrames = 3;

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

export function createPitchTrace() {
  const frames: PitchFrame[] = [], pending: PitchFrame[] = [];
  let previous: PitchFrame | undefined, confirmed = false;
  return {
    frames,
    append(frame: PitchFrame) {
      if (!previous || !pitchFramesConnect(previous, frame)) {
        pending.length = 0;
        confirmed = false;
      }
      previous = frame;
      if (frame.midi === null || confirmed) {
        frames.push(frame);
        return frame;
      }
      // Backfill the onset once adjacent overlapping analysis frames agree.
      // A brief burst stays unvoiced in the display and raw scoring is separate.
      pending.push(frame);
      const unvoiced = { time: frame.time, midi: null };
      frames.push(unvoiced);
      if (pending.length < confirmationFrames) return unvoiced;
      confirmed = true;
      for (let index = 0; index < pending.length; index++) {
        frames[frames.length - pending.length + index] = pending[index];
      }
      pending.length = 0;
      return frame;
    },
  };
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
