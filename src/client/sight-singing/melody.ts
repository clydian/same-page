import * as alphaTab from '@coderline/alphatab';
import { loadPreparedMusicXml, prepareMusicXmlForPlaybackBytes } from '@same-page/player/engine';
import type { PreparedMusicXml } from '@same-page/player/musicxml-direction-timing';
import { playbackMeasureVisits } from '@same-page/player/playback-measures';
import { classifyTimbreRoles } from '@same-page/player/timbre-profile';
import type { QuestionBeats } from '../../shared/sight-singing';
import { practiceBeatAccent, type PracticeClick } from '../playback/practice-metronome';
import { pitchClass } from './staff-pitch';

export type MelodyError = 'noMelody' | 'ambiguousMelody' | 'unsupportedMelody' | 'tooLong';
export type PlaybackNote = { midi: number; chord?: number[]; start: number; end: number };
export type MelodyNote = PlaybackNote & { visit: number; bar: number; beatIndex?: number };
export const targetPitches = (note: PlaybackNote) => note.chord ?? [note.midi];
export type MelodyMeasure = { start: number; end: number; bar: number; visit: number; clip?: TickWindow & { duration: number } };
export type StaffBeat = MelodyMeasure & {
  beatIndex: number; pitches: number[];
  continuationOf?: Pick<MelodyNote, 'visit' | 'beatIndex'>;
};
type KeyChange = { start: number; signature: number; tonic: number };
export type Melody = {
  notes: MelodyNote[]; measures: MelodyMeasure[]; staffBeats: StaffBeat[]; clicks: PracticeClick[]; duration: number;
  keyChanges: KeyChange[]; leadIn: number; pickup: number;
  tempoMarks: { start: number; bpm: number }[];
  beatSeconds: number; beats: number; denominator: number; tonic: number; tempo: { bpm: number; unit: number };
};
export type MelodyVoice = { id: string; track: number; staff: number; voice: number; name: string; multiple: boolean };
type MidiNote = PlaybackNote & { visit: number };

function generatePlayback(score: alphaTab.model.Score, settings: alphaTab.Settings, solo?: MelodyVoice) {
  const events = new Map<number, MidiNote[]>();
  const handler = new alphaTab.midi.AlphaSynthMidiFileHandler(new alphaTab.midi.MidiFile());
  const generator = new alphaTab.midi.MidiFileGenerator(score, settings, handler);
  handler.addNote = (track, start, length, midi) => {
    if (solo && solo.track !== track) return;
    const notes = events.get(track) ?? [];
    notes.push({ midi, start, end: start + length, visit: generator.tickLookup.masterBars.length - 1 });
    events.set(track, notes);
  };

  // The native generator emits track IDs. Isolate a lane only when the track
  // contains several lanes. Keep all beats in place for repeats and pickups.
  const muted: alphaTab.model.Note[] = [];
  for (const track of solo ? [score.tracks[solo.track]] : score.tracks) {
    for (const staff of track.staves) for (const bar of staff.bars) for (const voice of bar.voices) {
      const otherLane = solo && (staff.index !== solo.staff || voice.index !== solo.voice);
      for (const beat of voice.beats) for (const note of beat.notes) {
        if (!note.isCue && (otherLane || note.isPercussion)) muted.push(note);
      }
    }
  }
  for (const note of muted) note.isCue = true;
  try { generator.generate(); }
  finally { for (const note of muted) note.isCue = false; }
  return { bars: generator.tickLookup.masterBars, events };
}

