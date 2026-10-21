import { NoteCloner } from '@coderline/alphatab/generated/model/NoteCloner';
import { NoteSerializer } from '@coderline/alphatab/generated/model/NoteSerializer';
import { MusicXmlImporter } from '@coderline/alphatab/importer/MusicXmlImporter';
import { ByteBuffer } from '@coderline/alphatab/io/ByteBuffer';
import { LayoutMode } from '@coderline/alphatab/LayoutMode';
import { JsonConverter } from '@coderline/alphatab/model/JsonConverter';
import { Note } from '@coderline/alphatab/model/Note';
import { ScoreSlurGlyph } from '@coderline/alphatab/rendering/glyphs/ScoreSlurGlyph';
import { ScoreRenderer } from '@coderline/alphatab/rendering/ScoreRenderer';
import { BeamDirection } from '@coderline/alphatab/rendering/utils/BeamDirection';
import { Settings } from '@coderline/alphatab/Settings';
import { StaveProfile } from '@coderline/alphatab/StaveProfile';
import { describe, expect, it, vi } from 'vitest';

function source(start?: string, stop = start, across = false): string {
    const placement = (value?: string) => (value ? ` placement="${value}"` : '');
    const notes = (first: boolean, last: boolean) =>
        `<note><pitch><step>G</step><octave>3</octave></pitch><duration>1</duration><type>quarter</type>${first ? `<notations><slur type="start" number="1"${placement(start)}/></notations>` : ''}</note><note><pitch><step>A</step><octave>3</octave></pitch><duration>1</duration><type>quarter</type></note><note><pitch><step>B</step><octave>3</octave></pitch><duration>2</duration><type>half</type>${last ? `<notations><slur type="stop" number="1"${placement(stop)}/></notations>` : ''}</note>`;
    return `<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Tenor</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line><clef-octave-change>-1</clef-octave-change></clef></attributes>${notes(true, !across)}</measure>${across ? `<measure number="2">${notes(false, true)}</measure>` : ''}</part></score-partwise>`;
}
function load(xml: string, settings = new Settings()) {
    const importer = new MusicXmlImporter();
    importer.init(ByteBuffer.fromBuffer(new TextEncoder().encode(xml)), settings);
    return importer.readScore();
}
function render(xml: string, rows = false, throughJson = false, horizontal = false) {
    const settings = new Settings();
    settings.core.engine = 'svg';
    settings.core.enableLazyLoading = false;
    settings.display.staveProfile = StaveProfile.Score;
    if (horizontal) {
        settings.display.layoutMode = LayoutMode.Horizontal;
    }
    if (rows) {
        settings.display.barsPerRow = 1;
    }
    let score = load(xml, settings);
    if (throughJson) {
        score = JsonConverter.jsObjectToScore(JsonConverter.scoreToJsObject(score));
    }
    const renderer = new ScoreRenderer(settings),
        svg: string[] = [],
        directions: BeamDirection[] = [];
    renderer.width = 900;
    const original = ScoreSlurGlyph.prototype.doLayout;
    const spy = vi.spyOn(ScoreSlurGlyph.prototype, 'doLayout').mockImplementation(function (this: ScoreSlurGlyph) {
        original.call(this);
        directions.push(this.tieDirection);
    });
    renderer.partialRenderFinished.on(event => {
        if (typeof event.renderResult === 'string') {
            svg.push(event.renderResult);
        }
    });
    renderer.error.on(error => {
        throw error;
    });
    try {
        renderer.renderScore(score, [0]);
    } finally {
        spy.mockRestore();
        renderer.destroy();
    }
    return { directions, paths: svg.join('').match(/<path\b[^>]*\bd="[^"]+"/g) ?? [] };
}
describe('MusicXML explicit phrase slur placement', () => {
    it('retains above and below on the outgoing phrase-slur origin', () => {
        expect(
            Reflect.get(load(source('above')).tracks[0].staves[0].bars[0].voices[0].beats[0].notes[0], 'slurPlacement')
        ).toBe(1);
        expect(
            Reflect.get(load(source('below')).tracks[0].staves[0].bars[0].voices[0].beats[0].notes[0], 'slurPlacement')
        ).toBe(2);
    });
    it('draws above and below on opposite sides independent from stem direction', () => {
        const above = render(source('above')),
            below = render(source('below'));
        expect(above.directions.length).toBeGreaterThan(0);
        expect(above.directions.every(value => value === BeamDirection.Up)).toBe(true);
        expect(below.directions.every(value => value === BeamDirection.Down)).toBe(true);
        expect(above.paths).not.toEqual(below.paths);
    });
    it('survives public Worker JSON roundtrip', () => {
        const copy = JsonConverter.jsObjectToScore(JsonConverter.scoreToJsObject(load(source('above'))));
        expect(Reflect.get(copy.tracks[0].staves[0].bars[0].voices[0].beats[0].notes[0], 'slurPlacement')).toBe(1);
        expect(render(source('above'), false, true)).toEqual(render(source('above')));
    });
    it('keeps the explicit side on both segments across a system boundary', () => {
        const above = render(source('above', 'above', true), true, true);
        expect(above.directions.length).toBeGreaterThanOrEqual(2);
        expect(above.directions.every(value => value === BeamDirection.Up)).toBe(true);
    });
    it('uses an explicit stop placement when the start omitted its placement', () => {
        expect(render(source(undefined, 'above')).directions.every(value => value === BeamDirection.Up)).toBe(true);
    });
    it('keeps an explicit start authoritative when endpoint sides conflict', () => {
        expect(render(source('above', 'below')).directions.every(value => value === BeamDirection.Up)).toBe(true);
    });
    it('honors explicit sides in Horizontal layout', () => {
        expect(render(source('above'), false, true, true).directions.every(value => value === BeamDirection.Up)).toBe(
            true
        );
        expect(render(source('below'), false, true, true).directions.every(value => value === BeamDirection.Down)).toBe(
            true
        );
    });
    it('preserves placement in note clones and leaves old JSON automatic', () => {
        const origin = load(source('above')).tracks[0].staves[0].bars[0].voices[0].beats[0].notes[0];
        expect(NoteCloner.clone(origin).slurPlacement).toBe(1);
        const oldNote = new Note();
        NoteSerializer.fromJson(oldNote, new Map([['id', 0]]));
        expect(oldNote.slurPlacement).toBe(0);
    });
    it('keeps simultaneous voices with opposite explicit sides independent', () => {
        const secondVoice = source('below')
            .match(/<note>[\s\S]*<\/note>/)![0]
            .replaceAll('number="1"', 'number="2"')
            .replaceAll('<type>', '<voice>2</voice><type>');
        const xml = source('above')
            .replaceAll('<type>', '<voice>1</voice><type>')
            .replace('</measure>', `<backup><duration>4</duration></backup>${secondVoice}</measure>`);
        const directions = render(xml, false, true).directions;
        expect(directions).toContain(BeamDirection.Up);
        expect(directions).toContain(BeamDirection.Down);
    });
    it('preserves automatic legacy engraving when placement is omitted or unrecognized', () => {
        expect(render(source()).directions.every(value => value === BeamDirection.Down)).toBe(true);
        expect(render(source('unrecognized'))).toEqual(render(source()));
    });
    it('keeps ties distinct from phrase-slur placement', () => {
        const xml = source('above').replace(/<slur/g, '<tied');
        expect(
            Reflect.get(load(xml).tracks[0].staves[0].bars[0].voices[0].beats[0].notes[0], 'slurPlacement') ?? 0
        ).toBe(0);
        expect(render(xml).directions).toEqual([]);
    });
});
