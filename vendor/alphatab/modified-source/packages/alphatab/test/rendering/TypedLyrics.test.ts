import { readFileSync } from 'node:fs';
import { MusicXmlImporter } from '@coderline/alphatab/importer/MusicXmlImporter';
import { ByteBuffer } from '@coderline/alphatab/io/ByteBuffer';
import { JsonConverter } from '@coderline/alphatab/model/JsonConverter';
import { MeasuredText } from '@coderline/alphatab/platform/ICanvas';
import { FontSizes } from '@coderline/alphatab/platform/svg/FontSizes';
import { LyricsGlyph } from '@coderline/alphatab/rendering/glyphs/LyricsGlyph';
import { ScoreRenderer } from '@coderline/alphatab/rendering/ScoreRenderer';
import { Settings } from '@coderline/alphatab/Settings';
import { StaveProfile } from '@coderline/alphatab/StaveProfile';
import { describe, expect, it, vi } from 'vitest';

const input = readFileSync('test-data/musicxml-lyrics/extenders.musicxml', 'utf8');
function load(xml: string, settings = new Settings()) {
    const importer = new MusicXmlImporter();
    importer.init(ByteBuffer.fromBuffer(new TextEncoder().encode(xml)), settings);
    return importer.readScore();
}
function render(xml: string, rows = false) {
    const settings = new Settings();
    settings.core.engine = 'svg';
    settings.core.enableLazyLoading = false;
    settings.display.staveProfile = StaveProfile.Score;
    if (rows) {
        settings.display.barsPerRow = 1;
    }
    const score = load(xml, settings),
        renderer = new ScoreRenderer(settings),
        svg: string[] = [];
    renderer.width = 1000;
    renderer.partialRenderFinished.on(e => {
        if (typeof e.renderResult === 'string') {
            svg.push(e.renderResult);
        }
    });
    renderer.renderScore(score, [0]);
    return svg;
}
const control = input.replace(/<extend[^>]*\/>/g, '');
describe('typed source lyrics native layout', () => {
    it('retains source extension endpoints and syllabic independently from ties/slurs', () => {
        const score = load(input),
            bars = score.tracks[0].staves[0].bars;
        expect(bars[0].voices[0].beats[0].lyricElements?.[0].extension).toBe(1);
        expect(bars[1].voices[0].beats[0].lyricElements?.[0].extension).toBe(3);
        expect(bars[1].voices[0].beats[1].lyricElements?.[0].extension).toBe(1);
        expect(bars[2].voices[0].beats[1].lyricElements?.[0].syllabic).toBe(1);
        expect(bars[2].voices[0].beats[2].lyricElements?.[0].syllabic).toBe(3);
    });
    it('survives worker JSON serialization', () => {
        const score = load(input);
        const copy = JsonConverter.jsObjectToScore(JsonConverter.scoreToJsObject(score));
        expect(copy.tracks[0].staves[0].bars[0].voices[0].beats[0].lyricElements?.[0].extension).toBe(1);
    });
    it('draws real source extender geometry rather than adding underscore text', () => {
        expect(render(input)).not.toEqual(render(control));
        expect(render(input).join('')).not.toContain('Joy_');
    });
    it('keeps a source span across a note with no redundant continue element', () => {
        const sparse = input.replace(/<lyric number="1">\s*<extend type="continue"\/>\s*<\/lyric>/, '');
        expect(sparse).not.toBe(input);
        expect(render(sparse)).toEqual(render(input));
    });
    it('does not infer a lyric line from a pitch tie or a slur', () => {
        const score = load(control);
        for (const bar of score.tracks[0].staves[0].bars) {
            for (const beat of bar.voices[0].beats) {
                expect(LyricsGlyph.hasIncomingExtension(beat)).toBe(false);
            }
        }
    });
    it('renders syllabic hyphens separately from same-word extenders', () => {
        const noSyllabic = input.replace(/<syllabic>(?:begin|end)<\/syllabic>/g, '');
        expect(render(noSyllabic)).not.toEqual(render(input));
    });
    it('keeps a syllabic hyphen when the following syllable starts a new system', () => {
        const split = `<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Voice</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><note><rest/><duration>2</duration><type>half</type></note><note><pitch><step>C</step><octave>5</octave></pitch><duration>2</duration><type>half</type><lyric><syllabic>begin</syllabic><text>re</text></lyric></note></measure><measure number="2"><note><pitch><step>D</step><octave>5</octave></pitch><duration>4</duration><type>whole</type><lyric><syllabic>end</syllabic><text>plied</text></lyric></note></measure></part></score-partwise>`;
        const untyped = split.replace(/<syllabic>(?:begin|end)<\/syllabic>/g, '');
        expect(render(split, true)).not.toEqual(render(untyped, true));
    });
    it('links a syllabic word across intervening notes without lyric text', () => {
        const xml = readFileSync('test-data/musicxml-lyrics/melismatic-syllable.musicxml', 'utf8');
        const untyped = xml.replace(/<syllabic>(?:begin|middle|end)<\/syllabic>/g, '');
        expect(render(xml)).not.toEqual(render(untyped));
    });
    it('retains a syllabic span through a full blank-lyric system', () => {
        const xml = readFileSync('test-data/musicxml-lyrics/melismatic-syllable-across-systems.musicxml', 'utf8');
        const untyped = xml.replace(/<syllabic>(?:begin|middle|end)<\/syllabic>/g, '');
        const typedRows = render(xml, true),
            plainRows = render(untyped, true);
        expect(typedRows.filter((row, i) => row !== plainRows[i]).length).toBe(2);
    });
    it('joins contiguous melisma segments without notehead-width gaps', () => {
        const lines = [
            ...render(input)
                .join('')
                .matchAll(/<rect x="([^"]+)" y="([^"]+)" width="([^"]+)" height="0.75"/g)
        ].map(m => ({ x: Number(m[1]), y: Number(m[2]), width: Number(m[3]) }));
        expect(
            lines.some(a => lines.some(b => a !== b && a.y === b.y && Math.abs(a.x + a.width - b.x) < 0.000001))
        ).toBe(true);
    });
    it('ends an implicit legacy extension before the next printed word', () => {
        const legacy = input.replace('<extend type="start"/>', '<extend/>').replace('<extend type="stop"/>', '');
        const lines = [
            ...render(legacy)
                .join('')
                .matchAll(/<rect x="([^"]+)" y="([^"]+)" width="([^"]+)" height="0.75"/g)
        ].map(m => ({ x: Number(m[1]), y: Number(m[2]), width: Number(m[3]) }));
        const parsed = render(legacy).join('');
        const word = /<text[^>]*x="([^"]+)"[^>]*>Sing<\/text>/.exec(parsed);
        expect(word).not.toBeNull();
        const x = Number(word![1]);
        expect(lines.filter(l => l.x < x).every(l => l.x + l.width < x)).toBe(true);
    });
    it('keeps two numbered verses and their native lyric lanes separate', () => {
        const two = input.replace(
            /<lyric number="1">[\s\S]*?<\/lyric>/g,
            lyric => lyric + lyric.replace('number="1"', 'number="2"').replace('Joy', 'Love').replace('Sing', 'Peace')
        );
        const score = load(two);
        const first = score.tracks[0].staves[0].bars[0].voices[0].beats[0];
        expect(first.lyrics).toEqual(['Joy', 'Love']);
        expect(first.lyricElements?.map(e => e.extension)).toEqual([1, 1]);
        const svg = render(two).join('');
        expect(svg).toContain('Love');
        expect(svg).toContain('Peace');
        expect(svg).not.toBe(render(input).join(''));
    });
    it('keeps the stop note covered while clearing the following lyric', () => {
        const implicitEndAtNewWord = input.replace('<extend type="stop"/>', '');
        expect(render(input)).toEqual(render(implicitEndAtNewWord));
    });
    it('keeps the extender baseline stable when browser space has no ink height', () => {
        const original = FontSizes.measureString;
        const measure = vi.spyOn(FontSizes, 'measureString').mockImplementation((text, ...args) => {
            const result = original(text, ...args);
            return new MeasuredText(result.width, text.trim() ? 9 : 0);
        });
        try {
            const extenders = [
                ...render(input)
                    .join('')
                    .matchAll(/<rect x="([^"]+)" y="([^"]+)" width="([^"]+)" height="0.75"/g)
            ].filter(m => Number(m[3]) > 4);
            expect(extenders.length).toBeGreaterThan(2);
            expect(new Set(extenders.map(m => m[2])).size).toBe(1);
        } finally {
            measure.mockRestore();
        }
    });
    it('splits native extension geometry across actual systems', () => {
        const a = render(input, true),
            b = render(control, true);
        expect(a.length).toBe(b.length);
        expect(a.filter((x, i) => x !== b[i]).length).toBeGreaterThanOrEqual(2);
    });
});
