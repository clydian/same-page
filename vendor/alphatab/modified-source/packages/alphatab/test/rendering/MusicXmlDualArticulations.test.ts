import { NoteCloner } from '@coderline/alphatab/generated/model/NoteCloner';
import { NoteSerializer } from '@coderline/alphatab/generated/model/NoteSerializer';
import { MusicXmlImporter } from '@coderline/alphatab/importer/MusicXmlImporter';
import { ByteBuffer } from '@coderline/alphatab/io/ByteBuffer';
import { LayoutMode } from '@coderline/alphatab/LayoutMode';
import { AlphaSynthMidiFileHandler } from '@coderline/alphatab/midi/AlphaSynthMidiFileHandler';
import { MidiFile } from '@coderline/alphatab/midi/MidiFile';
import { MidiFileGenerator } from '@coderline/alphatab/midi/MidiFileGenerator';
import { NoteOnEvent } from '@coderline/alphatab/midi/MidiEvent';
import { AccentuationType } from '@coderline/alphatab/model/AccentuationType';
import { JsonConverter } from '@coderline/alphatab/model/JsonConverter';
import { MusicFontSymbol } from '@coderline/alphatab/model/MusicFontSymbol';
import { Note } from '@coderline/alphatab/model/Note';
import type { Score } from '@coderline/alphatab/model/Score';
import { CanvasHelper } from '@coderline/alphatab/platform/ICanvas';
import { ScoreRenderer } from '@coderline/alphatab/rendering/ScoreRenderer';
import { Settings } from '@coderline/alphatab/Settings';
import { StaveProfile } from '@coderline/alphatab/StaveProfile';
import { describe, expect, it, vi } from 'vitest';

