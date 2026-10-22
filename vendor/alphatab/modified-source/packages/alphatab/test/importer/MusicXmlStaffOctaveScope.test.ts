import { MusicXmlImporter } from '@coderline/alphatab/importer/MusicXmlImporter';
import { ByteBuffer } from '@coderline/alphatab/io/ByteBuffer';
import { LayoutMode } from '@coderline/alphatab/LayoutMode';
import { JsonConverter } from '@coderline/alphatab/model/JsonConverter';
import { Ottavia } from '@coderline/alphatab/model/Ottavia';
import { ScoreRenderer } from '@coderline/alphatab/rendering/ScoreRenderer';
import { Settings } from '@coderline/alphatab/Settings';
import { StaveProfile } from '@coderline/alphatab/StaveProfile';
import { describe, expect, it } from 'vitest';

const source =
    '<?xml version=\'1.0\' encoding=\'UTF-8\'?>\n<score-partwise version="4.0"><part-list><score-part id="P"><part-name>Owned staff-scope</part-name></score-part></part-list><part id="P"><measure number="1"><attributes><divisions>4</divisions><key><fifths>0</fifths></key><time><beats>3</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>G</sign><line>2</line></clef></attributes><direction placement="above"><direction-type><octave-shift type="down" size="8" number="1"/></direction-type><staff>1</staff></direction><note><pitch><step>C</step><octave>6</octave></pitch><duration>12</duration><voice>1</voice><type>half</type><dot/><stem>up</stem><staff>1</staff></note><backup><duration>12</duration></backup><note><pitch><step>C</step><octave>4</octave></pitch><duration>12</duration><voice>2</voice><type>half</type><dot/><stem>up</stem><staff>2</staff></note></measure><measure number="2"><direction placement="above"><direction-type><octave-shift type="stop" size="8" number="1"/></direction-type><staff>1</staff></direction><note><pitch><step>C</step><octave>5</octave></pitch><duration>12</duration><voice>1</voice><type>half</type><dot/><stem>up</stem><staff>1</staff></note><backup><duration>12</duration></backup><note><pitch><step>C</step><octave>4</octave></pitch><duration>12</duration><voice>2</voice><type>half</type><dot/><stem>up</stem><staff>2</staff></note></measure></part></score-partwise>';
function load(xml: string) {
    const i = new MusicXmlImporter();
    i.init(ByteBuffer.fromBuffer(new TextEncoder().encode(xml)), new Settings());
    return JsonConverter.jsObjectToScore(JsonConverter.scoreToJsObject(i.readScore()));
}
function values(xml: string) {
    return load(xml).tracks.map(t =>
        t.staves.map(s =>
            s.bars.map(b =>
                b.voices.flatMap(v =>
                    v.beats
                        .filter(be => be.notes.length)
                        .map(be => ({
                            ottava: be.ottava,
                            keys: be.notes.map(n => n.realValue),
                            display: be.notes.map(n => n.displayValue)
                        }))
                )
            )
        )
    );
}
function lowerStaffGeometry(xml: string, layout: LayoutMode) {
    const settings = new Settings();
    settings.core.engine = 'svg';
    settings.core.enableLazyLoading = false;
    settings.core.includeNoteBounds = true;
    settings.display.staveProfile = StaveProfile.Score;
    settings.display.layoutMode = layout;
    const score = load(xml),
        renderer = new ScoreRenderer(settings),
        svg: string[] = [];
    renderer.width = 1000;
    renderer.error.on(error => {
        throw error;
    });
    renderer.partialRenderFinished.on(event => {
        if (typeof event.renderResult === 'string') {
            svg.push(event.renderResult);
        }
    });
    try {
        renderer.renderScore(score, [0]);
        expect(svg.length).toBeGreaterThan(0);
        const beat = score.tracks[0].staves[1].bars[0].voices.flatMap(v => v.beats).find(b => b.notes.length)!;
        const bounds = renderer.boundsLookup!.findBeat(beat)!;
        expect(bounds.notes!.length).toBe(1);
        const head = bounds.notes![0].noteHeadBounds;
        return { y: head.y - bounds.barBounds.realBounds.y, h: head.h };
    } finally {
        renderer.destroy();
    }
}
describe('MusicXML octave shift staff scope', () => {
    it('keeps staff2 regular when only staff1 starts and stops an octave line, through Worker JSON', () => {
        const rows = values(source)[0];
        expect(rows[0][0][0]).toEqual({ ottava: Ottavia._8va, keys: [84], display: [72] });
        expect(rows[1][0][0]).toEqual({ ottava: Ottavia.Regular, keys: [60], display: [60] });
        expect(rows[0][1][0]).toEqual({ ottava: Ottavia.Regular, keys: [72], display: [72] });
        expect(rows[1][1][0]).toEqual({ ottava: Ottavia.Regular, keys: [60], display: [60] });
    });
    it('maintains independent simultaneous octave shifts and stopping one staff leaves the other active', () => {
        const second =
            '<direction><direction-type><octave-shift type="up" size="15"/></direction-type><staff>2</staff></direction>';
        const xml = source.replace('<note>', second + '<note>');
        const rows = values(xml)[0];
        expect(rows[0][0][0].ottava).toBe(Ottavia._8va);
        expect(rows[1][0][0]).toEqual({ ottava: Ottavia._15mb, keys: [60], display: [84] });
        expect(rows[0][1][0].ottava).toBe(Ottavia.Regular);
        expect(rows[1][1][0].ottava).toBe(Ottavia._15mb);
    });
    it('continues the addressed staff state instead of a different staff state', () => {
        const second =
            '<direction><direction-type><octave-shift type="up" size="15"/></direction-type><staff>2</staff></direction>';
        const xml = source.replace('<note>', second + '<note>').replace('type="stop"', 'type="continue"');
        const rows = values(xml)[0];
        expect(rows[0][1][0].ottava).toBe(Ottavia._8va);
        expect(rows[1][1][0].ottava).toBe(Ottavia._15mb);
    });
    it('does not carry an unclosed octave shift into the next part with the same staff numbers', () => {
        const first = source.replace('type="stop"', 'type="continue"');
        const second = source
            .match(/<part id="P">[\s\S]*<\/part>/)![0]
            .replace('id="P"', 'id="Q"')
            .replace(/<direction[\s\S]*?<\/direction>/g, '');
        const xml = first
            .replace('</part-list>', '<score-part id="Q"><part-name>Second part</part-name></score-part></part-list>')
            .replace('</score-partwise>', second + '</score-partwise>');
        expect(values(xml)[1][0][0][0].ottava).toBe(Ottavia.Regular);
        expect(values(xml)[1][1][0][0].ottava).toBe(Ottavia.Regular);
    });
    for (const layout of [LayoutMode.Page, LayoutMode.Horizontal]) {
        it(`keeps the actual lower-staff notehead at the control staff position in ${LayoutMode[layout]}`, () => {
            const control = source.replace(/<direction[\s\S]*?<\/direction>/g, '');
            expect(lowerStaffGeometry(source, layout)).toEqual(lowerStaffGeometry(control, layout));
        });
    }
});
