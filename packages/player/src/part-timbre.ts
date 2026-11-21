import * as at from '@coderline/alphatab';
import { TONE_PROFILES } from './timbre-profile.ts';

export type DefaultPartTimbre = 'piano' | 'aahs' | 'oohs' | 'harp';
const defaultPrograms = new Map<number, DefaultPartTimbre>([[0, 'piano'], [46, 'harp'], [52, 'aahs'], [53, 'oohs']]);

export type PartTimbre = 'score' | 'piano' | 'aahs' | 'oohs';
const programs = { piano: 0, aahs: TONE_PROFILES.choir.program, oohs: 53 } as const;
export const isPartTimbre = (value: string): value is PartTimbre => value === 'score' || Object.hasOwn(programs, value);

/** Owns only the post-processed, session-local MIDI. Restoring a part restores
 * every original program/bank event, including instrument automation. */
export class PartTimbres {
  private originals = new WeakMap<at.midi.MidiEvent, number>();
  private defaults: Map<number, DefaultPartTimbre | null> | undefined;
  private choices = new Map<number, PartTimbre>();
  private score: at.model.Score;
  constructor(score: at.model.Score) { this.score = score; }
  get(id: number): PartTimbre { return this.choices.get(id) ?? 'score'; }
  getDefault(id: number): DefaultPartTimbre | null { return this.defaults?.get(id) ?? null; }
  private captureDefaults(file: at.midi.MidiFile) {
    // Inspect the prepared baseline at actual note attacks. Silent program changes
    // and repeated declarations do not imply a different sounding instrument.
    const channels = new Map<number, { program?: number; coarse: number; fine: number }>();
    const sounds = new Map<number, Set<string>>();
    for (const event of file.events) {
      if (!(event instanceof at.midi.ProgramChangeEvent || event instanceof at.midi.ControlChangeEvent || event instanceof at.midi.NoteOnEvent)) continue;
      const channel = channels.get(event.channel) ?? { coarse: 0, fine: 0 };
      channels.set(event.channel, channel);
      if (event instanceof at.midi.ProgramChangeEvent) channel.program = event.program;
      else if (event instanceof at.midi.ControlChangeEvent) {
        if (event.controller === at.midi.ControllerType.BankSelectCoarse) channel.coarse = event.value;
        if (event.controller === at.midi.ControllerType.BankSelectFine) channel.fine = event.value;
      } else if (event.noteVelocity > 0) {
        const values = sounds.get(event.channel) ?? new Set<string>();
        values.add(`${channel.coarse}:${channel.fine}:${channel.program ?? '?'}`); sounds.set(event.channel, values);
      }
    }
    this.defaults = new Map(this.score.tracks.map(track => {
      const values = new Set([...(sounds.get(track.playbackInfo.primaryChannel) ?? []), ...(sounds.get(track.playbackInfo.secondaryChannel) ?? [])]);
      const sound = values.size === 1 ? [...values][0].split(':') : [];
      // Only verified bank-0 presets get names. Ambiguous or varying defaults
      // remain generic instead of guessing from a part name or instrument list.
      return [track.index, !track.isPercussion && sound[0] === '0' && sound[1] === '0' ? defaultPrograms.get(Number(sound[2])) ?? null : null];
    }));
  }
  set(id: number, value: PartTimbre) {
    const track = this.score.tracks[id];
    if (!track || track.isPercussion) throw new Error('此声部不支持更换音色。');
    this.choices.set(id, value);
  }
  apply(file: at.midi.MidiFile) {
    if (!this.defaults) this.captureDefaults(file);
    const channels = new Map<number, PartTimbre>();
    for (const track of this.score.tracks) {
      if (track.isPercussion) continue;
      channels.set(track.playbackInfo.primaryChannel, this.get(track.index));
      channels.set(track.playbackInfo.secondaryChannel, this.get(track.index));
    }
    for (const track of file.tracks) for (const event of track.events) {
      const program = event instanceof at.midi.ProgramChangeEvent;
      const bank = event instanceof at.midi.ControlChangeEvent &&
        (event.controller === at.midi.ControllerType.BankSelectCoarse || event.controller === at.midi.ControllerType.BankSelectFine);
      if (!program && !bank) continue;
      const choice = channels.get(event.channel) ?? 'score';
      if (!this.originals.has(event)) this.originals.set(event, program ? event.program : event.value);
      const value = choice === 'score' ? this.originals.get(event)! : program ? programs[choice] : 0;
      if (program) event.program = value; else event.value = value;
    }
  }
}
