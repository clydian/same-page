import { MusicXmlImporter } from '@coderline/alphatab/importer/MusicXmlImporter';
import { ByteBuffer } from '@coderline/alphatab/io/ByteBuffer';
import { DynamicValue } from '@coderline/alphatab/model/DynamicValue';
import { JsonConverter } from '@coderline/alphatab/model/JsonConverter';
import { MusicFontSymbol } from '@coderline/alphatab/model/MusicFontSymbol';
import { ScoreRenderer } from '@coderline/alphatab/rendering/ScoreRenderer';
import { Settings } from '@coderline/alphatab/Settings';
import { StaveProfile } from '@coderline/alphatab/StaveProfile';
import { describe, expect, it } from 'vitest';

// Held RH and a new LH eighth at q3.5: no RH beat exists for that direction.
const xml = `<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>2</divisions><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes><note><pitch><step>C</step><octave>5</octave></pitch><duration>8</duration><voice>1</voice><type>whole</type><staff>1</staff></note><backup><duration>8</duration></backup><note><pitch><step>C</step><octave>3</octave></pitch><duration>6</duration><voice>2</voice><type>half</type><dot/><staff>2</staff></note><note><pitch><step>D</step><octave>3</octave></pitch><duration>1</duration><voice>2</voice><type>eighth</type><staff>2</staff></note><note><pitch><step>E</step><octave>3</octave></pitch><duration>1</duration><voice>2</voice><type>eighth</type><staff>2</staff></note></measure></part></score-partwise>`;
function load() {
    const settings = new Settings();
    settings.core.engine = 'svg';
    settings.core.enableLazyLoading = false;
    settings.display.staveProfile = StaveProfile.Score;
    const importer = new MusicXmlImporter();
    importer.init(ByteBuffer.fromBuffer(new TextEncoder().encode(xml)), settings);
    const score = importer.readScore();
    score.stylesheet.hideDynamics = false;
    return { score, settings };
}
describe('timed source dynamics independent of beat anchors', () => {
    it.each([420, 1000])('uses shared nonlinear spring timing at width %i, with held-note interpolation', width => {
        const { score, settings } = load();
        const [rh, lh] = score.tracks[0].staves.map(s => s.bars[0]);
        rh.sourceDynamics = [{ displayStart: 3360, value: DynamicValue.MP }];
        const renderer = new ScoreRenderer(settings);
        renderer.width = width;
        renderer.error.on(e => {
            throw e;
        });
        renderer.renderScore(score, [0]);
        const right = renderer.layout!.getRendererForBar('score', rh)!;
        const left = renderer.layout!.getRendererForBar('score', lh)!;
        const attack = lh.voices.flatMap(v => v.beats).find(b => b.playbackStart === 3360)!;
        const container = left.getBeatContainer(attack)!;
        // Match the native DynamicsEffectInfo on-time anchor (not the notehead left edge).
        expect(right.getDisplayTimeX(3360)).toBeCloseTo(left.beatGlyphsStart + container.x + container.onTimeX, 7);
        const start = right.getDisplayTimeX(2880),
            end = right.getDisplayTimeX(3360);
        expect(right.getDisplayTimeX(3120)).toBeCloseTo((start + end) / 2, 7);
        expect(right.getDisplayTimeX(3840)).toBeCloseTo(right.postBeatGlyphsStart, 7);
        const oldX = right.getDisplayTimeX(3360);
        right.scaleToWidth(width);
        left.scaleToWidth(width);
        expect(right.getDisplayTimeX(3360)).not.toBeCloseTo(oldX, 2);
        expect(right.getDisplayTimeX(3360)).toBeCloseTo(left.beatGlyphsStart + container.x + container.onTimeX, 7);
        expect(right.getDisplayTimeX(3120)).toBeCloseTo(
            (right.getDisplayTimeX(2880) + right.getDisplayTimeX(3360)) / 2,
            7
        );
        expect(right.getDisplayTimeX(3840)).toBeCloseTo(right.postBeatGlyphsStart, 7);
    });
    it('supports repeated equal and rest-time declarations, and respects global hiding', () => {
        const { score, settings } = load();
        const rh = score.tracks[0].staves[0].bars[0];
        rh.sourceDynamics = [
            { displayStart: 0, value: DynamicValue.PP },
            { displayStart: 3360, value: DynamicValue.PP }
        ];
        const renderer = new ScoreRenderer(settings),
            svg: string[] = [];
        renderer.width = 1000;
        renderer.error.on(e => {
            throw e;
        });
        renderer.partialRenderFinished.on(e => {
            if (typeof e.renderResult === 'string') {
                svg.push(e.renderResult);
            }
        });
        renderer.renderScore(score, [0]);
        expect(svg.join('').split(`&#${MusicFontSymbol.DynamicPP};`).length - 1).toBe(2);
        svg.length = 0;
        score.stylesheet.hideDynamics = true;
        renderer.renderScore(score, [0]);
        expect(svg.join('').split(`&#${MusicFontSymbol.DynamicPP};`).length - 1).toBe(0);
    });

    it('engraves a RH declaration at q3.5 without inventing or moving any beat', () => {
        const { score, settings } = load();
        const rh = score.tracks[0].staves[0].bars[0];
        expect(rh.voices.flatMap(v => v.beats).some(b => b.playbackStart === 3360)).toBe(false);
        const before = JsonConverter.scoreToJsObject(score);
        Object.assign(rh, { sourceDynamics: [{ displayStart: 3360, value: DynamicValue.MP }] });
        const renderer = new ScoreRenderer(settings),
            svg: string[] = [];
        renderer.width = 1000;
        renderer.error.on(e => {
            throw e;
        });
        renderer.partialRenderFinished.on(e => {
            if (typeof e.renderResult === 'string') {
                svg.push(e.renderResult);
            }
        });
        renderer.renderScore(score, [0]);
        expect(svg.join('').split(`&#${MusicFontSymbol.DynamicMP};`).length - 1).toBe(1);
        Object.assign(rh, { sourceDynamics: null });
        expect(JsonConverter.scoreToJsObject(score)).toEqual(before);
    });
    it('retains all declaration times and values through Worker serialization', () => {
        const { score } = load();
        const declarations = [
            { displayStart: 0, value: DynamicValue.PP },
            { displayStart: 3360, value: DynamicValue.MP }
        ];
        Object.assign(score.tracks[0].staves[0].bars[0], { sourceDynamics: declarations });
        const copy = JsonConverter.jsObjectToScore(JsonConverter.scoreToJsObject(score));
        expect(copy.tracks[0].staves[0].bars[0].sourceDynamics).toEqual(declarations);
    });
});
