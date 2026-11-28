import { model } from '@coderline/alphatab';
import type { QuestionBeats } from '../../shared/sight-singing';
import { practiceBeatAccent, type PracticeClick } from '../playback/practice-metronome';
import { beatsInVisit, ticksPerBeat, visitClock, visitWindow, type Melody, type MelodyScore, type MelodyVoice } from '../sight-singing/melody';

export type RhythmTarget = { time: number; visit: number; beatIndex: number };
export type RhythmError = 'noTargets' | 'unsupportedMelody' | 'tooLong';
export type RhythmTimeline = Pick<Melody, 'measures' | 'staffBeats'> & {
  targets: RhythmTarget[]; clicks: PracticeClick[]; duration: number;
  countBeats: number; countBeatSeconds: number; denominator: number; bpm: number;
};

export function rhythmVoices({ score }: MelodyScore): MelodyVoice[] {
  return score.tracks.flatMap(track => {
    const lanes = track.staves.flatMap((staff, staffIndex) => {
      const active = new Set<number>();
      for (const bar of staff.bars) for (const voice of bar.voices) {
        if (voice.beats.some(beat => beat.notes.some(note => !note.isCue))) active.add(voice.index);
      }
      return Array.from(active).sort((a, b) => a - b).map(voice => ({
        id: `${track.index}:${staffIndex}:${voice}`, track: track.index, staff: staffIndex, voice, name: track.name,
      }));
    });
    return lanes.map(lane => ({ ...lane, multiple: lanes.length > 1 }));
  });
}

/** Build against the expanded playback visits, using the same cuts and tempo clock as the score player. */
export function buildRhythmTimeline(document: MelodyScore, lane: MelodyVoice, first: number, last: number,
  { firstBeat, lastBeat }: QuestionBeats = {}): RhythmTimeline | RhythmError {
  const { bars, score } = document;
  const opening = bars[first], closing = bars[last];
  if (!opening || !closing || first > last || (firstBeat ?? 1) > beatsInVisit(opening) ||
    (lastBeat ?? 1) > beatsInVisit(closing)) return 'noTargets';
  const openingTick = opening.start + visitWindow(opening, firstBeat).from;
  const bpm = opening.tempoChanges.reduce((tempo, change) => change.tick <= openingTick ? change.tempo : tempo,
    visitClock(opening, score.tempo, 0).bpmAtStart);
  const denominator = opening.masterBar.timeSignatureDenominator;
  const countBeats = opening.masterBar.timeSignatureNumerator;
  const countBeatSeconds = 240 / (bpm * denominator);
  if (!Number.isFinite(countBeatSeconds) || countBeatSeconds <= 0 || countBeats < 1) return 'unsupportedMelody';
  const targets: RhythmTarget[] = [], clicks: PracticeClick[] = [];
  const measures: Melody['measures'] = [], staffBeats: Melody['staffBeats'] = [];
  const staff = score.tracks[lane.track].staves[lane.staff];
  let previousClock: ((tick: number) => number) | undefined;
  let seconds = -visitClock(opening, score.tempo, 0).toSeconds(openingTick);
  for (let visit = first; visit <= last; visit++) {
    const bar = bars[visit], master = bar.masterBar;
    const written = staff.bars[master.index];
    if (!written || written.simileMark !== model.SimileMark.None ||
      master.tripletFeel !== model.TripletFeel.NoTripletFeel) return 'unsupportedMelody';
    const { from, until } = visitWindow(bar, visit === first ? firstBeat : null, visit === last ? lastBeat : null);
    if (from >= until) return 'noTargets';
    const { toSeconds } = visitClock(bar, score.tempo, seconds);
    const end = toSeconds(bar.start + until);
    if (!Number.isFinite(end) || end <= 0 || end <= seconds) return 'unsupportedMelody';
    if (end > 300) return 'tooLong';
    const measure = { start: seconds, end, bar: master.index, visit,
      ...(from > 0 || until < bar.end - bar.start ? { clip: { from, until, duration: bar.end - bar.start } } : {}) };
    measures.push(measure);
    const unit = ticksPerBeat(bar);
    for (let beat = Math.ceil(from / unit); beat * unit < until; beat++) {
      clicks.push({ time: toSeconds(bar.start + beat * unit),
        accent: practiceBeatAccent(beat, master.timeSignatureNumerator, master.timeSignatureDenominator) });
    }
    const onsets = new Set<number>();
    for (const beat of written.voices[lane.voice]?.beats ?? []) {
      const tick = beat.playbackStart;
      if (tick >= until || tick < 0 && !previousClock) continue;
      // A before-beat grace in a later selected visit is heard on the
      // preceding visit's clock, including its tempo before the barline.
      const clock = tick < 0 ? previousClock ?? toSeconds : toSeconds;
      const time = clock(bar.start + tick), beatIndex = beat.index;
      const notes = beat.notes.filter(note => !note.isCue);
      staffBeats.push({ ...measure, start: time, end: toSeconds(bar.start + Math.min(until, tick + beat.playbackDuration)),
        beatIndex, pitches: [] });
      if (time < 0 || tick >= 0 && tick < from || !notes.length) continue;
      if (notes.some(note => note.repeatPasses !== null)) return 'unsupportedMelody';
      // A chord is one onset. A note tied from outside the cut still belongs to
      // its original attack. A silent cue can't sustain a following note.
      if (!onsets.has(tick) && notes.some(note => !note.tieOrigin || note.tieOrigin.isCue)) {
        onsets.add(tick);
        targets.push({ time, visit, beatIndex });
      }
    }
    previousClock = toSeconds;
    seconds = end;
  }
  if (!targets.length) return 'noTargets';
  return { targets: targets.sort((a, b) => a.time - b.time), measures, staffBeats, clicks,
    duration: seconds, countBeats, countBeatSeconds, denominator, bpm };
}