function source(art: string, stem = 'up', chord = false) {
    const note = (chordNote: boolean, marked: boolean) =>
        `<note>${chordNote ? '<chord/>' : ''}<pitch><step>${chordNote ? 'E' : 'C'}</step><octave>5</octave></pitch><duration>2</duration><type>half</type><stem>${stem}</stem>${marked ? `<notations><articulations>${art}</articulations></notations>` : ''}</note>`;
    return `<score-partwise><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>${note(false, true)}${chord ? note(true, true) : ''}${note(false, false)}</measure></part></score-partwise>`;
}
function load(xml: string) {
    const importer = new MusicXmlImporter();
    importer.init(ByteBuffer.fromBuffer(new TextEncoder().encode(xml)), new Settings());
    return importer.readScore();
}
const notes = (score: Score) => score.tracks[0].staves[0].bars[0].voices[0].beats.flatMap(b => b.notes);
function midi(score: Score) {
    const file = new MidiFile();
    const generator = new MidiFileGenerator(score, new Settings(), new AlphaSynthMidiFileHandler(file));
    generator.generate();
    return {
        events: JSON.parse(JSON.stringify(file.tracks.flatMap(t => t.events))),
        noteOns: file.tracks
            .flatMap(t => t.events)
            .filter(e => e instanceof NoteOnEvent)
            .map(e => [e.tick, e.noteKey, e.noteVelocity]),
        bounds: generator.tickLookup.masterBars.map(b => [b.start, b.end])
    };
}
function render(score: Score, mode = LayoutMode.Page) {
    const settings = new Settings();
    settings.core.engine = 'svg';
    settings.core.enableLazyLoading = false;
    settings.display.staveProfile = StaveProfile.Score;
    settings.display.layoutMode = mode;
    const renderer = new ScoreRenderer(settings);
    renderer.width = 700;
    const marks: { symbol: MusicFontSymbol; y: number; top: number; bottom: number }[] = [];
    let svg = '';
    const original = CanvasHelper.fillMusicFontSymbolSafe;
    const spy = vi.spyOn(CanvasHelper, 'fillMusicFontSymbolSafe').mockImplementation((...args) => {
        if (
            [
                MusicFontSymbol.ArticAccentAbove,
                MusicFontSymbol.ArticAccentBelow,
                MusicFontSymbol.ArticMarcatoAbove,
                MusicFontSymbol.ArticMarcatoBelow,
                MusicFontSymbol.ArticTenutoAbove,
                MusicFontSymbol.ArticTenutoBelow
            ].includes(args[4])
        ) {
            const metrics = args[0].settings.display.resources.engravingSettings;
            marks.push({
                symbol: args[4],
                y: args[2],
                top: args[2] - metrics.glyphTop.get(args[4])! * args[3],
                bottom: args[2] - metrics.glyphBottom.get(args[4])! * args[3]
            });
        }
        return original(...args);
    });
    renderer.partialRenderFinished.on(e => {
        if (typeof e.renderResult === 'string') { svg += e.renderResult; }
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
    return { marks, svg };
}
describe('MusicXML simultaneous accent and tenuto', () => {
    for (const [accent, type] of [
        ['accent', AccentuationType.Normal],
        ['strong-accent', AccentuationType.Heavy]
    ] as const) {
        for (const reversed of [false, true]) {
            const art = reversed ? `<tenuto/><${accent}/>` : `<${accent}/><tenuto/>`;
            it(`keeps ${accent} + tenuto independent, reversed=${reversed}`, () => {
                const [marked, next] = notes(load(source(art)));
                expect(marked.accentuated).toBe(type);
                expect(marked.isTenuto).toBe(true);
                expect(next.accentuated).toBe(AccentuationType.None);
                expect(next.isTenuto).toBe(false);
            });
            it(`keeps one ${accent} velocity adjustment and exact timing, reversed=${reversed}`, () => {
                const dual = midi(load(source(art)));
                expect(dual).toEqual(midi(load(source(`<${accent}/>`))));
                expect(dual.bounds).toEqual([[0, 3840]]);
                expect(dual.noteOns.map(e => e.slice(0, 2))).toEqual([
                    [0, 72],
                    [1920, 72]
                ]);
                expect(dual.noteOns[0][2]).toBeGreaterThan(dual.noteOns[1][2]);
            });
        }
    }
    it('keeps coexistence through Worker structured JSON and generated deep clone', () => {
        const score = load(source('<accent/><tenuto placement="above"/>'));
        const origin = notes(score)[0];
        const copy = JsonConverter.jsObjectToScore(structuredClone(JsonConverter.scoreToJsObject(score)));
        for (const note of [notes(copy)[0], NoteCloner.clone(origin)]) {
            expect(note.accentuated).toBe(AccentuationType.Normal);
            expect(note.isTenuto).toBe(true);
            expect(note.tenutoPlacement).toBe(1);
        }
        expect(render(copy)).toEqual(render(score));
        expect(midi(copy)).toEqual(midi(score));
    });
    it('retains old missing-field and Tenuto3 JSON behavior', () => {
        const score = load(source('<tenuto/>'));
        const legacy = new Note();
        NoteSerializer.fromJson(legacy, new Map([['accentuated', AccentuationType.Tenuto]]));
        expect(legacy.isTenuto).toBe(false);
        const before = render(score);
        notes(score)[0].isTenuto = false;
        expect(render(score)).toEqual(before);
        const copied = NoteCloner.clone(legacy);
        expect(copied.accentuated).toBe(AccentuationType.Tenuto);
        expect(copied.isTenuto).toBe(false);
        expect(midi(load(source('<tenuto/>')))).toEqual(midi(load(source(''))));
    });
    for (const mode of [LayoutMode.Page, LayoutMode.Horizontal]) {
        for (const stem of ['up', 'down']) {
            for (const placement of ['', 'above', 'below']) {
                it(`paints both marks in ${LayoutMode[mode]} stem=${stem} tenuto=${placement || 'automatic'}`, () => {
                    const score = load(
                        source(`<accent/><tenuto${placement ? ` placement="${placement}"` : ''}/>`, stem)
                    );
                    const result = render(
                        JsonConverter.jsObjectToScore(structuredClone(JsonConverter.scoreToJsObject(score))),
                        mode
                    );
                    const above = placement ? placement === 'above' : stem === 'down';
                    const accent = result.marks.filter(
                        m =>
                            m.symbol ===
                            (stem === 'down' ? MusicFontSymbol.ArticAccentAbove : MusicFontSymbol.ArticAccentBelow)
                    );
                    const tenuto = result.marks.filter(
                        m => m.symbol === (above ? MusicFontSymbol.ArticTenutoAbove : MusicFontSymbol.ArticTenutoBelow)
                    );
                    expect(accent).toHaveLength(1);
                    expect(tenuto).toHaveLength(1);
                    expect(
                        Math.max(accent[0].top, tenuto[0].top) - Math.min(accent[0].bottom, tenuto[0].bottom)
                    ).toBeGreaterThan(0);
                    if (above === (stem === 'down')) {
                        expect(above ? tenuto[0].y > accent[0].y : tenuto[0].y < accent[0].y).toBe(true);
                    }
                });
            }
        }
        it(`deduplicates chord notes to one mark per kind in ${LayoutMode[mode]}`, () => {
            const result = render(load(source('<strong-accent/><tenuto/>', 'up', true)), mode);
            expect(result.marks.map(m => m.symbol).sort()).toEqual(
                [MusicFontSymbol.ArticMarcatoBelow, MusicFontSymbol.ArticTenutoBelow].sort()
            );
        });
    }
});
