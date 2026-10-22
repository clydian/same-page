import { BeatCloner } from '@coderline/alphatab/generated/model/BeatCloner';
import { TremoloPickingEffectSerializer } from '@coderline/alphatab/generated/model/TremoloPickingEffectSerializer';
import { ScoreLoader } from '@coderline/alphatab/importer/ScoreLoader';
import { LayoutMode } from '@coderline/alphatab/LayoutMode';
import { AlphaSynthMidiFileHandler } from '@coderline/alphatab/midi/AlphaSynthMidiFileHandler';
import { MidiFile } from '@coderline/alphatab/midi/MidiFile';
import { MidiFileGenerator } from '@coderline/alphatab/midi/MidiFileGenerator';
import { JsonConverter } from '@coderline/alphatab/model/JsonConverter';
import type { Score } from '@coderline/alphatab/model/Score';
import { TremoloPickingEffect, TremoloPickingType } from '@coderline/alphatab/model/TremoloPickingEffect';
import { ScoreRenderer } from '@coderline/alphatab/rendering/ScoreRenderer';
import { Settings } from '@coderline/alphatab/Settings';
import { StaveProfile } from '@coderline/alphatab/StaveProfile';
import { TestPlatform } from 'test/TestPlatform';
import { describe, expect, it } from 'vitest';

async function load(name: string) {
    const score = ScoreLoader.loadScoreFromBytes(
        await TestPlatform.loadFile(`test-data/musicxml-tremolo/${name}.musicxml`),
        new Settings()
    );
    return JsonConverter.jsObjectToScore(JsonConverter.scoreToJsObject(score));
}
function collect(score: Score) {
    const settings = new Settings(),
        file = new MidiFile();
    const generator = new MidiFileGenerator(score, settings, new AlphaSynthMidiFileHandler(file));
    generator.applyTranspositionPitches = false;
    generator.generate();
    return {
        notes: file.tracks
            .flatMap(t => t.events)
            .filter(e => ['NoteOnEvent', 'NoteOffEvent'].includes(e.constructor.name))
            .map(e => ({ kind: e.constructor.name, ...JSON.parse(JSON.stringify(e)) }))
            .sort((a, b) => a.tick - b.tick || a.noteKey - b.noteKey || a.kind.localeCompare(b.kind)),
        bounds: generator.tickLookup.masterBars.map(b => [b.start, b.end])
    };
}
async function midi(name: string) {
    return collect(await load(name));
}

