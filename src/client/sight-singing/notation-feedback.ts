import type { Melody } from './melody';
import type { assessNotes } from './pitch-feedback';

export type NotationFeedback = {
  bar: number; beatIndex: number; visit: number; midi?: number | null;
  status: ReturnType<typeof assessNotes>[number]['status']; cents: number | null;
};
export type NotationResult = NotationFeedback & { continuation?: number[] };

export function matchesNotationResult(result: NotationResult | undefined, midi: number): result is NotationResult {
  return !!result && (result.midi == null || result.midi === midi) && (!result.continuation || result.continuation.includes(midi));
}

export function notationFeedbackAtVisit(melody: Pick<Melody, 'measures' | 'staffBeats'>, feedback: readonly NotationFeedback[] | undefined, visit: number) {
  const visible = new Map<string, NotationResult>();
  if (!feedback?.length) return visible;
  const passes = new Map<number, number>();
  // Choose a visit even for an unscored occurrence; a result from another
  // pass must not fill an unscored beat at the selected range boundary.
  for (const measure of melody.measures) {
    const current = passes.get(measure.bar);
    if (current === undefined || Math.abs(visit - measure.visit) < Math.abs(visit - current)) passes.set(measure.bar, measure.visit);
  }
  // On a repeat, adjacent printed bars should come from the same traversal
  // even when the previous pass is equally close to the playhead.
  const at = melody.measures.findIndex(measure => measure.visit === visit);
  if (at >= 0) {
    let first = at, last = at;
    while (first > 0 && melody.measures[first - 1].bar < melody.measures[first].bar) first--;
    while (last + 1 < melody.measures.length && melody.measures[last].bar < melody.measures[last + 1].bar) last++;
    for (const measure of melody.measures.slice(first, last + 1)) passes.set(measure.bar, measure.visit);
  }
  const assessments = new Map<string, NotationFeedback>();
  for (const result of feedback) {
    assessments.set(`${result.visit}:${result.beatIndex}`, result);
    if (passes.get(result.bar) === result.visit) visible.set(`${result.bar}:${result.beatIndex}`, result);
  }
  for (const beat of melody.staffBeats) {
    if (!beat.continuationOf || passes.get(beat.bar) !== beat.visit) continue;
    const origin = assessments.get(`${beat.continuationOf.visit}:${beat.continuationOf.beatIndex}`);
    if (origin) visible.set(`${beat.bar}:${beat.beatIndex}`, { ...origin, continuation: beat.pitches });
  }
  return visible;
}
