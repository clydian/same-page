import * as alphaTab from '@coderline/alphatab';
import { loadPreparedMusicXml, prepareMusicXmlForPlaybackBytes } from '@same-page/player/engine';
import type { PreparedMusicXml } from '@same-page/player/musicxml-direction-timing';
import { playbackMeasureVisits } from '@same-page/player/playback-measures';
import type { QuestionBeats } from '../../shared/sight-singing';
import { practiceBeatAccent, type PracticeClick } from '../playback/practice-metronome';
import { pitchClass } from './staff-pitch';

export type MelodyError = 'noMelody' | 'ambiguousMelody' | 'unsupportedMelody' | 'tooLong';
export type MelodyNote = { midi: number; chord?: number[]; start: number; end: number; visit: number; bar: number; beatIndex?: number };
export const targetPitches = (note: MelodyNote) => note.chord ?? [note.midi];
export type MelodyMeasure = { start: number; end: number; bar: number; visit: number; clip?: TickWindow & { duration: number } };
export type StaffBeat = MelodyMeasure & {
  beatIndex: number; pitches: number[];
  continuationOf?: Pick<MelodyNote, 'visit' | 'beatIndex'>;
};
type KeyChange = { start: number; signature: number; tonic: number };
export type Melody = {
  notes: MelodyNote[]; measures: MelodyMeasure[]; staffBeats: StaffBeat[]; clicks: PracticeClick[]; duration: number;
  keyChanges: KeyChange[]; leadIn: number;
  tempoMarks: { start: number; bpm: number }[];
  beatSeconds: number; beats: number; denominator: number; tonic: number; tempo: { bpm: number; unit: number };
};
export type MelodyVoice = { id: string; track: number; staff: number; voice: number; name: string; multiple: boolean };

export function loadMelodyScore(input: Uint8Array | PreparedMusicXml) {
  const settings = new alphaTab.Settings();
  settings.importer.mergePartGroupsInMusicXml = false;
  const prepared = input instanceof Uint8Array ? prepareMusicXmlForPlaybackBytes(input) : input;
  const score = loadPreparedMusicXml(prepared, settings);
  if (score.tracks.length > 1) score.stylesheet.multiTrackTrackNamePolicy = alphaTab.model.TrackNamePolicy.AllSystems;
  const midi = new alphaTab.midi.MidiFile();
  const generator = new alphaTab.midi.MidiFileGenerator(score, settings, new alphaTab.midi.AlphaSynthMidiFileHandler(midi));
  generator.generate();
  const bars = generator.tickLookup.masterBars;
  const visits = playbackMeasureVisits(bars.map(({ masterBar }) => prepared.measureLabels?.[masterBar.index] ?? String(masterBar.index + 1)));
  const voices = score.tracks.flatMap(track => {
    if (track.isPercussion) return [];
    const candidates = track.staves.flatMap((staff, staffIndex) => {
      const used = new Set<number>();
      for (const bar of staff.bars) for (const voice of bar.voices) {
        if (voice.beats.some(beat => beat.notes.some(note => !note.isCue && !note.isPercussion))) used.add(voice.index);
      }
      return [...used].sort((a, b) => a - b).map(voice => ({
        id: `${track.index}:${staffIndex}:${voice}`, track: track.index, staff: staffIndex, voice, name: track.name,
      }));
    });
    return candidates.map(voice => ({ ...voice, multiple: candidates.length > 1 }));
  });
  return { score, bars, visits, voices };
}
export type MelodyScore = ReturnType<typeof loadMelodyScore>;
type ScoreBar = MelodyScore['bars'][number];
type TickWindow = { from: number; until: number };
const ticksPerBeat = (bar: ScoreBar) => Math.max(1, Math.floor(3840 / bar.masterBar.timeSignatureDenominator));

export function beatsInVisit(bar: ScoreBar) {
  return Math.ceil((bar.end - bar.start) / ticksPerBeat(bar));
}

/** Offsets in the actual expanded visit, including shortened pickup measures. */
export function visitWindow(bar: ScoreBar, firstBeat?: number | null, lastBeat?: number | null): TickWindow {
  const beatTicks = ticksPerBeat(bar), duration = bar.end - bar.start;
  return { from: ((firstBeat ?? 1) - 1) * beatTicks, until: lastBeat == null ? duration : Math.min(duration, lastBeat * beatTicks) };
}

