import { model } from '@coderline/alphatab';
import type { MelodyMeasure, MelodyVoice } from './melody';

const contextInk = new model.Color(0, 0, 0, 145);

function dim<T extends number>(style: { colors: Map<T, model.Color | null> }, elements: Record<string, string | T>) {
  for (const element of Object.values(elements)) {
    if (typeof element === 'number') style.colors.set(element, contextInk);
  }
}

export function shadeContext(score: model.Score, focused: Pick<MelodyVoice, 'track' | 'staff' | 'voice'>,
  measures: readonly MelodyMeasure[], firstBar: number, lastBar: number, staffLine?: model.Color) {
  const visits = new Map<number, MelodyMeasure[]>();
  for (const measure of measures) {
    const passes = visits.get(measure.bar) ?? [];
    passes.push(measure);
    visits.set(measure.bar, passes);
  }
  const inRange = (beat: model.Beat) => visits.get(beat.voice.bar.index)?.some(({ clip }) =>
    !clip || beat.playbackStart >= clip.from && beat.playbackStart < clip.until) ?? false;
  const mutedBeams = new Set<number>();
  const visibleBeats: model.Beat[] = [];
  for (const track of score.tracks) {
    if (staffLine && track.index !== focused.track) dim(track.style ??= new model.TrackStyle(), model.TrackSubElement);
    for (const staff of track.staves) {
      const focusedStaff = track.index === focused.track && staff.index === focused.staff;
      for (const bar of staff.bars.slice(firstBar, lastBar + 1)) {
        if (staffLine && !focusedStaff) {
          const style = bar.style ??= new model.BarStyle();
          dim(style, model.BarSubElement);
          style.colors.set(model.BarSubElement.StandardNotationStaffLine, new model.Color(staffLine.r, staffLine.g, staffLine.b, contextInk.a));
        }
        for (const voice of bar.voices) {
          const focusedVoice = focusedStaff && voice.index === focused.voice;
          if (staffLine && !focusedVoice) dim(voice.style ??= new model.VoiceStyle(), model.VoiceSubElement);
          for (const beat of voice.beats) {
            visibleBeats.push(beat);
            if (!focusedVoice || !inRange(beat)) {
              dim(beat.style ??= new model.BeatStyle(), model.BeatSubElement);
              for (const note of beat.notes) dim(note.style ??= new model.NoteStyle(), model.NoteSubElement);
              if (beat.sourceBeamGroup) mutedBeams.add(beat.sourceBeamGroup);
            } else if (beat.nextBeat?.voice === voice && !inRange(beat.nextBeat)) {
              (beat.style ??= new model.BeatStyle()).colors.set(model.BeatSubElement.StandardNotationBeams, contextInk);
            }
          }
        }
      }
    }
  }
  // An authored cross-staff beam takes the color of its first member. In a
  // mixed group, mute the shared beam without changing its selected heads or stems.
  for (const beat of visibleBeats) if (mutedBeams.has(beat.sourceBeamGroup)) {
    (beat.style ??= new model.BeatStyle()).colors.set(model.BeatSubElement.StandardNotationBeams, contextInk);
  }
}
