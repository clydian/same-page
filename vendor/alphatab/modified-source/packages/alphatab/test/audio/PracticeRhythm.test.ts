import { describe, expect, it } from 'vitest';
import { MidiFile } from '@coderline/alphatab/midi/MidiFile';
import { EndOfTrackEvent } from '@coderline/alphatab/midi/MidiEvent';
import { AlphaSynthMidiFileHandler } from '@coderline/alphatab/midi/AlphaSynthMidiFileHandler';
import { MidiFileSequencer } from '@coderline/alphatab/synth/MidiFileSequencer';
import { TinySoundFont } from '@coderline/alphatab/synth/synthesis/TinySoundFont';
import { AlphaSynth } from '@coderline/alphatab/synth/AlphaSynth';
import { TestOutput } from 'test/audio/TestOutput';

class PracticeSynth extends AlphaSynth { get counting(): boolean { return this.sequencer.isPlayingCountIn; } }

function fixture() {
    const file = new MidiFile();
    const handler = new AlphaSynthMidiFileHandler(file);
    handler.addTimeSignature(0, 4, 4); handler.addTempo(0, 120);
    // Short pickup followed by 6/8, then a mid-bar tempo change.
    handler.addTimeSignature(960, 6, 8); handler.addTempo(960, 60);
    handler.addTempo(1680, 120);
    handler.addTimeSignature(3840, 3, 4); handler.addTempo(3840, 90);
    file.addEvent(new EndOfTrackEvent(0, 6720));
    return file;
}
describe('practice rhythm', () => {
    it('restarts accents at pickup/changed-meter boundaries and follows mid-beat tempo changes', () => {
        const seq = new MidiFileSequencer(new TinySoundFont(44100));
        const clicks = seq.createStateFromFile(fixture()).synthData.filter(item => item.isMetronome);
        expect(clicks.slice(0, 7).map(item => [item.event.tick, item.metronomeAccent])).toEqual([
            [0, 2], [960, 2], [1440, 0], [1920, 0], [2400, 1], [2880, 0], [3360, 0]
        ]);
        expect(clicks.find(item => item.event.tick === 1920)!.time).toBeCloseTo(1375);
        expect(clicks.find(item => item.event.tick === 3840)!.metronomeAccent).toBe(2);
    });
    it('uses the target meter and tempo at the exact seek boundary at every speed', () => {
        for (const speed of [.5, .83, 1, 2]) {
            const seq = new MidiFileSequencer(new TinySoundFont(44100));
            seq.loadMidi(fixture()); seq.playbackSpeed = speed;
            seq.mainSeek(seq.mainTickPositionToTimePosition(960)); seq.startCountIn();
            expect(seq.countInBeats).toBe(6); expect(seq.currentEndTick).toBe(2880);
            expect(seq.currentTempo).toBe(60); expect(seq.currentEndTime).toBeCloseTo(3000 / speed);
        }
    });
    it('publishes actual count-in progress and cancels it on pause without losing the target', () => {
        const output = new TestOutput(false), synth = new PracticeSynth(output, 100);
        synth.loadMidiFile(fixture()); synth.tickPosition = 960; synth.countInVolume = .5;
        const progress: number[] = []; synth.positionChanged.on(event => { if (event.countInBeats) progress.push(event.countInBeat); });
        synth.play(); output.next();
        expect(progress.length).toBeGreaterThan(0); expect(progress[0]).toBe(1);
        synth.pause(); expect(synth.counting).toBe(false);
        expect(synth.currentPosition.currentTick).toBeGreaterThanOrEqual(960);
        synth.countInVolume = 0; synth.play(); expect(synth.counting).toBe(false);
        synth.destroy();
    });
});
