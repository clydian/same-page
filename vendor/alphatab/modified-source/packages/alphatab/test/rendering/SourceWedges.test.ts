import { MusicXmlImporter } from '@coderline/alphatab/importer/MusicXmlImporter';
import { ByteBuffer } from '@coderline/alphatab/io/ByteBuffer';
import { LayoutMode } from '@coderline/alphatab/LayoutMode';
import { SourceDynamic, SourceWedge, SourceWedgePlacement } from '@coderline/alphatab/model/Bar';
import { CrescendoType } from '@coderline/alphatab/model/CrescendoType';
import { DynamicValue } from '@coderline/alphatab/model/DynamicValue';
import { JsonConverter } from '@coderline/alphatab/model/JsonConverter';
import { NotationElement } from '@coderline/alphatab/NotationSettings';
import { ScoreRenderer } from '@coderline/alphatab/rendering/ScoreRenderer';
import { Settings } from '@coderline/alphatab/Settings';
import { StaveProfile } from '@coderline/alphatab/StaveProfile';
import { describe, expect, it } from 'vitest';

const note = '<note><pitch><step>C</step><octave>5</octave></pitch><duration>1</duration><type>quarter</type></note>';
const xml = `<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Voice</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>${note.repeat(4)}</measure><measure number="2">${note.repeat(4)}</measure></part></score-partwise>`;
function load() {
    const settings = new Settings();
    settings.core.engine = 'svg';
    settings.core.enableLazyLoading = false;
    settings.display.staveProfile = StaveProfile.Score;
    const i = new MusicXmlImporter();
    i.init(ByteBuffer.fromBuffer(new TextEncoder().encode(xml)), settings);
    return { score: i.readScore(), settings };
}
function mark(values: Partial<SourceWedge> = {}) {
    return Object.assign(new SourceWedge(), { displayStart: 480, displayEnd: 2400, ...values });
}
function render(
    marks: SourceWedge[] | null,
    second: SourceWedge[] | null = [],
    barsPerRow = 2,
    legacy = false,
    hidden = false
) {
    const { score, settings } = load();
    const bars = score.tracks[0].staves[0].bars;
    bars[0].sourceWedges = marks;
    bars[1].sourceWedges = second;
    if (legacy) {
        for (const b of bars[0].voices[0].beats) {
            b.crescendo = CrescendoType.Crescendo;
        }
    }
    if (hidden) {
        settings.notation.elements.set(NotationElement.EffectCrescendo, false);
    }
    settings.display.barsPerRow = barsPerRow;
    const r = new ScoreRenderer(settings),
        svg: string[] = [];
    r.width = 1000;
    r.error.on(e => {
        throw e;
    });
    r.partialRenderFinished.on(e => {
        if (typeof e.renderResult === 'string') {
            svg.push(e.renderResult);
        }
    });
    r.renderScore(score, [0]);
    r.destroy();
    return svg.join('');
}
const paths = (svg: string) =>
    [...svg.matchAll(/<path d="([^"]+)"[^>]*>/g)]
        .filter(m => (m[1].match(/L/g) ?? []).length === 2 && !m[1].includes('C') && !m[1].includes('z'))
        .map(m => [...m[1].matchAll(/[-+]?[0-9]*\.?[0-9]+/g)].map(n => Number(n[0])));
const heads = (svg: string) =>
    [...svg.matchAll(/<g transform="translate\(([^ ]+) ([^)]+)\)"[^>]*><text[^>]*>&#57508;<\/text>/g)].map(m => ({
        x: Number(m[1]),
        y: Number(m[2])
    }));
