import { describe, expect, it } from 'vitest';
import { AlphaTabApiBase } from '@coderline/alphatab/AlphaTabApiBase';
import type { EventEmitter } from '@coderline/alphatab/EventEmitter';
import { PlayerMode } from '@coderline/alphatab/PlayerSettings';
import { Settings } from '@coderline/alphatab/Settings';
import { ScoreLoader } from '@coderline/alphatab/importer/ScoreLoader';
import { AlphaSynthMidiFileHandler } from '@coderline/alphatab/midi/AlphaSynthMidiFileHandler';
import { NoteOnEvent } from '@coderline/alphatab/midi/MidiEvent';
import { MidiFile } from '@coderline/alphatab/midi/MidiFile';
import { MidiFileGenerator } from '@coderline/alphatab/midi/MidiFileGenerator';
import type { Score } from '@coderline/alphatab/model/Score';
import type { RenderHints } from '@coderline/alphatab/rendering/IScoreRenderer';
import { AlphaSynthWebWorkerApi } from '@coderline/alphatab/platform/worker/AlphaSynthWebWorkerApi';
import type { IAlphaSynthWorker, IAlphaSynthWorkerMessage } from '@coderline/alphatab/platform/worker/AlphaTabWorkerProtocol';
import { AlphaSynth } from '@coderline/alphatab/synth/AlphaSynth';
import type { BackingTrackSyncPoint } from '@coderline/alphatab/synth/IAlphaSynth';
import { PlaybackRange } from '@coderline/alphatab/synth/PlaybackRange';
import { PositionChangedEventArgs } from '@coderline/alphatab/synth/PositionChangedEventArgs';
import { TestOutput } from 'test/audio/TestOutput';
import { TestUiFacade } from 'test/visualTests/TestUiFacade';

class DeferredOutput extends TestOutput {
    public constructor(private readonly _initiallyReady: boolean) {
        super(false);
    }

    public override open(bufferTimeInMilliseconds: number): void {
        if (this._initiallyReady) {
            super.open(bufferTimeInMilliseconds);
        }
    }

    public makeReady(): void {
        (this.ready as EventEmitter).trigger();
    }
}

class CapturingSynth extends AlphaSynth {
    public readonly files: MidiFile[] = [];
    public readonly backingScores: Score[] = [];
    public readonly syncPointUpdates: BackingTrackSyncPoint[][] = [];
    public readonly transpositionUpdates: Map<number, number>[] = [];

    public override loadMidiFile(file: MidiFile): void {
        this.files.push(file);
        super.loadMidiFile(file);
    }

    public override loadBackingTrack(score: Score): void {
        this.backingScores.push(score);
    }

    public override updateSyncPoints(points: BackingTrackSyncPoint[]): void {
        this.syncPointUpdates.push(points);
    }

    public override applyTranspositionPitches(pitches: Map<number, number>): void {
        this.transpositionUpdates.push(pitches);
        super.applyTranspositionPitches(pitches);
    }
}

class MidiUiFacade extends TestUiFacade {
    public readonly players: CapturingSynth[] = [];
    public readonly outputs: DeferredOutput[] = [];

    public constructor(private readonly _initiallyReady: boolean) {
        super();
    }

    public override initialRender(): void {}

    public override createWorkerPlayer(): CapturingSynth {
        const output = new DeferredOutput(this._initiallyReady);
        const player = new CapturingSynth(output, 500);
        this.outputs.push(output);
        this.players.push(player);
        return player;
    }
}

// MIDI lifecycle tests do not need raster/layout work. Real API, generator,
// wrapper, synth and events still execute; only the independent renderer is idle.
class MidiApi extends AlphaTabApiBase<unknown> {
    public override render(_renderHints?: RenderHints): void {}
}

class SynthWorkerTransport implements IAlphaSynthWorker {
    private readonly _listeners = new Set<(event: MessageEvent<IAlphaSynthWorkerMessage>) => void>();

    public postMessage(_message: IAlphaSynthWorkerMessage): void {}
    public terminate(): void {}

