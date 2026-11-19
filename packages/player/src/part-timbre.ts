import * as at from '@coderline/alphatab';
import { TONE_PROFILES } from './timbre-profile.ts';

export type PartTimbre = 'score' | 'piano' | 'aahs' | 'oohs';
const programs = { piano: 0, aahs: TONE_PROFILES.choir.program, oohs: 53 } as const;
export const isPartTimbre = (value: string): value is PartTimbre => value === 'score' || Object.hasOwn(programs, value);

/** Owns only the post-processed, session-local MIDI. Restoring a part restores
 * every original program/bank event, including instrument automation. */
export class PartTimbres {
  private originals = new WeakMap<at.midi.MidiEvent, number>();
  private choices = new Map<number, PartTimbre>();
  private score: at.model.Score;
  constructor(score: at.model.Score) { this.score = score; }
  get(id: number): PartTimbre { return this.choices.get(id) ?? 'score'; }
  set(id: number, value: PartTimbre) {
    const track = this.score.tracks[id];
    if (!track || track.isPercussion) throw new Error('此声部不支持更换音色。');
    this.choices.set(id, value);
  }
  apply(file: at.midi.MidiFile) {
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