describe('independent authored source wedge display', () => {
    it('positions endpoints between actual note columns without inserting a beat', () => {
        const svg = render([mark()]),
            p = paths(svg)[0],
            h = heads(svg);
        expect(paths(svg)).toHaveLength(1);
        // Shared spring columns use the head center; SVG text origins use its
        // left bearing. Compare timing spacing and stay strictly between attacks.
        expect(p[0]).toBeGreaterThan(h[0].x);
        expect(p[0]).toBeLessThan(h[1].x);
        expect(p[2]).toBeGreaterThan(h[2].x);
        expect(p[2]).toBeLessThan(h[3].x);
        expect(p[2] - p[0]).toBeCloseTo((h[2].x + h[3].x - h[0].x - h[1].x) / 2, 7);
    });
    it('preserves fractional display ticks without snapping', () => {
        const a = paths(render([mark({ displayStart: 480.25 })]))[0],
            b = paths(render([mark()]))[0];
        expect(a[0]).toBeGreaterThan(b[0]);
        expect(a[0] - b[0]).toBeLessThan(1);
    });
    it('keeps independent overlapping authored spans on separate native lanes', () => {
        const svg = render([
            mark({ sourceId: 'upper', displayStart: 0, displayEnd: 2880 }),
            mark({ sourceId: 'lower', displayStart: 960, displayEnd: 3840 })
        ]);
        const lines = paths(svg);
        expect(lines).toHaveLength(2);
        expect(lines[0][1]).not.toEqual(lines[1][1]);
    });
    it('respects above/below native staff lanes', () => {
        const a = paths(render([mark({ placement: SourceWedgePlacement.Above })]))[0],
            b = paths(render([mark()]))[0];
        expect(a[1]).toBeLessThan(heads(render([mark()]))[0].y);
        expect(b[1]).toBeGreaterThan(heads(render([mark()]))[0].y);
    });
    it('source [] suppresses old voice glyphs while null retains the legacy path', () => {
        expect(paths(render([], [], 2, true))).toHaveLength(0);
        expect(paths(render(null, [], 2, true))).toHaveLength(1);
    });
    it('keeps two adjacent opposite source signs separate', () => {
        expect(
            paths(
                render([
                    mark({ displayStart: 0, displayEnd: 1920 }),
                    mark({ displayStart: 1920, displayEnd: 3840, type: CrescendoType.Decrescendo })
                ])
            )
        ).toHaveLength(2);
    });
    it('does not merge adjacent same-kind source signs', () => {
        expect(
            paths(render([mark({ displayStart: 0, displayEnd: 1920 }), mark({ displayStart: 1920, displayEnd: 3840 })]))
        ).toHaveLength(2);
    });
    it('joins one straight source shape across bar lines on one system', () => {
        const a = mark({ sourceId: 'one', displayEnd: 3840, endProgress: 0.6 }),
            b = mark({ sourceId: 'one', displayStart: 0, displayEnd: 1920, startProgress: 0.6 });
        expect(paths(render([a], [b]))).toHaveLength(1);
    });
    it('continues the opening across a system break rather than restarting closed', () => {
        const a = mark({ sourceId: 'one', displayEnd: 3840, endProgress: 0.6 }),
            b = mark({ sourceId: 'one', displayStart: 0, displayEnd: 1920, startProgress: 0.6 }),
            p = paths(render([a], [b], 1));
        expect(p).toHaveLength(2);
        const firstEnd = Math.abs(p[0][7] - p[0][3]),
            nextStart = Math.abs(p[1][5] - p[1][1]);
        expect(firstEnd).toBeCloseTo(nextStart, 7);
        expect(nextStart).toBeGreaterThan(0);
    });
    it('does not link different source identities across bars', () => {
        const a = mark({ sourceId: 'one', displayEnd: 3840, endProgress: 0.6 }),
            b = mark({ sourceId: 'two', displayStart: 0, displayEnd: 1920, startProgress: 0.6 });
        expect(paths(render([a], [b]))).toHaveLength(2);
    });
    it('hides the independent glyph through the existing notation switch', () => {
        expect(paths(render([mark()], [], 2, false, true))).toHaveLength(0);
    });
    it('retains declarations through public Worker JSON', () => {
        const { score } = load();
        score.tracks[0].staves[0].bars[0].sourceWedges = [
            mark({ sourceId: 'one', placement: SourceWedgePlacement.Above })
        ];
        const copy = JsonConverter.jsonToScore(JsonConverter.scoreToJson(score));
        expect(copy.tracks[0].staves[0].bars[0].sourceWedges).toEqual(score.tracks[0].staves[0].bars[0].sourceWedges);
    });
    it('accepts legacy Worker JSON without sourceWedges as null', () => {
        const { score } = load(),
            old = JSON.parse(JsonConverter.scoreToJson(score), (key, value) =>
                key.toLowerCase() === 'sourcewedges' ? undefined : value
            ),
            copy = JsonConverter.jsObjectToScore(old);
        expect(copy.tracks[0].staves[0].bars[0].sourceWedges).toBeNull();
    });
    it.each([
        { displayStart: -1 },
        { displayEnd: 5000 },
        { displayEnd: 480 },
        { displayStart: NaN },
        { endProgress: 2 },
        { startProgress: 0.8, endProgress: 0.2 },
        { type: CrescendoType.None }
    ])('ignores invalid extent/progress without clamping: %j', value => {
        expect(paths(render([mark(value)]))).toHaveLength(0);
    });
});

it('painted wedge ink clears same-endpoint explicit dynamic without changing source ticks', () => {
    function draw(withDynamics: boolean) {
        const { score, settings } = load();
        const bar = score.tracks[0].staves[0].bars[0];
        const wedge = mark({ displayStart: 960, displayEnd: 2880 });
        bar.sourceWedges = [wedge];
        score.tracks[0].staves[0].bars[1].sourceWedges = [];
        if (withDynamics) {
            bar.sourceDynamics = [960, 2880].map(displayStart =>
                Object.assign(new SourceDynamic(), { displayStart, value: DynamicValue.P })
            );
        }
        const renderer = new ScoreRenderer(settings),
            svg: string[] = [];
        renderer.width = 1000;
        renderer.partialRenderFinished.on(e => {
            if (typeof e.renderResult === 'string') {
                svg.push(e.renderResult);
            }
        });
        renderer.error.on(e => {
            throw e;
        });
        renderer.renderScore(score, [0]);
        renderer.destroy();
        expect([wedge.displayStart, wedge.displayEnd]).toEqual([960, 2880]);
        return paths(svg.join(''))[0];
    }
    const plain = draw(false),
        spaced = draw(true);
    expect(spaced[0]).toBeGreaterThan(plain[0]);
    expect(spaced[2]).toBeLessThan(plain[2]);
});

