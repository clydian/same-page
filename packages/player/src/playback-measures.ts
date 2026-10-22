export interface PlaybackMeasureInput {
  endTick: number;
  measureIndex: number;
  startTick: number;
}

export interface PlaybackMeasure extends PlaybackMeasureInput {
  playbackIndex: number;
}

export const buildPlaybackMeasures = (
  inputs: PlaybackMeasureInput[],
): PlaybackMeasure[] =>
  inputs
    .filter(
      ({ startTick, endTick, measureIndex }) =>
        Number.isFinite(startTick) &&
        Number.isFinite(endTick) &&
        Number.isInteger(measureIndex) &&
        measureIndex >= 0 &&
        endTick >= startTick,
    )
    .sort((left, right) => left.startTick - right.startTick)
    .map((input, playbackIndex) => ({ ...input, playbackIndex }));

export const findPlaybackMeasureIndex = (
  measures: PlaybackMeasure[],
  tick: number,
): number | null => {
  if (measures.length === 0) {
    return null;
  }
  if (!Number.isFinite(tick) || tick <= measures[0].startTick) {
    return 0;
  }

  let low = 0;
  let high = measures.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (measures[middle].startTick <= tick) {
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return Math.min(measures.length - 1, Math.max(0, high));
};

export const clampPlaybackMeasureIndex = (
  measures: PlaybackMeasure[],
  index: number,
): number | null => {
  if (measures.length === 0 || !Number.isFinite(index)) {
    return null;
  }
  return Math.min(measures.length - 1, Math.max(0, Math.round(index)));
};

export const playbackMeasureIndexAtRatio = (
  measures: PlaybackMeasure[],
  ratio: number,
): number | null => {
  if (measures.length === 0 || !Number.isFinite(ratio)) {
    return null;
  }
  const clampedRatio = Math.min(1, Math.max(0, ratio));
  return Math.round(clampedRatio * (measures.length - 1));
};

/** Printed numbers identify score locations; repeated visits alone need disambiguation. */
export function playbackMeasureLabels(numbers: string[]): string[] {
    const totals = new Map<string, number>(), visits = new Map<string, number>();
    for (const number of numbers)
        totals.set(number, (totals.get(number) ?? 0) + 1);
    return numbers.map(number => {
        const visit = (visits.get(number) ?? 0) + 1;
        visits.set(number, visit);
        return `第 ${number} 小节${totals.get(number)! > 1 ? ` · 第 ${visit} 次经过` : ''}`;
    });
}
