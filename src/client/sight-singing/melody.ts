import * as alphaTab from '@coderline/alphatab';
import { loadPreparedMusicXml, prepareMusicXmlForPlaybackBytes } from '@same-page/player/engine';
import { playbackMeasureVisits } from '@same-page/player/playback-measures';

export type MelodyError = 'noMelody' | 'ambiguousMelody' | 'unsupportedMelody' | 'tooLong';
export type MelodyNote = { midi: number; chord?: number[]; start: number; end: number; visit: number; bar: number; beatIndex?: number };
export const targetPitches = (note: MelodyNote) => note.chord ?? [note.midi];
export type MelodyMeasure = { start: number; end: number; bar: number; visit: number };
export type Melody = { notes: MelodyNote[]; measures: MelodyMeasure[]; duration: number; beatSeconds: number; beats: number; tonic: number };
export type MelodyVoice = { id: string; track: number; staff: number; voice: number; name: string; multiple: boolean };

export function loadMelodyScore(bytes: Uint8Array) {
  const settings = new alphaTab.Settings();
  settings.importer.mergePartGroupsInMusicXml = false;
  const prepared = prepareMusicXmlForPlaybackBytes(bytes);
  const score = loadPreparedMusicXml(prepared, settings);
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

/** Times are relative to the selected playback visit, including changes inside a bar. */
export function buildMelody(document: MelodyScore, voice: MelodyVoice, first: number, last: number): Melody | MelodyError {
  if (first < 0 || last < first || last >= document.bars.length) return 'noMelody';
  const selected = document.bars.slice(first, last + 1);
  const staff = document.score.tracks[voice.track].staves[voice.staff];
  const notes: MelodyNote[] = [], measures: MelodyMeasure[] = [];
  let previous: alphaTab.model.Note[] = [];
  let seconds = 0;
  for (const [offset, bar] of selected.entries()) {
    const master = bar.masterBar;
    const source = staff.bars[master.index];
    if (!source || source.simileMark !== alphaTab.model.SimileMark.None || master.tripletFeel !== alphaTab.model.TripletFeel.NoTripletFeel) return 'unsupportedMelody';
    const changes = bar.tempoChanges;
    const toSeconds = (tick: number) => {
      let result = seconds, from = bar.start, bpm = changes[0]?.tempo ?? document.score.tempo;
      for (const change of changes) {
        if (change.tick >= tick) break;
        result += (change.tick - from) * 60 / (960 * bpm);
        from = change.tick;
        bpm = change.tempo;
      }
      return result + (tick - from) * 60 / (960 * bpm);
    };
    const end = toSeconds(bar.end);
    if (!Number.isFinite(end) || end <= seconds) return 'unsupportedMelody';
    if (end > 300) return 'tooLong';
    const visit = first + offset;
    measures.push({ start: seconds, end, bar: master.index, visit });
    for (const beat of source.voices[voice.voice]?.beats ?? []) {
      const sounding = beat.notes.filter(note => !note.isCue).sort((a, b) => a.realValue - b.realValue);
      if (!sounding.length) continue;
      if (sounding.some(note => note.isPercussion || note.repeatPasses !== null) || beat.graceType !== alphaTab.model.GraceType.None) return 'unsupportedMelody';
      const startTick = Math.max(0, beat.playbackStart) + bar.start;
      const endTick = Math.min(bar.end, bar.start + beat.playbackStart + beat.playbackDuration);
      if (endTick <= startTick) return 'unsupportedMelody';
      const start = toSeconds(startTick), noteEnd = toSeconds(endTick);
      const pitches = [...new Set(sounding.map(note => note.realValue))];
      const [midi] = pitches;
      const lastNote = notes.at(-1);
      if (lastNote && lastNote.end - start > .00001) return 'ambiguousMelody';
      if (lastNote && sounding.length === previous.length && sounding.every((note, index) => note.tieOrigin === previous[index] && note.realValue === previous[index].realValue) && Math.abs(lastNote.end - start) < .00001) {
        lastNote.end = noteEnd;
      } else {
        notes.push({ midi, ...(pitches.length > 1 && { chord: pitches }), start, end: noteEnd, visit, bar: master.index, beatIndex: beat.index });
      }
      previous = sounding;
    }
    seconds = end;
  }
  if (notes.length === 0) return 'noMelody';
  const opening = selected[0];
  const unit = 4 / opening.masterBar.timeSignatureDenominator;
  const beatSeconds = 60 / (opening.tempoChanges[0]?.tempo ?? document.score.tempo) * unit;
  const beats = Math.min(8, Math.max(1, opening.masterBar.timeSignatureNumerator));
  const key = opening.masterBar.keySignature * 7 + (opening.masterBar.keySignatureType === alphaTab.model.KeySignatureType.Minor ? 9 : 0);
  const tonic = 48 + (key % 12 + 12) % 12;
  return { notes, measures, duration: seconds, beatSeconds, beats, tonic };
}
