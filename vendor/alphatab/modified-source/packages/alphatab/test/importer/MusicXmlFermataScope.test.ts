import { readFileSync } from 'node:fs';
import { BeatCloner } from '@coderline/alphatab/generated/model/BeatCloner';
import { BeatSerializer } from '@coderline/alphatab/generated/model/BeatSerializer';
import { FermataCloner } from '@coderline/alphatab/generated/model/FermataCloner';
import { FermataSerializer } from '@coderline/alphatab/generated/model/FermataSerializer';
import { MusicXmlImporter } from '@coderline/alphatab/importer/MusicXmlImporter';
import { ByteBuffer } from '@coderline/alphatab/io/ByteBuffer';
import { LayoutMode } from '@coderline/alphatab/LayoutMode';
import { AlphaSynthMidiFileHandler } from '@coderline/alphatab/midi/AlphaSynthMidiFileHandler';
import { MidiFile } from '@coderline/alphatab/midi/MidiFile';
import { MidiFileGenerator } from '@coderline/alphatab/midi/MidiFileGenerator';
import { Beat } from '@coderline/alphatab/model/Beat';
import { Fermata, FermataType } from '@coderline/alphatab/model/Fermata';
import { JsonConverter } from '@coderline/alphatab/model/JsonConverter';
import type { Score } from '@coderline/alphatab/model/Score';
import { FermataGlyph } from '@coderline/alphatab/rendering/glyphs/FermataGlyph';
import { ScoreRenderer } from '@coderline/alphatab/rendering/ScoreRenderer';
import { Settings } from '@coderline/alphatab/Settings';
import { StaveProfile } from '@coderline/alphatab/StaveProfile';
import { describe, expect, it, vi } from 'vitest';

const xml = readFileSync('test-data/musicxml/source-owned-two-fermata.musicxml', 'utf8');
function load(source = xml) {
    const importer = new MusicXmlImporter();
    importer.init(ByteBuffer.fromBuffer(new TextEncoder().encode(source)), new Settings());
    return importer.readScore();
}
const beats = (score: Score) =>
    score.tracks.flatMap(t => t.staves.flatMap(s => s.bars.flatMap(b => b.voices.flatMap(v => v.beats))));
const positions = (score: Score) =>
    beats(score)
        .filter(b => b.fermata)
        .map(b => [b.voice.bar.staff.index, b.playbackStart]);
