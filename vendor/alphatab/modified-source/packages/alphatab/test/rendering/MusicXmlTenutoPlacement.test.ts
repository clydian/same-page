import { NoteCloner } from '@coderline/alphatab/generated/model/NoteCloner';
import { NoteSerializer } from '@coderline/alphatab/generated/model/NoteSerializer';
import { MusicXmlImporter } from '@coderline/alphatab/importer/MusicXmlImporter';
import { ByteBuffer } from '@coderline/alphatab/io/ByteBuffer';
import { LayoutMode } from '@coderline/alphatab/LayoutMode';
import { JsonConverter } from '@coderline/alphatab/model/JsonConverter';
import { MusicFontSymbol } from '@coderline/alphatab/model/MusicFontSymbol';
import { Note } from '@coderline/alphatab/model/Note';
import { CanvasHelper } from '@coderline/alphatab/platform/ICanvas';
import { ScoreRenderer } from '@coderline/alphatab/rendering/ScoreRenderer';
import { Settings } from '@coderline/alphatab/Settings';
import { StaveProfile } from '@coderline/alphatab/StaveProfile';
import { describe, expect, it, vi } from 'vitest';

function note(placement?: string, stem = 'up', chord = false, voice = 1, staff = 1, articulation = 'tenuto'): string {
    return `<note>${chord ? '<chord/>' : ''}<pitch><step>${chord ? 'E' : 'C'}</step><octave>5</octave></pitch><duration>2</duration><voice>${voice}</voice><type>half</type><stem>${stem}</stem><staff>${staff}</staff><notations><articulations><${articulation}${placement ? ` placement="${placement}"` : ''}/></articulations></notations></note>`;
}
function source(placement?: string, stem = 'up', extra = '', staves = 1, articulation = 'tenuto'): string {
    return `<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>2</beats><beat-type>4</beat-type></time>${staves > 1 ? '<staves>2</staves>' : ''}<clef number="1"><sign>G</sign><line>2</line></clef>${staves > 1 ? '<clef number="2"><sign>G</sign><line>2</line></clef>' : ''}</attributes>${note(placement, stem, false, 1, 1, articulation)}${extra}</measure></part></score-partwise>`;
}
function load(xml: string, settings = new Settings()) {
    const importer = new MusicXmlImporter();
    importer.init(ByteBuffer.fromBuffer(new TextEncoder().encode(xml)), settings);
    return importer.readScore();
}
function render(xml: string, throughJson = false, horizontal = false) {
    const settings = new Settings();
    settings.core.engine = 'svg';
    settings.core.enableLazyLoading = false;
    settings.display.staveProfile = StaveProfile.Score;
    settings.display.layoutMode = horizontal ? LayoutMode.Horizontal : LayoutMode.Page;
    let score = load(xml, settings);
    if (throughJson) {
        score = JsonConverter.jsObjectToScore(JsonConverter.scoreToJsObject(score));
    }
    const renderer = new ScoreRenderer(settings),
        svg: string[] = [];
    renderer.width = 600;
    const symbols: MusicFontSymbol[] = [];
    const original = CanvasHelper.fillMusicFontSymbolSafe;
    const spy = vi.spyOn(CanvasHelper, 'fillMusicFontSymbolSafe').mockImplementation((...args) => {
        symbols.push(args[4]);
        return original(...args);
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
    const text = svg.join('');
    return {
        svg: text,
        above: symbols.filter(s => s === MusicFontSymbol.ArticTenutoAbove).length,
        below: symbols.filter(s => s === MusicFontSymbol.ArticTenutoBelow).length
    };
}
function first(xml: string) {
    return load(xml).tracks[0].staves[0].bars[0].voices[0].beats[0].notes[0];
}

describe('MusicXML explicit tenuto placement', () => {
    it('retains above and below in the public note model', () => {
        expect(Reflect.get(first(source('above')), 'tenutoPlacement')).toBe(1);
        expect(Reflect.get(first(source('below')), 'tenutoPlacement')).toBe(2);
    });
    for (const stem of ['up', 'down']) {
        for (const horizontal of [false, true]) {
            it(`uses the requested side with ${stem} stems in ${horizontal ? 'Horizontal' : 'Page'}`, () => {
                const above = render(source('above', stem), true, horizontal);
                const below = render(source('below', stem), true, horizontal);
                expect([above.above, above.below]).toEqual([1, 0]);
                expect([below.above, below.below]).toEqual([0, 1]);
                expect(above.svg).not.toEqual(below.svg);
            });
        }
    }
    it('preserves generated note clones, Worker JSON and old missing-field defaults', () => {
        const origin = first(source('above'));
        expect(Reflect.get(NoteCloner.clone(origin), 'tenutoPlacement')).toBe(1);
        const copy = JsonConverter.jsObjectToScore(JsonConverter.scoreToJsObject(load(source('below'))));
        expect(Reflect.get(copy.tracks[0].staves[0].bars[0].voices[0].beats[0].notes[0], 'tenutoPlacement')).toBe(2);
        expect(render(source('above'), true)).toEqual(render(source('above')));
        const legacy = new Note();
        NoteSerializer.fromJson(legacy, new Map([['id', 0]]));
        expect(Reflect.get(legacy, 'tenutoPlacement')).toBe(0);
    });
    it('keeps automatic and unknown placements on the old stem-dependent side', () => {
        expect([render(source()).above, render(source()).below]).toEqual([0, 1]);
        expect([render(source(undefined, 'down')).above, render(source(undefined, 'down')).below]).toEqual([1, 0]);
        expect(render(source('unknown'))).toEqual(render(source()));
    });
    it('retains independent explicit sides in simultaneous voices', () => {
        const result = render(
            source('above', 'up', `<backup><duration>2</duration></backup>${note('below', 'down', false, 2)}`),
            true
        );
        expect([result.above, result.below]).toEqual([1, 1]);
    });
    it('retains independent sides in a chord and deduplicates one symbol on the same side', () => {
        const both = render(source('above', 'up', note('below', 'up', true)), true);
        expect([both.above, both.below]).toEqual([1, 1]);
        const same = render(source('above', 'up', note('above', 'up', true)), true);
        expect([same.above, same.below]).toEqual([1, 0]);
    });
    it('keeps separate staff scopes', () => {
        const result = render(
            source('above', 'up', `<backup><duration>2</duration></backup>${note('below', 'up', false, 1, 2)}`, 2),
            true
        );
        expect([result.above, result.below]).toEqual([1, 1]);
    });
    it('keeps separate part scopes', () => {
        const second = source('below', 'down')
            .match(/<part id="P1">[\s\S]*<\/part>/)![0]
            .replace('id="P1"', 'id="P2"');
        const xml = source('above')
            .replace('</part-list>', '<score-part id="P2"><part-name>Second</part-name></score-part></part-list>')
            .replace('</score-partwise>', `${second}</score-partwise>`);
        const score = JsonConverter.jsObjectToScore(JsonConverter.scoreToJsObject(load(xml)));
        expect(score.tracks.map(t => t.staves[0].bars[0].voices[0].beats[0].notes[0].tenutoPlacement)).toEqual([1, 2]);
    });
    it('keeps other articulations automatic and leaves phrase-slur placement unset', () => {
        expect(render(source('above', 'up', '', 1, 'accent'))).toEqual(
            render(source(undefined, 'up', '', 1, 'accent'))
        );
        expect(Reflect.get(first(source('above')), 'slurPlacement')).toBe(0);
    });
});
