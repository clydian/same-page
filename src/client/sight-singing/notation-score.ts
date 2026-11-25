import { model, Settings } from '@coderline/alphatab';
import type { MelodyVoice } from './melody';

export type ScoreView = 'line' | 'part' | 'full';
export type Part = Pick<MelodyVoice, 'track' | 'staff' | 'voice'>;

export const samePart = (a: Part, b: Part) => a.track === b.track && a.staff === b.staff && a.voice === b.voice;

const contextInk = new model.Color(0, 0, 0, 133);

function dim<T extends number>(style: { colors: Map<T, model.Color | null> }, elements: Record<string, string | T>) {
  for (const element of Object.values(elements)) {
    if (typeof element === 'number') style.colors.set(element, contextInk);
  }
}

export function notationScore(source: model.Score, part: Part, full: boolean, firstBar: number, lastBar: number) {
  // AlphaTab owns engraving and serializes these model styles to its render worker.
  // Keep the model used for capture, playback and scoring independent of the display.
  const settings = new Settings();
  const score = model.JsonConverter.jsObjectToScore(model.JsonConverter.scoreToJsObject(source), settings);
  if (!full) {
    const track = score.tracks[part.track];
    for (const staff of track.staves) {
      if (staff.index !== part.staff) { staff.showStandardNotation = false; continue; }
      for (const bar of staff.bars) {
        const voice = bar.voices[part.voice] ?? new model.Voice();
        if (!voice.beats.length) {
          const rest = new model.Beat();
          rest.isEmpty = true;
          voice.addBeat(rest);
        }
        bar.voices = [];
        bar.addVoice(voice);
      }
      staff.filledVoices.clear();
    }
    score.finish(settings);
    return { score, tracks: [part.track], part: { ...part, voice: 0 } };
  }

  const staffLine = settings.display.resources.staffLineColor;
  const contextStaffLine = new model.Color(staffLine.r, staffLine.g, staffLine.b, contextInk.a);
  for (const track of score.tracks) {
    if (track.index !== part.track) dim(track.style ??= new model.TrackStyle(), model.TrackSubElement);
    for (const staff of track.staves) {
      const focusedStaff = track.index === part.track && staff.index === part.staff;
      for (const bar of staff.bars.slice(firstBar, lastBar + 1)) {
        if (!focusedStaff) {
          const style = bar.style ??= new model.BarStyle();
          dim(style, model.BarSubElement);
          style.colors.set(model.BarSubElement.StandardNotationStaffLine, contextStaffLine);
        }
        for (const voice of bar.voices) {
          if (focusedStaff && voice.index === part.voice) continue;
          dim(voice.style ??= new model.VoiceStyle(), model.VoiceSubElement);
          for (const beat of voice.beats) {
            dim(beat.style ??= new model.BeatStyle(), model.BeatSubElement);
            for (const note of beat.notes) dim(note.style ??= new model.NoteStyle(), model.NoteSubElement);
          }
        }
      }
    }
  }
  return { score, tracks: score.tracks.map(track => track.index), part };
}