export function loadMelodyScore(input: Uint8Array | PreparedMusicXml) {
  const settings = new alphaTab.Settings();
  settings.importer.mergePartGroupsInMusicXml = false;
  const prepared = input instanceof Uint8Array ? prepareMusicXmlForPlaybackBytes(input) : input;
  const score = loadPreparedMusicXml(prepared, settings);
  if (score.tracks.length > 1) score.stylesheet.multiTrackTrackNamePolicy = alphaTab.model.TrackNamePolicy.AllSystems;
  const { bars, events } = generatePlayback(score, settings);
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
  const roles = classifyTimbreRoles(score.tracks, []);
  const hasVocalParts = voices.some(voice => roles[voice.track] === 'vocal');
  const singingVoices = hasVocalParts ? voices.filter(voice => roles[voice.track] !== 'accompaniment') : voices;
  const pickupTicks = bars.map(bar => bar.start);
  for (const notes of events.values()) for (const note of notes) {
    if (Number.isFinite(note.start) && note.start < pickupTicks[note.visit]) pickupTicks[note.visit] = note.start;
  }
  const lanes = new Map<string, MidiNote[]>();
  const playbackFor = (voice: MelodyVoice) => {
    if (!voice.multiple) return events.get(voice.track) ?? [];
    const cached = lanes.get(voice.id);
    if (cached) return cached;
    const notes = generatePlayback(score, settings, voice).events.get(voice.track) ?? [];
    lanes.set(voice.id, notes);
    return notes;
  };
  return { score, bars, visits, voices, singingVoices, pickupTicks, playbackFor };
}
export type MelodyScore = ReturnType<typeof loadMelodyScore>;
type ScoreBar = MelodyScore['bars'][number];
type TickWindow = { from: number; until: number };
export const ticksPerBeat = (bar: ScoreBar) => Math.max(1, Math.floor(3840 / bar.masterBar.timeSignatureDenominator));

export function beatsInVisit(bar: ScoreBar) {
  return Math.ceil((bar.end - bar.start) / ticksPerBeat(bar));
}

/** Offsets in the actual expanded visit, including shortened pickup measures. */
export function visitWindow(bar: ScoreBar, firstBeat?: number | null, lastBeat?: number | null): TickWindow {
  const beatTicks = ticksPerBeat(bar), duration = bar.end - bar.start;
  return { from: ((firstBeat ?? 1) - 1) * beatTicks, until: lastBeat == null ? duration : Math.min(duration, lastBeat * beatTicks) };
}

