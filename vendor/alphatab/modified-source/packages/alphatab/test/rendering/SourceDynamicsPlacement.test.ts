import { MusicXmlImporter } from '@coderline/alphatab/importer/MusicXmlImporter';
import { ByteBuffer } from '@coderline/alphatab/io/ByteBuffer';
import { SourceDynamic } from '@coderline/alphatab/model/Bar';
import { DynamicValue } from '@coderline/alphatab/model/DynamicValue';
import { JsonConverter } from '@coderline/alphatab/model/JsonConverter';
import { MusicFontSymbol } from '@coderline/alphatab/model/MusicFontSymbol';
import { NotationElement } from '@coderline/alphatab/NotationSettings';
import { ScoreRenderer } from '@coderline/alphatab/rendering/ScoreRenderer';
import { Settings } from '@coderline/alphatab/Settings';
import { StaveProfile } from '@coderline/alphatab/StaveProfile';
import { describe, expect, it } from 'vitest';
const xml =
    '<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>2</divisions><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes><note><pitch><step>C</step><octave>5</octave></pitch><duration>8</duration><voice>1</voice><type>whole</type><staff>1</staff></note><backup><duration>8</duration></backup><note><pitch><step>C</step><octave>3</octave></pitch><duration>6</duration><voice>2</voice><type>half</type><dot/><staff>2</staff></note><note><pitch><step>D</step><octave>3</octave></pitch><duration>1</duration><voice>2</voice><type>eighth</type><staff>2</staff></note><note><pitch><step>E</step><octave>3</octave></pitch><duration>1</duration><voice>2</voice><type>eighth</type><staff>2</staff></note></measure></part></score-partwise>';
function load() {
    const settings = new Settings();
    settings.core.engine = 'svg';
    settings.core.enableLazyLoading = false;
    settings.display.staveProfile = StaveProfile.Score;
    const imp = new MusicXmlImporter();
    imp.init(ByteBuffer.fromBuffer(new TextEncoder().encode(xml)), settings);
    const score = imp.readScore();
    score.stylesheet.hideDynamics = false;
    score.tracks[0].staves[1].bars[0].sourceDynamics = [];
    return { score, settings };
}
function declarations(above = true): SourceDynamic[] {
    return [
        Object.assign(new SourceDynamic(), { displayStart: 2880, value: DynamicValue.PP, placement: above ? 1 : 0 }),
        Object.assign(new SourceDynamic(), { displayStart: 3360, value: DynamicValue.MP, placement: 0 })
    ];
}
function render(marks = declarations(), hidden: 'stylesheet' | 'notation' | null = null) {
    const { score, settings } = load();
    score.tracks[0].staves[0].bars[0].sourceDynamics = marks;
    if (hidden === 'stylesheet') { score.stylesheet.hideDynamics = true; }
    if (hidden === 'notation') { settings.notation.elements.set(NotationElement.EffectDynamics, false); }
    const r = new ScoreRenderer(settings),
        svg: string[] = [];
    r.width = 1000;
    r.error.on(e => {
        throw e;
    });
    r.partialRenderFinished.on(e => {
        if (typeof e.renderResult === 'string') { svg.push(e.renderResult); }
    });
    r.renderScore(score, [0]);
    return svg.join('');
}
function symbolY(svg: string, symbol: MusicFontSymbol) {
    const matches = [
        ...svg.matchAll(
            new RegExp(`<g transform="translate\\([^ ]+ ([^)]+)\\)"[^>]*><text[^>]*>&#${symbol};<\\/text>`, 'g')
        )
    ];
    expect(matches.length).toBe(1);
    return Number(matches[0][1]);
}
describe('source dynamic above/below native lanes', () => {
    it('retains explicit placement through Worker JSON', () => {
        const { score } = load(),
            bar = score.tracks[0].staves[0].bars[0];
        bar.sourceDynamics = declarations();
        const copy = JsonConverter.jsObjectToScore(JsonConverter.scoreToJsObject(score));
        expect(copy.tracks[0].staves[0].bars[0].sourceDynamics).toEqual(bar.sourceDynamics);
    });
    it('places PP above RH and MP between staves with no RH beat at those times', () => {
        const { score } = load();
        expect(score.tracks[0].staves[0].bars[0].voices[0].beats.some(b => [2880, 3360].includes(b.displayStart))).toBe(
            false
        );
        const svg = render(),
            ys = [...svg.matchAll(/<rect x="[^"]+" y="([^"]+)" width="([^"]+)" height="([^"]+)"/g)]
                .filter(m => Number(m[2]) > 50 && Number(m[3]) > 1 && Number(m[3]) < 2)
                .map(m => Number(m[1])),
            lines = [...new Set(ys)].sort((a, b) => a - b);
        expect(lines.length).toBe(10);
        expect(symbolY(svg, MusicFontSymbol.DynamicPP)).toBeLessThan(lines[0]);
        expect(symbolY(svg, MusicFontSymbol.DynamicMP)).toBeGreaterThan(lines[4]);
        expect(symbolY(svg, MusicFontSymbol.DynamicMP)).toBeLessThan(lines[5]);
    });
    it('does not collapse authored above into below output', () => {
        expect(render()).not.toEqual(render(declarations(false)));
    });
    it.each(['stylesheet', 'notation'] as const)('respects %s hiding in both lanes', hidden => {
        const svg = render(declarations(), hidden);
        expect(svg).not.toContain(`&#${MusicFontSymbol.DynamicPP};`);
        expect(svg).not.toContain(`&#${MusicFontSymbol.DynamicMP};`);
    });
    it('keeps omitted placement identical to explicit below', () => {
        const omitted = declarations(false).map(d => {
            const copy = { ...d };
            delete copy.placement;
            return copy;
        });
        expect(render(omitted)).toEqual(render(declarations(false)));
    });
});