    public addEventListener(_event: 'message', handler: (event: MessageEvent<IAlphaSynthWorkerMessage>) => void): void {
        this._listeners.add(handler);
    }

    public removeEventListener(_event: 'message', handler: (event: MessageEvent<IAlphaSynthWorkerMessage>) => void): void {
        this._listeners.delete(handler);
    }

    public receive(message: IAlphaSynthWorkerMessage): void {
        const event = new MessageEvent('message', { data: message });
        for (const listener of this._listeners) {
            listener(event);
        }
    }
}

class WorkerMidiUiFacade extends TestUiFacade {
    public readonly transport = new SynthWorkerTransport();
    public player!: AlphaSynthWebWorkerApi;

    public override initialRender(): void {}

    public override createWorkerPlayer(): AlphaSynthWebWorkerApi {
        this.player = new AlphaSynthWebWorkerApi(new TestOutput(false), new Settings(), this.transport);
        return this.player;
    }
}

function setup(initiallyReady = false, mode = PlayerMode.EnabledSynthesizer) {
    const settings = new Settings();
    settings.core.engine = 'svg';
    settings.player.playerMode = mode;
    const facade = new MidiUiFacade(initiallyReady);
    const api = new MidiApi(facade, settings);
    const generated: MidiFile[] = [];
    api.midiLoad.on(file => generated.push(file));
    return { settings, facade, api, generated };
}

function buildMidi(score: Score, settings: Settings) {
    const file = new MidiFile();
    const handler = new AlphaSynthMidiFileHandler(file);
    const generator = new MidiFileGenerator(score, settings, handler);
    generator.applyTranspositionPitches = false;
    generator.generate();
    return { file, generator, handler };
}