export function visitClock(bar: ScoreBar, scoreTempo: number, seconds: number) {
  const changes = bar.tempoChanges;
  const bpmAtStart = changes.reduce((bpm, change) => change.tick <= bar.start ? change.tempo : bpm,
    changes[0]?.tempo ?? scoreTempo);
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
  return { bpmAtStart, toSeconds };
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
  // Before-beat grace notes can fall before the opening bar line.
  const pickup = opening.start === document.pickupTicks[first] ? 0
    : -visitClock(opening, document.score.tempo, 0).toSeconds(document.pickupTicks[first]);
  let seconds = pickup, leadIn = 0;
  for (const [offset, bar] of selected.entries()) {
    const master = bar.masterBar;
    const source = staff.bars[master.index];
    if (!source || source.simileMark !== alphaTab.model.SimileMark.None || master.tripletFeel !== alphaTab.model.TripletFeel.NoTripletFeel) return 'unsupportedMelody';
    const changes = bar.tempoChanges;
    const clip = visitWindow(bar, offset === 0 ? firstBeat : null, bar === closing ? lastBeat : null);
    const scoredStart = bar.start + clip.from, clipEnd = bar.start + clip.until;
    if (scoredStart >= clipEnd) return 'noMelody';
    const { bpmAtStart, toSeconds } = visitClock(bar, document.score.tempo, seconds);
    if (offset === 0) leadIn = toSeconds(scoredStart);
    const end = toSeconds(clipEnd);
    if (!Number.isFinite(end) || end <= seconds) return 'unsupportedMelody';
    if (end - leadIn > 300) return 'tooLong';
    const visit = first + offset;
    measures.push({ start: offset === 0 ? 0 : seconds, end, bar: master.index, visit,
      ...(scoredStart !== bar.start || clipEnd !== bar.end ? { clip: { ...clip, duration: bar.end - bar.start } } : {}) });
    addTempo(offset === 0 ? 0 : seconds, bpmAtStart);
    for (const change of changes) {
      if (change.tick > bar.start && change.tick < clipEnd) addTempo(toSeconds(change.tick), change.tempo);
    }
    addKey(offset === 0 ? 0 : seconds, source.getKeySignatureAt(0), source.getKeySignatureTypeAt(0));
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
      if (beat.graceType !== alphaTab.model.GraceType.None) continue;
      const written = beat.notes.filter(note => !note.isCue && !note.isPercussion).sort((a, b) => a.realValue - b.realValue);
      const startTick = Math.max(0, beat.playbackStart) + bar.start;
      if (cropped && startTick >= clipEnd) break;
      const priorVisit = document.bars[visit - 1];
      const continuesIntoOpening = cropped && offset === 0 && startTick === bar.start && priorVisit;
      const carry = written.filter(note => note.tieOrigin && (omitted.includes(note.tieOrigin) ||
        continuesIntoOpening && note.tieOrigin.beat.voice.bar.masterBar === priorVisit.masterBar));
      omitted = carry;
      const sounding = written.filter(note => !carry.includes(note));
      if (sounding.some(note => note.repeatPasses !== null)) {
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
  return { notes, measures, staffBeats, clicks, keyChanges, tempoMarks, duration: seconds, leadIn, pickup, beatSeconds, beats, denominator, tonic, tempo: { bpm, unit } };
}

export function voicePlayback(document: MelodyScore, voice: MelodyVoice, melody: Melody,
  purpose: 'backing' | 'answer' = 'backing'): PlaybackNote[] | null {
  const opening = melody.measures[0], closing = melody.measures.at(-1)!;
  const bars = document.bars.slice(opening.visit, closing.visit + 1);
  const clocks = bars.map((bar, index) => visitClock(bar, document.score.tempo,
    index === 0 ? melody.pickup : melody.measures[index].start));
  const firstTick = bars[0].start;
  const answerStart = purpose === 'answer' && opening.clip?.from ? firstTick + opening.clip.from : undefined;
  const firstTarget = answerStart === undefined ? undefined
    : melody.notes.find(note => note.visit === opening.visit && note.start >= melody.leadIn);
  const source = document.score.tracks[voice.track].staves[voice.staff].bars[opening.bar]?.voices[voice.voice];
  const beforeBeat = firstTarget?.beatIndex === undefined ? [] : source?.beats[firstTarget.beatIndex]?.graceGroup?.beats
    .filter(beat => beat.voice === source && beat.graceType === alphaTab.model.GraceType.BeforeBeat) ?? [];
  // Match the first target's written grace group to native attacks in this lane and visit.
  const isOpeningGrace = (event: MidiNote) => event.visit === opening.visit && beforeBeat.some(beat =>
    event.start === firstTick + beat.playbackStart && beat.notes.some(note => !note.isCue && !note.isPercussion && note.realValue === event.midi));
  const lastBar = bars.at(-1)!;
  const lastTick = closing.clip ? lastBar.start + closing.clip.until : lastBar.end;
  const toSeconds = (tick: number) => {
    let index = bars.length - 1;
    while (index > 0 && bars[index].start > tick) index--;
    return Math.max(0, clocks[index].toSeconds(tick));
  };
  const notes: PlaybackNote[] = [];
  for (const event of document.playbackFor(voice)) {
    if (event.visit > closing.visit || event.start >= lastTick) continue;
    if (event.visit < opening.visit && (opening.clip || event.end <= firstTick)) continue;
    if (answerStart !== undefined && event.start < answerStart && !isOpeningGrace(event)) continue;
    const start = toSeconds(event.visit < opening.visit ? firstTick : event.start);
    const end = toSeconds(Math.min(event.end, lastTick));
    if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isInteger(event.midi) || event.midi < 0 || event.midi > 127) return null;
    if (end > start) notes.push({ midi: event.midi, start, end });
  }
  notes.sort((a, b) => a.start - b.start || a.end - b.end);
  const chords: PlaybackNote[] = [];
  for (const note of notes) {
    const previous = chords.at(-1);
    if (previous && previous.start === note.start && previous.end === note.end) {
      const chord = previous.chord ??= [previous.midi];
      if (!chord.includes(note.midi)) chord.push(note.midi);
    } else chords.push(note);
  }
  return chords;
}

export function melodyAtSpeed(melody: Melody, speed: number): Melody {
  if (speed === 1) return melody;
  const scale = <T extends { start: number; end: number }>(item: T) => ({ ...item, start: item.start / speed, end: item.end / speed });
  return { ...melody, notes: melody.notes.map(scale), measures: melody.measures.map(scale), staffBeats: melody.staffBeats.map(scale),
    keyChanges: melody.keyChanges.map(key => ({ ...key, start: key.start / speed })),
    tempoMarks: melody.tempoMarks.map(mark => ({ start: mark.start / speed, bpm: mark.bpm * speed })),
    clicks: melody.clicks.map(click => ({ ...click, time: click.time / speed })),
    duration: melody.duration / speed, leadIn: melody.leadIn / speed, pickup: melody.pickup / speed, beatSeconds: melody.beatSeconds / speed };
}
