import { model, type rendering } from '@coderline/alphatab';
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { MelodyNote, MelodyScore, MelodyVoice, StaffBeat } from './melody';
import { matchTargetPitch, type PitchFrame } from './pitch-feedback';
import { staffPitchY, type StaffPitchAnchor } from './staff-pitch';

// The top line of the treble, alto, tenor and bass clefs is respectively
// F5, G4, E4 and A3. Each seven successive steps describes one octave.
const clefTopStep: Partial<Record<model.Clef, number>> = {
  [model.Clef.G2]: 5 * 7 + 3, [model.Clef.C3]: 4 * 7 + 4,
  [model.Clef.C4]: 4 * 7 + 2, [model.Clef.F4]: 3 * 7 + 5,
};

type Head = StaffPitchAnchor & { x: number };
type TraceBeat = {
  target: MelodyNote; system: number; endX: number; heads: Map<number, Head>;
  top: number; bottom: number;
};

function scorePitchLayout(lookup: rendering.BoundsLookup, score: MelodyScore['score'], voice: MelodyVoice, beats: StaffBeat[]) {
  const staff = score.tracks[voice.track]?.staves[voice.staff];
  if (staff?.standardNotationLineCount !== 5) return [];
  return beats.flatMap(({ pitches, ...timing }): TraceBeat[] => {
    if (!pitches.length) return [];
    const bar = staff.bars[timing.bar];
    const voiceBeats = bar?.voices[voice.voice]?.beats;
    const beat = voiceBeats?.[timing.beatIndex];
    const bounds = beat && lookup.findBeat(beat);
    const system = bounds?.barBounds.masterBarBounds.staffSystemBounds;
    if (!beat || !bounds || !system) return [];
    const topStep = clefTopStep[bar.getClefAt(beat.displayStart)];
    const staffBounds = bounds.barBounds.visualBounds;
    const stepSize = staffBounds.h / 8;
    if (topStep === undefined || stepSize <= 0) return [];
    const heads = new Map<number, Head>();
    const signature = bar.getKeySignatureAt(beat.displayStart);
    for (const { note, noteHeadBounds } of bounds.notes ?? []) {
      if (!pitches.includes(note.realValue) || !note.isVisible || note.isCue || noteHeadBounds.w <= 0 || noteHeadBounds.h <= 0) continue;
      const x = noteHeadBounds.x + noteHeadBounds.w / 2;
      const y = noteHeadBounds.y + noteHeadBounds.h / 2;
      heads.set(note.realValue, { x, y, stepSize, step: topStep - Math.round((y - staffBounds.y) / stepSize),
        writtenMidi: note.displayValue, signature });
    }
    if (!heads.size) return [];
    const nextBeat = voiceBeats[timing.beatIndex + 1];
    const endX = (nextBeat && lookup.findBeat(nextBeat)?.onNotesX) ?? staffBounds.x + staffBounds.w - stepSize;
    const ys = [...heads.values()].map(head => head.y);
    return [{ target: { ...timing, midi: pitches[0], chord: pitches }, system: system.index, endX, heads,
      top: Math.min(staffBounds.y, ...ys) - 2 * stepSize,
      bottom: Math.max(staffBounds.y + staffBounds.h, ...ys) + 2 * stepSize,
    }];
  });
}

function firstFrameAt(frames: PitchFrame[], time: number) {
  let first = 0, last = frames.length;
  while (first < last) {
    const middle = (first + last) >>> 1;
    if (frames[middle].time < time) first = middle + 1;
    else last = middle;
  }
  return first;
}

function tracePath(beats: TraceBeat[], frames: PitchFrame[]) {
  const path: string[] = [];
  let previous: { x: number; y: number; time: number; system: number } | undefined;
  for (const beat of beats) {
    const { target } = beat;
    for (let index = firstFrameAt(frames, target.start); index < frames.length; index++) {
      const { time, midi } = frames[index];
      if (time >= target.end) break;
      if (midi === null) { previous = undefined; continue; }
      const match = matchTargetPitch(target, midi), head = beat.heads.get(match.midi);
      if (!head) { previous = undefined; continue; }
      const progress = (time - target.start) / (target.end - target.start);
      const x = head.x + progress * Math.max(1, beat.endX - head.x);
      const y = Math.min(beat.bottom, Math.max(beat.top, staffPitchY(head, match.error)));
      const connected = previous && previous.system === beat.system && time - previous.time < .085 && x >= previous.x;
      path.push(`${connected ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`);
      if (!connected) path.push(`h.1`);
      previous = { x, y, time, system: beat.system };
    }
  }
  return { path: path.join(' '), point: previous };
}

export function ScorePitchTrace({ lookup, score, voice, beats, frames, currentVisit, live, viewport }: {
  lookup: rendering.BoundsLookup; score: MelodyScore['score']; voice: MelodyVoice; beats: StaffBeat[];
  frames: PitchFrame[]; currentVisit?: number; live: boolean; viewport: RefObject<HTMLDivElement | null>;
}) {
  const layer = useRef<SVGSVGElement>(null);
  const [visible, setVisible] = useState<number[] | null>(null);
  const layout = useMemo(() => scorePitchLayout(lookup, score, voice, beats), [lookup, score, voice, beats]);

  useEffect(() => {
    const host = viewport.current, overlay = layer.current;
    if (!host || !overlay) return;
    let pending = 0;
    const measure = () => {
      pending = 0;
      const view = host.getBoundingClientRect(), content = overlay.getBoundingClientRect();
      const top = view.top - content.top, bottom = view.bottom - content.top;
      const systems = lookup.staffSystems.filter(({ realBounds }) => realBounds.y < bottom && realBounds.y + realBounds.h > top)
        .map(system => system.index);
      setVisible(old => old?.length === systems.length && old.every((index, i) => index === systems[i]) ? old : systems);
    };
    const schedule = () => { if (!pending) pending = requestAnimationFrame(measure); };
    const resize = new ResizeObserver(schedule);
    resize.observe(host);
    resize.observe(overlay);
    host.addEventListener('scroll', schedule, { passive: true });
    schedule();
    return () => { resize.disconnect(); host.removeEventListener('scroll', schedule); cancelAnimationFrame(pending); };
  }, [lookup, viewport]);

  const currentLayout = useMemo(() => {
    const closest = new Map<number, number>();
    for (const { target } of layout) {
      const previous = closest.get(target.bar);
      if (previous === undefined || (currentVisit !== undefined && Math.abs(target.visit - currentVisit) < Math.abs(previous - currentVisit))) {
        closest.set(target.bar, target.visit);
      }
    }
    return layout.filter(beat => (visible?.includes(beat.system) ?? false) && beat.target.visit === closest.get(beat.target.bar));
  }, [layout, visible, currentVisit]);
  const { path, point } = tracePath(currentLayout, frames);
  const tip = live && point?.time === frames.at(-1)?.time ? point : undefined;
  return <svg ref={layer} className="challenge-staff-trace" aria-hidden="true" focusable="false">
    {path && <><path className="challenge-staff-trace-halo" d={path} /><path className="challenge-staff-trace-curve" d={path} /></>}
    {tip && <circle cx={tip.x} cy={tip.y} r={3.2} />}
  </svg>;
}