it.each([0, 5000])('an invalid neighboring segment %i is ignored when joining', endpoint => {
    const start = mark({ sourceId: 'joined', displayEnd: 3840, endProgress: 0.6 });
    const invalid = mark({ sourceId: 'joined', displayStart: 0, displayEnd: endpoint, startProgress: 0.6 });
    expect(paths(render([start], [invalid]))).toEqual(paths(render([start], [])));
});

it.each([1, 10])('horizontal SVG partials retain the whole source span across a %i-bar boundary', count => {
    const { settings } = load();
    settings.display.layoutMode = LayoutMode.Horizontal;
    settings.display.barCountPerPartial = count;
    const extra = Array.from(
        { length: count },
        (_, i) => `<measure number="${i + 2}">${note.repeat(4)}</measure>`
    ).join('');
    const input = xml.replace(`<measure number="2">${note.repeat(4)}</measure>`, extra);
    const importer = new MusicXmlImporter();
    importer.init(ByteBuffer.fromBuffer(new TextEncoder().encode(input)), settings);
    const score = importer.readScore(),
        bars = score.tracks[0].staves[0].bars;
    for (const bar of bars) {
        bar.sourceWedges = [];
    }
    bars[count - 1].sourceWedges = [mark({ sourceId: 'horizontal', displayEnd: 3840, endProgress: 0.6 })];
    bars[count].sourceWedges = [
        mark({ sourceId: 'horizontal', displayStart: 0, displayEnd: 1920, startProgress: 0.6 })
    ];
    const renderer = new ScoreRenderer(settings),
        parts: { width: number; first: number; last: number; svg: string }[] = [];
    renderer.width = 1000;
    renderer.error.on(e => {
        throw e;
    });
    renderer.partialRenderFinished.on(e => {
        if (typeof e.renderResult === 'string') {
            parts.push({
                width: e.width,
                first: e.firstMasterBarIndex,
                last: e.lastMasterBarIndex,
                svg: e.renderResult
            });
        }
    });
    renderer.renderScore(score, [0]);
    renderer.destroy();
    const wedges = parts.flatMap(part => paths(part.svg).map(path => ({ part, path })));
    expect(wedges).toHaveLength(1);
    expect(wedges[0].part.first).toBeLessThanOrEqual(count - 1);
    expect(wedges[0].part.last).toBeGreaterThanOrEqual(count);
    for (const { part, path } of wedges) {
        for (let i = 0; i < path.length; i += 2) {
            expect(path[i]).toBeGreaterThanOrEqual(0);
            expect(path[i]).toBeLessThanOrEqual(part.width);
        }
    }
});

it('duplicate valid source identities do not link horizontal partial ownership', () => {
    const { score, settings } = load();
    settings.display.layoutMode = LayoutMode.Horizontal;
    settings.display.barCountPerPartial = 1;
    const bars = score.tracks[0].staves[0].bars;
    bars[0].sourceWedges = [mark({ sourceId: 'conflict', displayEnd: 3840, endProgress: 0.6 })];
    bars[1].sourceWedges = [
        mark({ sourceId: 'conflict', displayStart: 0, displayEnd: 1920, startProgress: 0.6 }),
        mark({ sourceId: 'conflict', displayStart: 0, displayEnd: 2880, startProgress: 0.6 })
    ];
    const renderer = new ScoreRenderer(settings),
        parts: { first: number; last: number }[] = [];
    renderer.width = 1000;
    renderer.error.on(e => {
        throw e;
    });
    renderer.partialRenderFinished.on(e => {
        if (e.firstMasterBarIndex >= 0) {
            parts.push({ first: e.firstMasterBarIndex, last: e.lastMasterBarIndex });
        }
    });
    renderer.renderScore(score, [0]);
    renderer.destroy();
    expect(parts).toEqual([
        { first: 0, last: 0 },
        { first: 1, last: 1 }
    ]);
});

it('keeps a joined span lane stable when its neighbor ends and a new span starts in the next bar', () => {
    const b = mark({ sourceId: 'b', displayStart: 0, displayEnd: 3840 });
    const a1 = mark({ sourceId: 'a', displayStart: 960, displayEnd: 3840, endProgress: 0.5 });
    const a2 = mark({ sourceId: 'a', displayStart: 0, displayEnd: 3840, startProgress: 0.5 });
    const c = mark({ sourceId: 'c', displayStart: 480, displayEnd: 3000 });
    const ink = paths(render([b, a1], [a2, c]));
    expect(ink).toHaveLength(3);
    const center = (p: number[]) => (p[1] + p[5]) / 2;
    expect(center(ink[0])).toBeCloseTo(center(ink[2]), 7);
    expect(center(ink[1])).not.toBeCloseTo(center(ink[2]), 7);
});
