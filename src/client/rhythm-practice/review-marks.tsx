import type { model, rendering } from '@coderline/alphatab';
import { measureAnchors, measureEdge, positionAt } from '../sight-singing/notation-timing';
import type { Melody, MelodyVoice } from '../sight-singing/melody';
import type { RhythmStatus } from './scoring';

export type RhythmMark = { time: number; status: RhythmStatus; visit: number; beatIndex?: number };

export function RhythmReviewMarks({ marks, visit, lookup, score, voice, measures, staffBeats }: {
  marks: readonly RhythmMark[]; visit: number; lookup: rendering.BoundsLookup; score: model.Score;
  voice: Pick<MelodyVoice, 'track' | 'staff' | 'voice'>; measures: Melody['measures']; staffBeats: Melody['staffBeats'];
}) {
  const visible = new Map<number, typeof measures[number]>();
  for (const measure of measures) {
    const current = visible.get(measure.bar);
    if (!current || Math.abs(visit - measure.visit) < Math.abs(visit - current.visit)) visible.set(measure.bar, measure);
  }
  const byVisit = new Map<number, RhythmMark[]>();
  for (const mark of marks) {
    const group = byVisit.get(mark.visit) ?? [];
    group.push(mark);
    byVisit.set(mark.visit, group);
  }
  return <div className="rhythm-score-marks" aria-hidden="true">
    {[...visible.values()].flatMap(measure => {
      const master = lookup.findMasterBarByIndex(measure.bar), group = byVisit.get(measure.visit);
      if (!master || !group?.length) return [];
      const bar = master.bars.find(item => item.beats.some(beat => {
        const staff = beat.beat.voice.bar.staff;
        return staff.track.index === voice.track && staff.index === voice.staff;
      }));
      if (!bar) return [];
      const anchors = measureAnchors(lookup, score, voice, measure, staffBeats);
      const left = measure.clip ? measureEdge(master, measure.clip.from, measure.clip.duration) : master.realBounds.x;
      const beats = score.tracks[voice.track].staves[voice.staff].bars[measure.bar].voices[voice.voice]?.beats;
      return group.map(({ time, status, beatIndex }, index) => {
        const target = beatIndex !== undefined;
        const beat = target && beats?.[beatIndex];
        const x = (beat ? lookup.findBeat(beat)?.onNotesX : undefined) ?? positionAt(anchors, time) ?? left;
        return <span key={`${measure.visit}:${index}`} data-mark={target ? 'target' : 'tap'} data-status={status}
          style={{ left: Math.max(left, x), top: bar.realBounds.y + (target ? 3 : 14) }} />;
      });
    })}
  </div>;
}
