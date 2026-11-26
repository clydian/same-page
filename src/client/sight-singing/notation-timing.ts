import type { model, rendering } from '@coderline/alphatab';
import type { Melody, MelodyMeasure, MelodyVoice } from './melody';

export function measureEdge(bar: rendering.MasterBarBounds, tick: number, duration: number) {
  const { x, w } = bar.realBounds;
  if (tick <= 0) return x;
  if (tick >= duration) return x + w;
  let before = { tick: -1, x }, after = { tick: duration, x: x + w };
  for (const staff of bar.bars) for (const { beat, realBounds, onNotesX } of staff.beats) {
    const at = beat.playbackStart;
    // Use the printed note position for a cut within a sustained note. The
    // barline may be well to the left of its onset, especially after a clef.
    if (at >= 0 && at < tick && (at > before.tick || at === before.tick && onNotesX > before.x)) before = { tick: at, x: onNotesX };
    if (at >= tick && (at < after.tick || at === after.tick && realBounds.x < after.x)) after = { tick: at, x: realBounds.x };
  }
  if (after.tick === tick) return after.x;
  if (before.tick < 0) before.tick = 0;
  return before.x + (after.x - before.x) * (tick - before.tick) / (after.tick - before.tick);
}

export function measureEndX(bar: rendering.MasterBarBounds, measure: MelodyMeasure) {
  return measure.clip ? measureEdge(bar, measure.clip.until, measure.clip.duration) : bar.realBounds.x + bar.realBounds.w;
}

export function measureAnchors(lookup: rendering.BoundsLookup, score: model.Score, voice: Pick<MelodyVoice, 'track' | 'staff' | 'voice'>,
  measure: MelodyMeasure, staffBeats: Melody['staffBeats']) {
  const bar = lookup.findMasterBarByIndex(measure.bar);
  if (!bar) return [];
  const beats = score.tracks[voice.track]?.staves[voice.staff]?.bars[measure.bar]?.voices[voice.voice]?.beats;
  const endX = measureEndX(bar, measure);
  const anchors = staffBeats.filter(beat => beat.visit === measure.visit).flatMap(beat => {
    const modelBeat = beats?.[beat.beatIndex];
    const bounds = modelBeat && lookup.findBeat(modelBeat);
    return bounds ? [{ time: beat.start, x: Math.min(bounds.onNotesX, endX) }] : [];
  });
  if (!anchors.length || anchors[0].time > measure.start) anchors.unshift({ time: measure.start, x: bar.realBounds.x });
  anchors.push({ time: measure.end, x: endX });
  return anchors;
}

export function positionAt(anchors: ReturnType<typeof measureAnchors>, elapsed: number) {
  const next = anchors.findIndex(anchor => anchor.time > elapsed);
  const from = next < 0 ? anchors.at(-1) : anchors[Math.max(0, next - 1)];
  const to = anchors[next];
  if (!from) return undefined;
  return to && to.time > from.time
    ? from.x + (to.x - from.x) * Math.max(0, (elapsed - from.time) / (to.time - from.time)) : from.x;
}