function renderSvg(score: Score) {
    const settings = new Settings();
    settings.core.engine = 'svg';
    settings.core.enableLazyLoading = false;
    settings.display.staveProfile = StaveProfile.Score;
    const renderer = new ScoreRenderer(settings);
    renderer.width = 1000;
    const pieces: string[] = [];
    renderer.partialRenderFinished.on(ev => {
        if (typeof ev.renderResult === 'string') {
            pieces.push(ev.renderResult);
        }
    });
    renderer.error.on(error => {
        throw error;
    });
    try {
        renderer.renderScore(score, [0]);
    } finally {
        renderer.destroy();
    }
    return pieces.join('').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

describe('MusicXML paired tremolo retains alternating groups', () => {
    it('keeps old Worker JSON without a paired role as Single', () => {
        const effect = new TremoloPickingEffect();
        TremoloPickingEffectSerializer.fromJson(
            effect,
            new Map<string, unknown>([
                ['marks', 3],
                ['style', 0]
            ])
        );
        expect(effect.type).toBe(TremoloPickingType.Single);
        expect(effect.marks).toBe(3);
    });
    it('retains printed note types, dots and timing while preserving paired roles through JSON and clone', async () => {
        const score = await load('paired-dotted-half-3slash'),
            voice = score.tracks[0].staves[0].bars[0].voices[0];
        const original = collect(score),
            cloned = voice.beats.map(b => BeatCloner.clone(b));
        voice.beats = [];
        for (const beat of cloned) {
            voice.addBeat(beat);
        }
        score.finish(new Settings());
        expect(
            voice.beats.map(b => [
                b.duration,
                b.dots,
                b.tupletNumerator,
                b.tupletDenominator,
                b.playbackDuration,
                b.tremoloPicking?.type
            ])
        ).toEqual([
            [2, 1, 2, 1, 1440, TremoloPickingType.Start],
            [2, 1, 2, 1, 1440, TremoloPickingType.Stop]
        ]);
        expect(voice.beats[0].doubleTremoloPartner).toBe(voice.beats[1]);
        expect(voice.beats[1].doubleTremoloPartner).toBe(voice.beats[0]);
        expect(collect(score)).toEqual(original);
    });
    it('does not pair a missing stop', async () => {
        const score = await load('paired-dotted-half-3slash'),
            voice = score.tracks[0].staves[0].bars[0].voices[0];
        voice.beats[1].tremoloPicking!.type = TremoloPickingType.Single;
        expect(voice.beats[0].doubleTremoloPartner).toBeNull();
        expect(voice.beats[1].doubleTremoloPartner).toBeNull();
        expect(new TremoloPickingEffect().type).toBe(TremoloPickingType.Single);
    });
    it('does not join endpoints from distinct voices or bars', async () => {
        const text = new TextDecoder().decode(
            await TestPlatform.loadFile('test-data/musicxml-tremolo/paired-dotted-half-3slash.musicxml')
        );
        const split = '<note><pitch><step>G</step>';
        const differentBar = text.replace(split, `</measure><measure number="2">${split}`);
        const differentVoice = text
            .replace(split, `<backup><duration>6</duration></backup>${split}`)
            .replace(
                '<step>G</step><octave>4</octave></pitch><duration>6</duration><voice>1</voice>',
                '<step>G</step><octave>4</octave></pitch><duration>6</duration><voice>2</voice>'
            );
        for (const input of [differentBar, differentVoice]) {
            const score = ScoreLoader.loadScoreFromBytes(new TextEncoder().encode(input), new Settings());
            expect(score.tracks[0].staves[0].bars[0].voices[0].beats[0].doubleTremoloPartner).toBeNull();
        }
    });
    it('initializes the second group pitch bend before its first physical attack', async () => {
        const score = await load('paired-dotted-half-3slash'),
            file = new MidiFile(),
            settings = new Settings();
        const generator = new MidiFileGenerator(score, settings, new AlphaSynthMidiFileHandler(file));
        generator.applyTranspositionPitches = false;
        generator.generate();
        const bends = file.tracks
            .flatMap(t => t.events)
            .filter(e => e.constructor.name === 'NoteBendEvent')
            .map(e => JSON.parse(JSON.stringify(e)));
        expect(bends.find(e => e.noteKey === 67)?.tick).toBe(120);
    });
    it('counts existing eighth-note beams in addition to three tremolo strokes', async () => {
        const text = new TextDecoder().decode(
            await TestPlatform.loadFile('test-data/musicxml-tremolo/paired-dotted-half-3slash.musicxml')
        );
        const source = text
            .replaceAll('<type>half</type><dot/>', '<type>eighth</type>')
            .replaceAll('<duration>6</duration>', '<duration>1</duration>')
            .replace('<beats>3</beats><beat-type>4</beat-type>', '<beats>1</beats><beat-type>8</beat-type>');
        const score = ScoreLoader.loadScoreFromBytes(new TextEncoder().encode(source), new Settings());
        const actual = collect(score)
            .notes.filter(e => e.kind === 'NoteOnEvent')
            .map(e => [e.tick, e.noteKey]);
        const expected: number[][] = [];
        for (let tick = 0; tick < 480; tick += 60) {
            for (const key of tick % 120 === 0 ? [72, 76] : [67]) {
                expected.push([tick, key]);
            }
        }
        expect(actual).toEqual(expected);
    });
    it('multiplies a genuine 3:2 tuplet with the tremolo 2:1 factor without changing the stroke type', async () => {
        const read = async (name: string) =>
            new TextDecoder().decode(await TestPlatform.loadFile(`test-data/musicxml-tremolo/${name}.musicxml`));
        const source = (await read('paired-dotted-half-3slash'))
            .replaceAll(
                '<actual-notes>2</actual-notes><normal-notes>1</normal-notes>',
                '<actual-notes>6</actual-notes><normal-notes>2</normal-notes>'
            )
            .replaceAll('<duration>6</duration>', '<duration>4</duration>')
            .replace('<beats>3</beats>', '<beats>2</beats>');
        const control = (await read('owned-explicit-alternating-control'))
            .replace('<divisions>8</divisions>', '<divisions>12</divisions>')
            .replace('<beats>3</beats>', '<beats>2</beats>')
            .replaceAll(
                '<type>32nd</type>',
                '<type>32nd</type><time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>'
            );
        const parse = (text: string) =>
            JsonConverter.jsObjectToScore(
                JsonConverter.scoreToJsObject(
                    ScoreLoader.loadScoreFromBytes(new TextEncoder().encode(text), new Settings())
                )
            );
        expect(collect(parse(source))).toEqual(collect(parse(control)));
    });
    it('uses parallel connecting strokes when stem direction is automatic', async () => {
        const text = new TextDecoder()
            .decode(await TestPlatform.loadFile('test-data/musicxml-tremolo/paired-dotted-half-3slash.musicxml'))
            .replaceAll('<stem>down</stem>', '');
        const svg = renderSvg(ScoreLoader.loadScoreFromBytes(new TextEncoder().encode(text), new Settings()));
        const paths = [...svg.matchAll(/<path d=" M([^"z]+)z"/g)].map(m =>
            [...m[1].matchAll(/[-+]?[\d.]+/g)].map(n => Number(n[0]))
        );
        expect(paths).toHaveLength(3);
        const slopes = paths.map(p => (p[3] - p[1]) / (p[2] - p[0]));
        expect(slopes[0]).toBeCloseTo(slopes[1], 6);
        expect(slopes[1]).toBeCloseTo(slopes[2], 6);
    });
    it('uses native shared stem geometry with a bounded connecting-beam slope', async () => {
        const svg = renderSvg(await load('paired-dotted-half-3slash'));
        const paths = [...svg.matchAll(/<path d=" M([^"z]+)z"/g)].map(m =>
            [...m[1].matchAll(/[-+]?[\d.]+/g)].map(n => Number(n[0]))
        );
        expect(paths).toHaveLength(3);
        // Default 36px music font has a 9px staff space, the native beam limit.
        for (const points of paths) {
            expect(Math.abs(points[3] - points[1])).toBeLessThanOrEqual(9.001);
        }
    });
    for (const layout of [LayoutMode.Page, LayoutMode.Horizontal]) {
        it(`draws three connecting strokes without a false 2:1 tuplet in layout ${layout}`, async () => {
            const score = await load('paired-dotted-half-3slash'),
                settings = new Settings();
            settings.core.engine = 'svg';
            settings.core.enableLazyLoading = false;
            settings.display.staveProfile = StaveProfile.Score;
            settings.display.layoutMode = layout;
            const renderer = new ScoreRenderer(settings);
            renderer.width = 1000;
            const pieces: string[] = [];
            renderer.partialRenderFinished.on(ev => {
                if (typeof ev.renderResult === 'string') {
                    pieces.push(ev.renderResult);
                }
            });
            renderer.error.on(error => {
                throw error;
            });
            try {
                renderer.renderScore(score, [0]);
            } finally {
                renderer.destroy();
            }
            const svg = pieces.join('').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
            expect((svg.match(/\uE222/g) ?? []).length).toBe(0);
            expect((svg.match(/\uE882/g) ?? []).length).toBe(0);
            expect((svg.match(/<path d=" M[^"z]+z"/g) ?? []).length).toBe(3);
        });
    }
    for (const [paired, expanded] of [
        ['paired-dotted-half-3slash', 'owned-explicit-alternating-control'],
        ['paired-half-3slash', 'owned-explicit-half-control']
    ]) {
        it(`alternates ${paired} at the written stroke rate over the full span`, async () => {
            expect(await midi(paired)).toEqual(await midi(expanded));
        });
    }
});
