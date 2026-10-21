import { BeatCloner } from '@coderline/alphatab/generated/model/BeatCloner';
import { BeatSerializer } from '@coderline/alphatab/generated/model/BeatSerializer';
import { Beat } from '@coderline/alphatab/model/Beat';
import { MusicXmlImporter } from '@coderline/alphatab/importer/MusicXmlImporter';
import { ByteBuffer } from '@coderline/alphatab/io/ByteBuffer';
import { AlphaSynthMidiFileHandler } from '@coderline/alphatab/midi/AlphaSynthMidiFileHandler';
import { MidiFile } from '@coderline/alphatab/midi/MidiFile';
import { MidiFileGenerator } from '@coderline/alphatab/midi/MidiFileGenerator';
import { JsonConverter } from '@coderline/alphatab/model/JsonConverter';
import { ScoreRenderer } from '@coderline/alphatab/rendering/ScoreRenderer';
import { Settings } from '@coderline/alphatab/Settings';
import { describe, expect, it } from 'vitest';

function source(type: string, stem?: string, chord = false): string {
    const durations: Record<string, number> = { quarter: 2, half: 4, eighth: 1 };
    const n = (step: string, extra = '') =>
        `<note>${extra}<pitch><step>${step}</step><octave>4</octave></pitch><duration>${durations[type]}</duration><type>${type}</type>${stem ? `<stem>${stem}</stem>` : ''}</note>`;
    return `<score-partwise version="4.0"><part-list><score-part id="P"><part-name>Owned stem</part-name></score-part></part-list><part id="P"><measure number="1" implicit="yes"><attributes><divisions>2</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>${n('E')}${chord ? n('G', '<chord/>') : ''}</measure></part></score-partwise>`;
}
function capture(xml: string) {
    const importer = new MusicXmlImporter();
    importer.init(ByteBuffer.fromBuffer(new TextEncoder().encode(xml)), new Settings());
    const score = JsonConverter.jsObjectToScore(JsonConverter.scoreToJsObject(importer.readScore()));
    const settings = new Settings();
    settings.core.engine = 'svg';
    settings.core.enableLazyLoading = false;
    const renderer = new ScoreRenderer(settings),
        pieces: string[] = [];
    renderer.width = 900;
    renderer.partialRenderFinished.on(e => {
        if (typeof e.renderResult === 'string') {
            pieces.push(e.renderResult);
        }
    });
    renderer.error.on(e => {
        throw e;
    });
    try {
        renderer.renderScore(score, [0]);
    } finally {
        renderer.destroy();
    }
    const file = new MidiFile(),
        generator = new MidiFileGenerator(score, settings, new AlphaSynthMidiFileHandler(file));
    generator.generate();
    return {
        score,
        svg: pieces.join(''),
        events: file.tracks.flatMap(t => t.events).map(e => JSON.parse(JSON.stringify(e))),
        bounds: generator.tickLookup.masterBars.map(b => [b.start, b.end])
    };
}
const stemRects = (svg: string) => svg.match(/<rect\b[^>]*width="1\.08"[^>]*>/g) ?? [];
const normalized = (svg: string) => svg.replace(/>\s+</g, '><');
const withoutStems = (svg: string) => normalized(svg.replace(/<rect\b[^>]*width="1\.08"[^>]*>/g, ''));
describe('MusicXML stem none display independent of musical timing', () => {
    for (const type of ['quarter', 'half', 'eighth']) {
        it(`retains ${type} stem visibility through public JSON and changes SVG only`, () => {
            const hidden = capture(source(type, 'none')),
                normal = capture(source(type, 'up'));
            expect(stemRects(normal.svg)).toHaveLength(1);
            expect(stemRects(hidden.svg)).toHaveLength(0);
            expect(normalized(hidden.svg)).toBe(withoutStems(normal.svg));
            expect(Reflect.get(hidden.score.tracks[0].staves[0].bars[0].voices[0].beats[0], 'isStemVisible')).toBe(
                false
            );
            expect(hidden.events).toEqual(normal.events);
            expect(hidden.bounds).toEqual(normal.bounds);
        });
    }
    it('retains the shared chord noteheads and all attacks', () => {
        const a = capture(source('half', 'none', true)),
            b = capture(source('half', 'up', true));
        expect(stemRects(a.svg)).toHaveLength(0);
        expect(stemRects(b.svg)).toHaveLength(1);
        expect(normalized(a.svg)).toBe(withoutStems(b.svg));
        expect(a.events).toEqual(b.events);
    });
    it('retains beam strokes and flags rather than hiding the whole rhythmic group', () => {
        const beamed = (stem: string) =>
            source('eighth', stem).replace(
                '</measure>',
                '<note><pitch><step>F</step><octave>4</octave></pitch><duration>1</duration><type>eighth</type><stem>' +
                    stem +
                    '</stem></note></measure>'
            );
        const a = capture(beamed('none')),
            b = capture(beamed('up'));
        expect(stemRects(b.svg)).toHaveLength(2);
        expect(stemRects(a.svg)).toHaveLength(0);
        expect(normalized(a.svg)).toBe(withoutStems(b.svg));
        expect(a.events).toEqual(b.events);
    });
    it('does not hide a later beat or an independent voice', () => {
        const xml = source('quarter', 'none').replace(
            '</measure>',
            '<backup><duration>2</duration></backup><note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><voice>2</voice><type>quarter</type><stem>down</stem></note></measure>'
        );
        const c = capture(xml);
        expect(stemRects(c.svg)).toHaveLength(1);
        expect(c.score.tracks[0].staves[0].bars[0].voices.map(v => v.beats[0].isStemVisible)).toEqual([false, true]);
    });
    it('keeps another staff stem and does not change cross-staff note positions', () => {
        const xml = source('quarter', 'none')
            .replace(
                '</attributes>',
                '<staves>2</staves><clef number="2"><sign>F</sign><line>4</line></clef></attributes>'
            )
            .replace(
                '</measure>',
                '<backup><duration>2</duration></backup><note><pitch><step>C</step><octave>3</octave></pitch><duration>2</duration><voice>2</voice><type>quarter</type><stem>up</stem><staff>2</staff></note></measure>'
            );
        const a = capture(xml),
            b = capture(xml.replace('<stem>none</stem>', '<stem>up</stem>'));
        expect(stemRects(a.svg)).toHaveLength(1);
        expect(stemRects(b.svg)).toHaveLength(2);
        expect(
            a.score.tracks[0].staves.map(s =>
                s.bars[0].voices.flatMap(v => v.beats.filter(b => b.notes.length).map(b => b.isStemVisible))
            )
        ).toEqual([[false], [true]]);
        expect(a.events).toEqual(b.events);
        expect(a.bounds).toEqual(b.bounds);
    });
    it('clones false and retains true for legacy Worker JSON without the field', () => {
        const b = new Beat();
        b.isStemVisible = false;
        expect(BeatCloner.clone(b).isStemVisible).toBe(false);
        const old = new Beat();
        BeatSerializer.fromJson(old, new Map([['duration', 4]]));
        expect(old.isStemVisible).toBe(true);
    });
    it('keeps absent and invalid stem declarations on legacy automatic rendering', () => {
        expect(capture(source('quarter', 'invalid')).svg).toBe(capture(source('quarter')).svg);
    });
});