/** Times are relative to the selected playback visit, including changes inside a bar. */
export function buildMelody(document: MelodyScore, voice: MelodyVoice, first: number, last: number,
  { firstBeat, lastBeat }: QuestionBeats = {}): Melody | MelodyError {
  if (first < 0 || last < first || last >= document.bars.length) return 'noMelody';
  const selected = document.bars.slice(first, last + 1);
  const opening = selected[0], closing = selected[selected.length - 1];
  if ((firstBeat ?? 1) > beatsInVisit(opening) || (lastBeat ?? 1) > beatsInVisit(closing)) return 'noMelody';
  const cropped = (firstBeat ?? 1) > 1 || lastBeat != null && lastBeat < beatsInVisit(closing);
  const staff = document.score.tracks[voice.track].staves[voice.staff];
  const notes: MelodyNote[] = [], measures: MelodyMeasure[] = [], staffBeats: StaffBeat[] = [], clicks: PracticeClick[] = [];
  const keyChanges: KeyChange[] = [];
  const tempoMarks: Melody['tempoMarks'] = [];
  const addTempo = (start: number, bpm: number) => {
    if (tempoMarks.at(-1)?.bpm !== bpm) tempoMarks.push({ start, bpm });
  };
  const addKey = (start: number, signature: number, type: alphaTab.model.KeySignatureType) => {
    const tonic = pitchClass(signature * 7 + (type === alphaTab.model.KeySignatureType.Minor ? 9 : 0));
    const previous = keyChanges.at(-1);
    if (previous?.signature !== signature || previous.tonic !== tonic) keyChanges.push({ start, signature, tonic });
  };
  let previous: alphaTab.model.Note[] = [], omitted: alphaTab.model.Note[] = [];
  let seconds = 0, leadIn = 0;
  for (const [offset, bar] of selected.entries()) {
    const master = bar.masterBar;
    const source = staff.bars[master.index];
    if (!source || source.simileMark !== alphaTab.model.SimileMark.None || master.tripletFeel !== alphaTab.model.TripletFeel.NoTripletFeel) return 'unsupportedMelody';
    const changes = bar.tempoChanges;
    const clip = visitWindow(bar, offset === 0 ? firstBeat : null, bar === closing ? lastBeat : null);
    const scoredStart = bar.start + clip.from, clipEnd = bar.start + clip.until;
    if (scoredStart >= clipEnd) return 'noMelody';
    const bpmAtStart = changes.reduce((bpm, change) => change.tick <= bar.start ? change.tempo : bpm,
      changes[0]?.tempo ?? document.score.tempo);
    const toSeconds = (tick: number) => {
      let result = seconds, from = bar.start, bpm = bpmAtStart;
      for (const change of changes) {
        if (change.tick <= bar.start) continue;
        if (change.tick >= tick) break;
        result += (change.tick - from) * 60 / (960 * bpm);
        from = change.tick;
        bpm = change.tempo;
      }
      return result + (tick - from) * 60 / (960 * bpm);
    };
    if (offset === 0) leadIn = toSeconds(scoredStart);
    const end = toSeconds(clipEnd);
    if (!Number.isFinite(end) || end <= seconds) return 'unsupportedMelody';
    if (end - leadIn > 300) return 'tooLong';
    const visit = first + offset;
    measures.push({ start: seconds, end, bar: master.index, visit,
      ...(scoredStart !== bar.start || clipEnd !== bar.end ? { clip: { ...clip, duration: bar.end - bar.start } } : {}) });
    addTempo(seconds, bpmAtStart);
    for (const change of changes) {
      if (change.tick > bar.start && change.tick < clipEnd) addTempo(toSeconds(change.tick), change.tempo);
    }
    addKey(seconds, source.getKeySignatureAt(0), source.getKeySignatureTypeAt(0));
    for (const { displayStart, keySignature, keySignatureType } of source.notationChanges ?? []) {
      if ((keySignature !== null || keySignatureType !== null) && displayStart > 0 && displayStart < clip.until) {
        addKey(toSeconds(bar.start + displayStart), source.getKeySignatureAt(displayStart), source.getKeySignatureTypeAt(displayStart));
      }
    }
    const beatTicks = ticksPerBeat(bar);
    for (let beat = 0, tick = bar.start; tick < clipEnd; beat++, tick += beatTicks) {
      clicks.push({ time: toSeconds(tick), accent: practiceBeatAccent(beat, master.timeSignatureNumerator, master.timeSignatureDenominator) });
    }
    for (const beat of source.voices[voice.voice]?.beats ?? []) {
      const written = beat.notes.filter(note => !note.isCue).sort((a, b) => a.realValue - b.realValue);
      const startTick = Math.max(0, beat.playbackStart) + bar.start;
      if (cropped && startTick >= clipEnd) break;
      const priorVisit = document.bars[visit - 1];
      const continuesIntoOpening = cropped && offset === 0 && startTick === bar.start && priorVisit;
      const carry = written.filter(note => note.tieOrigin && (omitted.includes(note.tieOrigin) ||
        continuesIntoOpening && note.tieOrigin.beat.voice.bar.masterBar === priorVisit.masterBar));
      omitted = carry;
      const sounding = written.filter(note => !carry.includes(note));
      if (sounding.length && (sounding.some(note => note.isPercussion || note.repeatPasses !== null) || beat.graceType !== alphaTab.model.GraceType.None)) {
        if (startTick >= scoredStart) return 'unsupportedMelody';
        omitted = written;
        continue;
      }
      const endTick = Math.min(clipEnd, bar.start + beat.playbackStart + beat.playbackDuration);
      if (endTick <= startTick) {
        if (sounding.length) return 'unsupportedMelody';
        continue;
      }
      const start = toSeconds(startTick), noteEnd = toSeconds(endTick);
      const pitches = [...new Set(sounding.map(note => note.realValue))];
      const staffBeat: StaffBeat = { start, end: noteEnd, bar: master.index, visit, beatIndex: beat.index, pitches };
      staffBeats.push(staffBeat);
      if (!pitches.length) continue;
      const [midi] = pitches;
      const lastNote = notes.at(-1);
      if (lastNote && lastNote.end - start > .00001) return 'ambiguousMelody';
      if (lastNote && sounding.length === previous.length && sounding.every((note, index) => note.tieOrigin === previous[index] && note.realValue === previous[index].realValue) && Math.abs(lastNote.end - start) < .00001) {
        lastNote.end = noteEnd;
        staffBeat.continuationOf = { visit: lastNote.visit, beatIndex: lastNote.beatIndex };
      } else {
        notes.push({ midi, ...(pitches.length > 1 && { chord: pitches }), start, end: noteEnd, visit, bar: master.index, beatIndex: beat.index });
      }
      previous = sounding;
    }
    seconds = end;
  }
  if (!notes.some(note => note.start >= leadIn)) return 'noMelody';
  const denominator = opening.masterBar.timeSignatureDenominator;
  const unit = 4 / denominator;
  const bpm = tempoMarks[0].bpm;
  const beatSeconds = 60 / bpm * unit;
  const beats = Math.max(1, opening.masterBar.timeSignatureNumerator);
  const key = keyChanges[0].signature * 7 + (opening.masterBar.keySignatureType === alphaTab.model.KeySignatureType.Minor ? 9 : 0);
  const tonic = 48 + (key % 12 + 12) % 12;
  return { notes, measures, staffBeats, clicks, keyChanges, tempoMarks, duration: seconds, leadIn, beatSeconds, beats, denominator, tonic, tempo: { bpm, unit } };
}

export function melodyAtSpeed(melody: Melody, speed: number): Melody {
  if (speed === 1) return melody;
  const scale = <T extends { start: number; end: number }>(item: T) => ({ ...item, start: item.start / speed, end: item.end / speed });
  return { ...melody, notes: melody.notes.map(scale), measures: melody.measures.map(scale), staffBeats: melody.staffBeats.map(scale),
    keyChanges: melody.keyChanges.map(key => ({ ...key, start: key.start / speed })),
    tempoMarks: melody.tempoMarks.map(mark => ({ start: mark.start / speed, bpm: mark.bpm * speed })),
    clicks: melody.clicks.map(click => ({ ...click, time: click.time / speed })),
    duration: melody.duration / speed, leadIn: melody.leadIn / speed, beatSeconds: melody.beatSeconds / speed };
}
