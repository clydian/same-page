import type { PitchFrame } from './pitch-feedback';
import { firstFrameAt } from './pitch-trace';

const confirmation = .09;
const maxGap = .025;

function edgeEvidence(frames: PitchFrame[], through: number, center: number, edge: number, inset: number) {
  const recent: number[] = [];
  let latest: number | null = null;
  let newest = 0, previous = through, direction = 0;
  for (let i = firstFrameAt(frames, through + 1e-7) - 1; i >= 0; i--) {
    const { time, midi } = frames[i];
    if (previous - time > maxGap) break;
    if (midi === null) continue;
    latest ??= midi;
    const offset = midi - center;
    const side = Math.abs(offset) > edge ? Math.sign(offset) : 0;
    if (side === 0 || (direction && side !== direction)) break;
    if (!direction) {
      newest = time;
      direction = side;
    }
    previous = time;
    recent.push(midi);
    if (newest - time >= confirmation) {
      // Use a robust aim for the view. Detector values and plotted points stay intact.
      recent.sort((a, b) => a - b);
      return { latest, aim: recent[recent.length >> 1] - direction * inset };
    }
  }
  return { latest, aim: null };
}

/** Follow in semitones, regardless of how the host draws or scrolls its pitch axis. */
export function createPitchViewport() {
  let target: { center: number; pitch: number } | null = null;
  let previousTime: number | undefined, previousTick: number | undefined;

  return {
    reset() {
      target = null;
      previousTime = previousTick = undefined;
    },
    step({ center, span, frames, through, now, reducedMotion = false, min = -Infinity, max = Infinity }: {
      center: number; span: number; frames: PitchFrame[]; through: number; now: number;
      reducedMotion?: boolean; min?: number; max?: number;
    }) {
      // Do not carry a movement target through a playback seek or a new time line.
      if (previousTime !== undefined && (through < previousTime - .001 || through - previousTime > .25)) target = null;
      const elapsed = Math.min(50, Math.max(0, now - (previousTick ?? now - 16)));
      previousTime = through;
      previousTick = now;
      const edge = span * .32, inset = span * .22;
      const { latest, aim } = edgeEvidence(frames, through, center, edge, inset);
      if (latest === null) target = null;
      else if (aim !== null) target = { center: Math.max(min, Math.min(max, aim)), pitch: latest };
      // Once the pitch comes inside the edge, it can still support the rest
      // of the move. A different note or a gap cannot keep that aim alive.
      else if (target && Math.abs(latest - target.pitch) > Math.max(1, edge - inset)) target = null;
      if (target === null) return center;
      const remaining = target.center - center;
      if (reducedMotion || Math.abs(remaining) <= .06) {
        const next = target.center;
        target = null;
        return next;
      }
      // In a narrow chart a few semitones of lag can hide a steady glide.
      const easeTime = Math.min(105, 26 + span * 3);
      const distance = Math.min(Math.abs(remaining) * (1 - Math.exp(-elapsed / easeTime)), Math.max(48, span * 4) * elapsed / 1000);
      return center + Math.sign(remaining) * distance;
    },
  };
}
