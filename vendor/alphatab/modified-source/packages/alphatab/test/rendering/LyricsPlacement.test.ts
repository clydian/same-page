import { readFileSync } from 'node:fs';
import { BeatCloner } from '@coderline/alphatab/generated/model/BeatCloner';
import { MusicXmlImporter } from '@coderline/alphatab/importer/MusicXmlImporter';
import { ByteBuffer } from '@coderline/alphatab/io/ByteBuffer';
import { JsonConverter } from '@coderline/alphatab/model/JsonConverter';
import { NotationElement } from '@coderline/alphatab/NotationSettings';
import { ScoreRenderer } from '@coderline/alphatab/rendering/ScoreRenderer';
import { Settings } from '@coderline/alphatab/Settings';
import { StaveProfile } from '@coderline/alphatab/StaveProfile';
import { describe, expect, it } from 'vitest';

const xml = readFileSync('test-data/musicxml-lyrics/above-and-below-voices.musicxml', 'utf8');
function load(input = xml) {
    const settings = new Settings();
    settings.core.engine = 'svg';
    settings.core.enableLazyLoading = false;
    settings.display.staveProfile = StaveProfile.Score;
    const importer = new MusicXmlImporter();
    importer.init(ByteBuffer.fromBuffer(new TextEncoder().encode(input)), settings);
    return { score: importer.readScore(), settings };
}
function render(input: string, hide = false) {
    const { score, settings } = load(input),
        renderer = new ScoreRenderer(settings),
        svg: string[] = [];
    if (hide) {
        settings.notation.elements.set(NotationElement.EffectLyrics, false);
    }
    renderer.width = 1000;
    renderer.error.on(error => {
        throw error;
    });
    renderer.partialRenderFinished.on(e => {
        if (typeof e.renderResult === 'string') {
            svg.push(e.renderResult);
        }
    });
    renderer.renderScore(score, [0]);
    const output = svg.join('');
    // Use the actual five staff strokes: lineAlignedBounds includes effect-band
    // whitespace here and is not a reliable staff-bottom assertion.
    const staffYs = [...output.matchAll(/<rect x="[^"]+" y="([^"]+)" width="([^"]+)" height="([^"]+)"/g)]
        .filter(m => Number(m[2]) > 50 && Number(m[3]) > 1 && Number(m[3]) < 2)
        .map(m => Number(m[1]));
    expect(new Set(staffYs).size).toBe(5);
    return { svg: output, topLine: Math.min(...staffYs), bottomLine: Math.max(...staffYs) };
}
describe('source lyric above/below placement', () => {
    it('retains authored placement independently of verse number and voice', () => {
        const { score } = load(),
            first = score.tracks[0].staves[0].bars[0];
        expect(first.voices[0].beats[2].lyricElements?.[1].placement).toBe(1);
        expect(first.voices[1].beats[1].lyricElements?.[0].placement).toBe(0);
    });
    it('preserves placement through Worker JSON serialization and beat cloning', () => {
        const { score } = load(),
            beat = score.tracks[0].staves[0].bars[0].voices[0].beats[2];
        const copy = JsonConverter.jsObjectToScore(JsonConverter.scoreToJsObject(score));
        expect(copy.tracks[0].staves[0].bars[0].voices[0].beats[2].lyricElements?.[1].placement).toBe(1);
        expect(BeatCloner.clone(beat).lyricElements?.[1].placement).toBe(1);
    });
    it('places the upper I above the actual staff and the lower I below', () => {
        const result = render(xml);
        const ys = [...result.svg.matchAll(/<text[^>]* y="([^"]+)"[^>]*>I<\/text>/g)].map(m => Number(m[1]));
        expect(ys.length).toBe(2);
        expect(Math.min(...ys) + 12).toBeLessThan(result.topLine);
        expect(Math.max(...ys)).toBeGreaterThan(result.bottomLine);
    });
    it('does not silently collapse authored above and below into identical output', () => {
        const below = xml.replace(/(<lyric\b[^>]*placement=)"above"/g, '$1"below"');
        expect(render(xml).svg).not.toEqual(render(below).svg);
    });
    it('keeps native extender geometry in the authored above lane', () => {
        const original = readFileSync('test-data/musicxml-lyrics/extenders.musicxml', 'utf8');
        const above = original.replace(/<lyric\b/g, '<lyric placement="above"');
        const result = render(above);
        const ys = [...result.svg.matchAll(/<rect x="[^"]+" y="([^"]+)" width="[^"]+" height="0.75"/g)].map(m =>
            Number(m[1])
        );
        expect(ys.length).toBeGreaterThan(2);
        expect(Math.max(...ys)).toBeLessThan(result.topLine);
    });
    it('respects native lyric visibility for both placement lanes', () => {
        const output = render(xml, true).svg;
        expect(output).not.toContain('>I</text>');
        expect(output).not.toContain('>be</text>');
        expect(output).not.toContain('>lieve</text>');
    });
    it('keeps omitted placement identical to explicit default below', () => {
        const below = xml.replace(/(<lyric\b[^>]*placement=)"above"/g, '$1"below"');
        expect(render(below).svg).toEqual(render(below.replace(/ placement="below"/g, '')).svg);
    });
});
