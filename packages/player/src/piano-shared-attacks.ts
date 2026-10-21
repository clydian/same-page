import * as alphaTab from '@coderline/alphatab';

type Note = [track: number, start: number, length: number, key: number, velocity: number, channel: number];
interface Pair { on?: alphaTab.midi.NoteOnEvent; off?: alphaTab.midi.NoteOffEvent }
const isAcousticPiano = (track: alphaTab.model.Track) =>
  !track.isPercussion && track.playbackInfo.program === 0 && track.playbackInfo.bank === 0 &&
  /(?:\bpiano\b|\bpianoforte\b|钢琴|^\s*keyboard\s+reduction(?:\s+\(for\s+rehearsal\s+only\))?\s*$)/iu.test(track.name);
const identity = (track: number, tick: number, channel: number, key: number) => `${track}:${tick}:${channel}:${key}`;

/** Capture exact native event pairs without postponing their insertion. Keeping
 * their identity avoids guessing which note-off belongs to a later reattack. */
class CapturedMidi extends alphaTab.midi.MidiFile {
  capture: Pair | null = null;
  override addEvent(event: alphaTab.midi.MidiEvent): void {
    super.addEvent(event);
    if (this.capture) {
      if (event instanceof alphaTab.midi.NoteOnEvent) this.capture.on = event;
      if (event instanceof alphaTab.midi.NoteOffEvent) this.capture.off = event;
    }
  }
}
class PianoMidiHandler extends alphaTab.midi.AlphaSynthMidiFileHandler {
  readonly pairs: Pair[] = [];
  private readonly file: CapturedMidi;
  constructor(file: CapturedMidi) { super(file); this.file = file; }
  override addNote(...note: Note): void {
    const pair: Pair = {};
    this.file.capture = pair;
    try { super.addNote(...note); } finally { this.file.capture = null; }
    this.pairs.push(pair);
  }
}

function mergePairs(score: alphaTab.model.Score, file: CapturedMidi, pairs: Pair[]): number {
  const byOn = new Map(pairs.filter(pair => pair.on && pair.off).map(pair => [pair.on!, pair]));
  const groups = new Map<string, Pair[]>();
  const programs = new Map<number, number>(), coarseBanks = new Map<number, number>(), fineBanks = new Map<number, number>();
  // AlphaTabApi produces one physical MIDI track with logical event.track IDs.
  // Iterate its original event order so same-tick program/bank changes apply only
  // to subsequent NoteOns, just as they do in the synthesizer.
  for (const event of file.tracks[0].events) {
    if (event instanceof alphaTab.midi.ProgramChangeEvent) programs.set(event.channel, event.program);
    if (event instanceof alphaTab.midi.ControlChangeEvent) {
      if (event.controller === alphaTab.midi.ControllerType.BankSelectCoarse) coarseBanks.set(event.channel, event.value);
      if (event.controller === alphaTab.midi.ControllerType.BankSelectFine) fineBanks.set(event.channel, event.value);
    }
    if (!(event instanceof alphaTab.midi.NoteOnEvent)) continue;
    const pair = byOn.get(event), track = score.tracks[event.track];
    if (!pair || !track || !isAcousticPiano(track) || event.channel === 9 ||
        (programs.get(event.channel) ?? track.playbackInfo.program) !== 0 ||
        (coarseBanks.get(event.channel) ?? 0) !== 0 || (fineBanks.get(event.channel) ?? 0) !== 0) continue;
    const key = identity(event.track, event.tick, event.channel, event.noteKey);
    const group = groups.get(key) ?? []; group.push(pair); groups.set(key, group);
  }
  const removed = new Set<alphaTab.midi.MidiEvent>();
  let changed = 0;
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const first = group[0];
    const longest = group.reduce((a, b) => a.off!.tick >= b.off!.tick ? a : b);
    first.on!.noteVelocity = group.reduce((value, pair) => Math.max(value, pair.on!.noteVelocity), first.on!.noteVelocity);
    for (const pair of group) {
      if (pair !== first) removed.add(pair.on!);
      if (pair !== longest) removed.add(pair.off!);
    }
    changed++;
  }
  if (changed) {
    const events = file.tracks[0].events;
    let write = 0;
    for (const event of events) if (!removed.has(event)) events[write++] = event;
    events.length = write;
  }
  return changed;
}

/** Receives native AlphaTabApi MIDI (applyTranspositionPitches=false) at the
 * public midiLoad seam before synthesis. Source, notation model and tick lookup
 * remain intact. Native audio export is a separate, unchanged path. */
export function preparePianoPlaybackMidi(score: alphaTab.model.Score, file: alphaTab.midi.MidiFile, settings: alphaTab.Settings): number {
  if (file.format !== alphaTab.midi.MidiFileFormat.SingleTrackMultiChannel) return 0;
  const seen = new Set<string>();
  let candidate = false;
  for (const event of file.tracks[0]?.events ?? []) {
    if (!(event instanceof alphaTab.midi.NoteOnEvent) || !score.tracks[event.track] || !isAcousticPiano(score.tracks[event.track])) continue;
    const key = identity(event.track, event.tick, event.channel, event.noteKey);
    if (seen.has(key)) { candidate = true; break; }
    seen.add(key);
  }
  if (!candidate) return 0;
  const repaired = new CapturedMidi(); repaired.division = file.division;
  const handler = new PianoMidiHandler(repaired);
  const generator = new alphaTab.midi.MidiFileGenerator(score, settings, handler);
  generator.applyTranspositionPitches = false; generator.generate();
  const changed = mergePairs(score, repaired, handler.pairs);
  if (changed) {
    file.tracks.length = 0;
    for (const track of repaired.tracks) file.tracks.push(track);
    file.tickShift = repaired.tickShift;
  }
  return changed;
}

export function bindPianoMidiCorrection(api: Pick<alphaTab.AlphaTabApi, 'midiLoad' | 'score' | 'settings'>): void {
  api.midiLoad.on(file => {
    if (api.score) preparePianoPlaybackMidi(api.score, file, api.settings);
  });
}
