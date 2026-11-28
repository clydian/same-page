export type RhythmStatus = 'onTime' | 'early' | 'late' | 'missed' | 'extra';
export type RhythmRunTiming = { speed: number; window: number; threshold: number; earlyStart: number; end: number };
export type RhythmScore = {
  targets: { time: number; status: Exclude<RhythmStatus, 'extra'> }[];
  taps: { time: number; status: Exclude<RhythmStatus, 'missed'> }[];
  counts: Record<RhythmStatus, number>;
};

export function lockRhythmTiming(speed: number, beatSeconds: number, duration: number): RhythmRunTiming {
  const beat = beatSeconds / speed;
  const window = Math.min(.25, beat * .45);
  const threshold = Math.min(.09, beat * .20);
  return { speed, window, threshold, earlyStart: -Math.min(.08, threshold), end: duration / speed + window };
}

export function rhythmElapsed(eventStamp: number, startStamp: number) {
  // Legacy WebKit event timestamps can be epoch-based. Normalize to the same
  // monotonic origin as the audio output timestamp and animation frames.
  const stamp = eventStamp > 1e12 ? eventStamp - performance.timeOrigin : eventStamp;
  return (stamp - startStamp) / 1000;
}

export function acceptsRhythmTap(time: number, firstTarget: number, timing: RhythmRunTiming) {
  return time <= timing.end && (time >= 0 || time >= timing.earlyStart && firstTarget - time <= timing.threshold);
}

type Pair = { target: number; tap: number; count: number; error: number; distance: number; previous?: Pair };
const better = (a: Pair, b?: Pair) => !b || a.count > b.count ||
  a.count === b.count && a.error < b.error - 1e-9;

/** Ordered one-to-one matching. Maximize pair count, then minimize total absolute timing error. */
export function scoreRhythm(times: readonly number[], recorded: readonly number[], timing: RhythmRunTiming): RhythmScore {
  const taps = recorded.filter(time => acceptsRhythmTap(time, times[0], timing)).sort((a, b) => a - b);
  const tree: (Pair | undefined)[] = Array(taps.length + 1);
  // Prefix maxima over tap indices. Only taps inside the pairing window are
  // visited; updates from one target are published together so it can't pair twice.
  const bestBefore = (end: number) => {
    let best: Pair | undefined;
    for (let i = end; i > 0; i -= i & -i) {
      const pair = tree[i];
      if (pair && better(pair, best)) best = pair;
    }
    return best;
  };
  let from = 0;
  for (const [target, time] of times.entries()) {
    const lo = time - timing.window, hi = time + timing.window;
    while (from < taps.length && taps[from] < lo) from++;
    const candidates: Pair[] = [];
    for (let tap = from; tap < taps.length && taps[tap] <= hi; tap++) {
      if (taps[tap] < 0 && target !== 0) continue;
      const previous = bestBefore(tap), distance = taps[tap] - time;
      candidates.push({ target, tap, count: (previous?.count ?? 0) + 1,
        error: (previous?.error ?? 0) + Math.abs(distance), distance, previous });
    }
    for (const pair of candidates) for (let i = pair.tap + 1; i < tree.length; i += i & -i) {
      if (better(pair, tree[i])) tree[i] = pair;
    }
  }
  const counts = { onTime: 0, early: 0, late: 0, missed: 0, extra: 0 };
  const targets: RhythmScore['targets'] = times.map(time => ({ time, status: 'missed' }));
  const marks: RhythmScore['taps'] = taps.map(time => ({ time, status: 'extra' }));
  for (let pair = bestBefore(taps.length); pair; pair = pair.previous) {
    const { target, tap, distance } = pair;
    const status = Math.abs(distance) <= timing.threshold + 1e-9 ? 'onTime' : distance < 0 ? 'early' : 'late';
    targets[target].status = status;
    marks[tap].status = status;
  }
  const scoredTaps = marks.filter(mark => mark.time >= 0 || mark.status !== 'extra');
  for (const mark of targets) counts[mark.status]++;
  counts.extra = scoredTaps.filter(mark => mark.status === 'extra').length;
  return { targets, taps: scoredTaps, counts };
}
