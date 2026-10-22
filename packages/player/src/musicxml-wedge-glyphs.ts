import * as alphaTab from '@coderline/alphatab';
import type { MusicXmlWedgeEvent } from './musicxml-direction-timing.ts';

type Span = { start: MusicXmlWedgeEvent; stop: MusicXmlWedgeEvent };

/** Playback consumes the part-wide markers first. This display-only projection
 * chooses one native voice with exact start/end boundaries for each source sign.
 * It never splits a beat or guesses a nearest endpoint. Unsupported tracks retain
 * their previous marker path; note dynamics, times and source bytes are untouched. */
export function restoreMusicXmlWedgeGlyphs(
  track: alphaTab.model.Track,
  events: MusicXmlWedgeEvent[],
): boolean {
  if (events.length === 0 || events.some(event => event.voice !== null &&
    (!Number.isSafeInteger(Number(event.voice)) || Number(event.voice) < 1))) return false;
  // A meter/voice overrun makes source measure time ambiguous. Keep the old
  // glyph path until that score's timeline is corrected independently.
  for (const staff of track.staves) for (const bar of staff.bars)
    for (const voice of bar.voices) for (const beat of voice.beats)
      if (!beat.isEmpty && (beat.playbackStart < 0 ||
        beat.playbackStart + beat.playbackDuration > bar.masterBar.calculateDuration() + 1e-6)) return false;
  const active = new Map<string, MusicXmlWedgeEvent>();
  const spans: Span[] = [];
  for (const event of [...events].sort((a,b) => a.measureIndex-b.measureIndex || a.quarter-b.quarter)) {
    if (event.type === 'continue') {
      if (!active.has(event.number)) return false;
      continue;
    }
    const start = active.get(event.number);
    if (event.type === 'stop') {
      if (!start) return false;
      spans.push({start,stop:event});
      active.delete(event.number);
    } else {
      if (start) return false;
      active.set(event.number,event);
    }
  }
  if (active.size > 0 || spans.length === 0) return false;
  const selected = new Map<alphaTab.model.Beat, alphaTab.model.CrescendoType>();
  const tick = (event: MusicXmlWedgeEvent): number | null => {
    const bar = track.score.masterBars[event.measureIndex];
    const offset = event.quarter * 960;
    if (!bar || !Number.isFinite(offset) || Math.abs(offset-Math.round(offset)) > 1e-6) return null;
    return bar.start+Math.round(offset);
  };
  for (const span of spans) {
    const start = tick(span.start), stop = tick(span.stop);
    const staffIndex = (span.start.staff ?? 1)-1;
    const voiceIndex = span.start.voice === null ? null : Number(span.start.voice)-1;
    const staff = track.staves[staffIndex];
    if (!staff || start === null || stop === null || stop <= start ||
      (voiceIndex !== null && (!Number.isSafeInteger(voiceIndex) || voiceIndex < 0))) return false;
    const lanes = new Map<number,alphaTab.model.Beat[]>();
    for (const bar of staff.bars) for (const voice of bar.voices) {
      if (voiceIndex !== null && voice.index !== voiceIndex) continue;
      const lane = lanes.get(voice.index) ?? [];
      for (const beat of voice.beats) {
        const onset = bar.masterBar.start+beat.playbackStart;
        if (!beat.isEmpty && onset >= start && onset < stop) lane.push(beat);
      }
      lanes.set(voice.index,lane);
    }
    const lane = [...lanes.values()].find(beats => {
      if (beats.length === 0) return false;
      let cursor = start;
      for (const beat of beats) {
        if (beat.voice.bar.masterBar.start+beat.playbackStart !== cursor || beat.playbackDuration <= 0) return false;
        cursor += beat.playbackDuration;
      }
      return cursor === stop;
    });
    if (!lane) return false;
    const shape = span.start.type === 'crescendo' ? alphaTab.model.CrescendoType.Crescendo : alphaTab.model.CrescendoType.Decrescendo;
    const previous = lane[0].previousBeat;
    if (previous && selected.get(previous) === shape) return false;
    for (const beat of lane) {
      if (selected.has(beat)) return false;
      selected.set(beat,shape);
    }
  }
  for (const staff of track.staves) for (const bar of staff.bars)
    for (const voice of bar.voices) for (const beat of voice.beats)
      beat.crescendo = selected.get(beat) ?? alphaTab.model.CrescendoType.None;
  return true;
}