describe('AlphaTabApiMidiLifecycle', () => {
    it('exposes worker MIDI state to early and late API subscribers without recursion', () => {
        const settings = new Settings();
        settings.core.engine = 'svg';
        settings.player.playerMode = PlayerMode.EnabledSynthesizer;
        const facade = new WorkerMidiUiFacade();
        const api = new MidiApi(facade, settings);
        const early: PositionChangedEventArgs[] = [];
        api.midiLoaded.on(info => early.push(info));
        expect(facade.player.loadedMidiInfo).toBeUndefined();
        expect(early).toHaveLength(0);
        const info = new PositionChangedEventArgs(0, 2000, 0, 3840, false, 120, 120);
        facade.transport.receive({ cmd: 'alphaSynth.midiLoaded', args: info });
        expect(facade.player.loadedMidiInfo).toBe(info);
        expect(early).toEqual([info]);
        const late: PositionChangedEventArgs[] = [];
        api.midiLoaded.on(current => late.push(current));
        expect(late).toEqual([info]);
        api.destroy();
    });

    it.each([
        [true, PlayerMode.EnabledSynthesizer],
        [false, PlayerMode.EnabledSynthesizer],
        [true, PlayerMode.EnabledAutomatic],
        [false, PlayerMode.EnabledAutomatic]
    ] as const)('generates once with player initially ready=%s, mode=%s', (initiallyReady, mode) => {
        const { api, facade, generated, settings } = setup(initiallyReady, mode);
        const score = ScoreLoader.loadAlphaTex('\\tempo 92 \\ro C4.4 D4.4 E4.4 F4.4 | \\rc 2 G4.1', settings);
        const expected = buildMidi(score, settings);
        api.renderScore(score, [0]);

        expect(generated).toHaveLength(1);
        expect(api.tickCache).not.toBeNull();
        expect(facade.players[0].files).toHaveLength(initiallyReady ? 1 : 0);
        facade.outputs[0].makeReady();
        facade.outputs[0].makeReady();
        expect(generated).toHaveLength(1);
        expect(facade.players[0].files).toHaveLength(1);
        expect(facade.players[0].files[0].tracks).toEqual(expected.file.tracks);
        expect(facade.players[0].backingScores).toEqual([score]);
        expect(facade.players[0].syncPointUpdates).toEqual([expected.generator.syncPoints]);
        expect(facade.players[0].transpositionUpdates).toEqual([expected.generator.transpositionPitches]);
        expect(api.tickCache!.masterBars.length).toBe(expected.generator.tickLookup.masterBars.length);
        api.destroy();
    });

    it('keeps tick lookup available when playback is disabled', () => {
        const { api, generated, facade } = setup(false, PlayerMode.Disabled);
        const score = ScoreLoader.loadAlphaTex('C4.1 | D4.1');
        api.renderScore(score, [0]);
        expect(generated).toHaveLength(1);
        expect(api.tickCache!.getBeatStart(score.tracks[0].staves[0].bars[1].voices[0].beats[0])).toBe(3840);
        expect(facade.players).toHaveLength(0);
        api.destroy();
    });

    it('delivers only the latest score when synth readiness arrives after a fast switch', () => {
        const { api, generated, facade, settings } = setup();
        const first = ScoreLoader.loadAlphaTex('C4.1');
        const second = ScoreLoader.loadAlphaTex('\\tempo 70 E4.2 F4.2 | G4.1');
        api.renderScore(first, [0]);
        api.renderScore(second, [0]);
        facade.outputs[0].makeReady();
        expect(generated).toHaveLength(2);
        expect(facade.players[0].files).toHaveLength(1);
        expect(facade.players[0].files[0].tracks).toEqual(buildMidi(second, settings).file.tracks);
        expect(facade.players[0].backingScores).toEqual([second]);
        api.destroy();
    });

    it('preserves midiLoad edits while waiting for the synth', () => {
        const { api, facade, generated } = setup();
        api.midiLoad.on(file => {
            for (const track of file.tracks) {
                for (const event of track.events) {
                    if (event instanceof NoteOnEvent) {
                        event.noteVelocity = 37;
                    }
                }
            }
        });
        api.renderScore(ScoreLoader.loadAlphaTex('\\instrument piano C4.4 C4.4 D4.2'), [0]);
        facade.outputs[0].makeReady();
        expect(generated).toHaveLength(1);
        expect(facade.players[0].files[0]).toBe(generated[0]);
        const notes = generated[0].tracks.flatMap(track => track.events).filter(event => event instanceof NoteOnEvent);
        expect(notes.length).toBeGreaterThan(0);
        expect(notes.every(event => event.noteVelocity === 37)).toBe(true);
        api.destroy();
    });

    it('explicit loadMidiForScore regenerates changed music, lookup, sync points and transposition', () => {
        const { api, facade, generated, settings } = setup(true);
        const score = ScoreLoader.loadAlphaTex('\\tempo 100 \\transpose 12 C4.1 | D4.1', settings);
        api.renderScore(score, [0]);
        const firstLookup = api.tickCache;
        const firstEvents = generated[0].tracks;
        score.masterBars[0].tempoAutomations[0].value = 63;
        score.applyFlatSyncPoints([{ barIndex: 0, barPosition: 0, barOccurence: 0, millisecondOffset: 500 }]);
        const range = new PlaybackRange();
        range.startTick = 100;
        range.endTick = 3000;
        api.playbackRange = range;
        api.loadMidiForScore();
        const expected = buildMidi(score, settings);
        expect(generated).toHaveLength(2);
        expect(facade.players[0].files).toHaveLength(2);
        expect(generated[1].tracks).not.toEqual(firstEvents);
        expect(generated[1].tracks).toEqual(expected.file.tracks);
        expect(api.tickCache).not.toBe(firstLookup);
        expect(api.tickCache!.playbackRange).toEqual(range);
        expect(facade.players[0].syncPointUpdates[1]).toEqual(expected.generator.syncPoints);
        expect(facade.players[0].syncPointUpdates[1].length).toBeGreaterThan(0);
        expect(facade.players[0].transpositionUpdates[1]).toEqual(expected.generator.transpositionPitches);
        expect(api.midiTickShift).toBe(expected.handler.tickShift);
        facade.outputs[0].makeReady();
        expect(generated).toHaveLength(2);
        api.destroy();
    });

    it('coalesces explicit regenerations before readiness into the latest payload', () => {
        const { api, facade, generated } = setup();
        const score = ScoreLoader.loadAlphaTex('C4.1');
        api.renderScore(score, [0]);
        api.loadMidiForScore();
        api.loadMidiForScore();
        expect(generated).toHaveLength(3);
        facade.outputs[0].makeReady();
        expect(facade.players[0].files).toEqual([generated[2]]);
        api.destroy();
    });

    it('retains sync point updates made before the player is ready', () => {
        const { api, facade } = setup();
        const score = ScoreLoader.loadAlphaTex('C4.1 | D4.1');
        api.renderScore(score, [0]);
        score.applyFlatSyncPoints([{ barIndex: 0, barPosition: 0, barOccurence: 0, millisecondOffset: 650 }]);
        api.updateSyncPoints();
        facade.outputs[0].makeReady();
        const updates = facade.players[0].syncPointUpdates;
        expect(updates[updates.length - 1]).toEqual(MidiFileGenerator.generateSyncPoints(score));
        expect(updates[updates.length - 1].length).toBeGreaterThan(0);
        api.destroy();
    });

    it('does not repeat an explicit generation from a scoreLoaded listener', () => {
        const { api, facade, generated } = setup(true);
        api.scoreLoaded.on(() => api.loadMidiForScore());
        api.renderScore(ScoreLoader.loadAlphaTex('C4.1'), [0]);
        expect(generated).toHaveLength(1);
        expect(facade.players[0].files).toHaveLength(1);
        api.destroy();
    });

    it('rebuilds once for a replacement player and ignores the old player ready event', () => {
        const { api, facade, generated, settings } = setup();
        api.renderScore(ScoreLoader.loadAlphaTex('C4.1'), [0]);
        settings.player.playerMode = PlayerMode.Disabled;
        api.updateSettings();
        facade.outputs[0].makeReady();
        expect(generated).toHaveLength(1);
        settings.player.playerMode = PlayerMode.EnabledSynthesizer;
        api.updateSettings();
        facade.outputs[0].makeReady();
        expect(generated).toHaveLength(1);
        facade.outputs[1].makeReady();
        expect(generated).toHaveLength(2);
        expect(facade.players[0].files).toHaveLength(0);
        expect(facade.players[1].files).toHaveLength(1);
        api.destroy();
    });

    it('ignores late readiness and explicit generation after destroy', () => {
        const { api, facade, generated } = setup();
        api.renderScore(ScoreLoader.loadAlphaTex('C4.1'), [0]);
        api.destroy();
        facade.outputs[0].makeReady();
        api.loadMidiForScore();
        expect(generated).toHaveLength(1);
        expect(facade.players[0].files).toHaveLength(0);
    });

    it('does not deliver a payload superseded by a midiLoad listener', () => {
        const { api, facade } = setup(true);
        const first = ScoreLoader.loadAlphaTex('C4.1');
        const second = ScoreLoader.loadAlphaTex('D4.1');
        let switched = false;
        api.midiLoad.on(() => {
            if (!switched) {
                switched = true;
                api.renderScore(second, [0]);
            }
        });
        api.renderScore(first, [0]);
        expect(facade.players[0].files).toHaveLength(1);
        expect(facade.players[0].backingScores).toEqual([second]);
        api.destroy();
    });

    it('stops delivery if a synchronous midiLoaded listener destroys the API', () => {
        const { api, facade, generated } = setup(true);
        api.midiLoaded.on(() => api.destroy());
        api.renderScore(ScoreLoader.loadAlphaTex('C4.1'), [0]);
        expect(generated).toHaveLength(1);
        expect(facade.players[0].files).toHaveLength(1);
        expect(facade.players[0].backingScores).toHaveLength(0);
        expect(facade.players[0].syncPointUpdates).toHaveLength(0);
    });
});