function midi(score: Score) {
    const file = new MidiFile();
    const generator = new MidiFileGenerator(score, new Settings(), new AlphaSynthMidiFileHandler(file));
    generator.generate();
    return {
        events: JSON.stringify(file.tracks.flatMap(t => t.events)),
        bounds: generator.tickLookup.masterBars.map(b => [b.start, b.end])
    };
}
function render(score: Score, mode: LayoutMode) {
    const settings = new Settings();
    settings.core.engine = 'svg';
    settings.core.enableLazyLoading = false;
    settings.display.layoutMode = mode;
    settings.display.staveProfile = StaveProfile.Score;
    const renderer = new ScoreRenderer(settings);
    renderer.width = 900;
    let count = 0;
    const original = FermataGlyph.prototype.paint;
    const spy = vi.spyOn(FermataGlyph.prototype, 'paint').mockImplementation(function (this: FermataGlyph, ...args) {
        count++;
        return original.apply(this, args);
    });
    renderer.error.on(e => {
        throw e;
    });
    try {
        renderer.renderScore(score, [0]);
    } finally {
        spy.mockRestore();
        renderer.destroy();
    }
    return count;
}
describe('MusicXML source fermata ownership', () => {
    for (const json of [false, true]) {
        it(`keeps only two source positions json=${json}`, () => {
            let score = load();
            if (json) {
                score = JsonConverter.jsObjectToScore(JsonConverter.scoreToJsObject(score));
            }
            expect(positions(score)).toEqual([
                [0, 0],
                [1, 1920]
            ]);
            expect(beats(score).find(b => b.voice.bar.staff.index === 1 && b.playbackStart === 0)!.fermata).toBeNull();
            for (const mode of [LayoutMode.Page, LayoutMode.Horizontal]) {
                expect(render(score, mode)).toBe(2);
            }
        });
    }
    it('retains a legal visible rest fermata', () => {
        const source = xml
            .replace(' print-object="no"', '')
            .replace(
                '<staff>2</staff></note>',
                '<staff>2</staff><notations><fermata>angled</fermata></notations></note>'
            );
        const score = JsonConverter.jsObjectToScore(JsonConverter.scoreToJsObject(load(source)));
        expect(positions(score)).toEqual([
            [0, 0],
            [1, 0],
            [1, 1920]
        ]);
        const rest = beats(score).find(b => b.voice.bar.staff.index === 1 && b.playbackStart === 0)!;
        expect(rest.isRest).toBe(true);
        expect(rest.isRestVisible).toBe(true);
        expect(rest.fermata!.type).toBe(FermataType.Short);
        expect(render(score, LayoutMode.Page)).toBe(3);
    });
    it('preserves different source shapes at the same tick independently', () => {
        const source = xml
            .replace('<backup><duration>2</duration></backup>', '<backup><duration>2</duration></backup>')
            .replace(/<note print-object="no">.*?<\/note>/, '')
            .replace(
                '<fermata/></notations></note></measure>',
                '<fermata>square</fermata></notations></note></measure>'
            );
        const score = JsonConverter.jsObjectToScore(JsonConverter.scoreToJsObject(load(source)));
        expect(positions(score)).toEqual([
            [0, 0],
            [1, 0]
        ]);
        expect(
            beats(score)
                .filter(b => b.fermata)
                .map(b => b.fermata!.type)
        ).toEqual([FermataType.Medium, FermataType.Long]);
        expect(render(score, LayoutMode.Horizontal)).toBe(2);
    });
    it('renders an explicit fermata in a secondary voice', () => {
        const source = xml.replaceAll('<voice>1</voice>', '<voice>2</voice>');
        const score = JsonConverter.jsObjectToScore(JsonConverter.scoreToJsObject(load(source)));
        expect(positions(score)).toEqual([
            [0, 0],
            [1, 1920]
        ]);
        expect(render(score, LayoutMode.Page)).toBe(2);
    });
    it('deep-clones source ownership and keeps legacy JSON projection defaults', () => {
        const original = beats(load())[0];
        const clone = BeatCloner.clone(original);
        expect(clone.hasSourceFermataScope).toBe(true);
        expect(clone.sourceFermata).toEqual(original.sourceFermata);
        expect(clone.sourceFermata).not.toBe(original.sourceFermata);
        const legacy = new Beat();
        BeatSerializer.fromJson(legacy, new Map([['duration', 4]]));
        expect(legacy.hasSourceFermataScope).toBe(false);
        expect(legacy.sourceFermata).toBeNull();
        const score = load();
        for (const beat of beats(score)) {
            beat.hasSourceFermataScope = false;
            beat.sourceFermata = null;
        }
        const roundTrip = JsonConverter.jsObjectToScore(JsonConverter.scoreToJsObject(score));
        expect(positions(roundTrip)).toEqual([
            [0, 0],
            [1, 0],
            [1, 1920]
        ]);
    });
    it('preserves existing MIDI timing and shared fermata hold metadata', () => {
        const score = load();
        const before = midi(score);
        score.masterBars[0].fermata!.get(0)!.length = 1.75;
        const copy = JsonConverter.jsObjectToScore(JsonConverter.scoreToJsObject(score));
        expect(copy.masterBars[0].fermata!.get(0)!.length).toBe(1.75);
        expect([...copy.masterBars[0].fermata!.keys()]).toEqual([0, 1920]);
        expect(midi(copy)).toEqual(before);
        expect(midi(load(xml.replaceAll('<notations><fermata/></notations>', '')))).toEqual(before);
    });
});

it.each([
    [LayoutMode.Page, '', 0xe4c1],
    [LayoutMode.Horizontal, '', 0xe4c1],
    [LayoutMode.Page, 'angled', 0xe4c5],
    [LayoutMode.Horizontal, 'angled', 0xe4c5],
    [LayoutMode.Page, 'square', 0xe4c7],
    [LayoutMode.Horizontal, 'square', 0xe4c7]
])('renders actual 42a secondary inverted fermata below upright after JSON layout=%s shape=%s', (mode, shape, below) => {
    const source = readFileSync(
        'test-data/musicxml-testsuite/42a-MultiVoice-TwoVoicesOnStaff-Lyrics.xml',
        'utf8'
    ).replace('<fermata type="inverted"/>', `<fermata type="inverted">${shape}</fermata>`);
    const score = JsonConverter.jsObjectToScore(JsonConverter.scoreToJsObject(load(source)));
    const settings = new Settings();
    settings.core.engine = 'svg';
    settings.core.enableLazyLoading = false;
    settings.display.staveProfile = StaveProfile.Score;
    settings.display.layoutMode = mode;
    const renderer = new ScoreRenderer(settings);
    renderer.width = 900;
    const svg: string[] = [];
    renderer.partialRenderFinished.on(event => {
        if (typeof event.renderResult === 'string') {
            svg.push(event.renderResult);
        }
    });
    const painted: { symbol: number; y: number }[] = [];
    const original = FermataGlyph.prototype.paint;
    const spy = vi.spyOn(FermataGlyph.prototype, 'paint').mockImplementation(function (this: FermataGlyph, ...args) {
        const canvas = args[2];
        const fill = canvas.fillMusicFontSymbol;
        const inner = vi.spyOn(canvas, 'fillMusicFontSymbol').mockImplementation((...values) => {
            painted.push({ symbol: values[3], y: values[1] });
            return fill.apply(canvas, values);
        });
        try {
            return original.apply(this, args);
        } finally {
            inner.mockRestore();
        }
    });
    try {
        renderer.renderScore(score, [0]);
    } finally {
        spy.mockRestore();
        renderer.destroy();
    }
    expect(painted.map(p => p.symbol).sort()).toEqual([0xe4c0, below]);
    expect(painted.find(p => p.symbol === below)!.y).toBeGreaterThan(painted.find(p => p.symbol === 0xe4c0)!.y + 36);
    const staffLines = [...svg.join('').matchAll(/<rect\b[^>]*>/g)]
        .map(m => m[0])
        .filter(
            rect =>
                Number(/width="([^"]+)"/.exec(rect)?.[1]) > 30 && Number(/height="([^"]+)"/.exec(rect)?.[1]) === 1.17
        )
        .map(rect => Number(/y="([^"]+)"/.exec(rect)![1]));
    expect(staffLines.length).toBeGreaterThanOrEqual(5);
    expect(painted.find(p => p.symbol === below)!.y - 0.04).toBeGreaterThan(Math.max(...staffLines));
    expect(painted.find(p => p.symbol === 0xe4c0)!.y + 0.2).toBeLessThan(Math.min(...staffLines));
    expect(midi(score)).toEqual(midi(load(source.replace('type="inverted"', 'type="upright"'))));
});

it('retains inverted source orientation through deep clone and defaults old Fermata JSON to upright', () => {
    const score = load(xml.replaceAll('<fermata/>', '<fermata type="inverted"/>'));
    const source = beats(score)[0];
    expect(BeatCloner.clone(source).sourceFermata!.isInverted).toBe(true);
    const clone = FermataCloner.clone(source.sourceFermata!);
    expect(clone.isInverted).toBe(true);
    clone.isInverted = false;
    expect(source.sourceFermata!.isInverted).toBe(true);
    const legacy = new Fermata();
    FermataSerializer.fromJson(legacy, new Map([['type', FermataType.Medium]]));
    expect(legacy.isInverted).toBe(false);
    expect(midi(score)).toEqual(midi(load()));
});
