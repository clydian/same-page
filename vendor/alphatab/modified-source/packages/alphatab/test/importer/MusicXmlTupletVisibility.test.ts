import { MusicXmlImporter } from '@coderline/alphatab/importer/MusicXmlImporter';
import { ByteBuffer } from '@coderline/alphatab/io/ByteBuffer';
import { AlphaSynthMidiFileHandler } from '@coderline/alphatab/midi/AlphaSynthMidiFileHandler';
import { MidiFile } from '@coderline/alphatab/midi/MidiFile';
import { MidiFileGenerator } from '@coderline/alphatab/midi/MidiFileGenerator';
import { JsonConverter } from '@coderline/alphatab/model/JsonConverter';
import { ScoreRenderer } from '@coderline/alphatab/rendering/ScoreRenderer';
import { Settings } from '@coderline/alphatab/Settings';
import { describe, expect, it } from 'vitest';

function source(number: string, bracket: string) {
    const notes = ['C', 'D', 'E']
        .map(
            (step, i) =>
                `<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>2</duration><type>quarter</type><time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>${i === 0 ? `<notations><tuplet type="start"${number ? ` show-number="${number}"` : ''}${bracket ? ` bracket="${bracket}"` : ''}/></notations>` : i === 2 ? '<notations><tuplet type="stop"/></notations>' : ''}</note>`
        )
        .join('');
    return `<score-partwise version="4.0"><part-list><score-part id="P"><part-name>Owned tuplets</part-name></score-part></part-list><part id="P"><measure number="1"><attributes><divisions>3</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>${notes}<note><rest/><duration>6</duration><type>half</type></note></measure></part></score-partwise>`;
}
function capture(number: string, bracket: string, xml = source(number, bracket)) {
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
        svg: pieces.join(''),
        events: file.tracks.flatMap(t => t.events).map(e => JSON.parse(JSON.stringify(e))),
        bounds: generator.tickLookup.masterBars.map(b => [b.start, b.end])
    };
}
const hasThree = (svg: string) => /&#(?:59523|x[eE]883);/.test(svg);
const bracketCount = (svg: string) => (svg.match(/<path /g) ?? []).length;
describe('MusicXML explicit tuplet display independent of timing', () => {
    it('hides both number and bracket after public Worker JSON without changing MIDI', () => {
        const hidden = capture('none', 'no'),
            visible = capture('actual', 'yes');
        expect(hasThree(visible.svg)).toBe(true);
        expect(bracketCount(visible.svg)).toBe(1);
        expect(hasThree(hidden.svg)).toBe(false);
        expect(bracketCount(hidden.svg)).toBe(0);
        expect(hidden.events).toEqual(visible.events);
        expect(hidden.bounds).toEqual(visible.bounds);
    });
    it('hides the bracket while retaining the number', () => {
        const c = capture('actual', 'no');
        expect(hasThree(c.svg)).toBe(true);
        expect(bracketCount(c.svg)).toBe(0);
    });
    it('retains a continuous bracket while hiding its number', () => {
        const c = capture('none', 'yes');
        expect(hasThree(c.svg)).toBe(false);
        expect(bracketCount(c.svg)).toBe(1);
    });
    it('preserves ordinary tuplets when display declarations are absent', () => {
        const c = capture('', '');
        expect(hasThree(c.svg)).toBe(true);
        expect(bracketCount(c.svg)).toBe(1);
    });
    it('honors both as an explicit ratio and actual as the numerator alone', () => {
        expect(capture('both', 'no').svg).toContain('&#59530;');
        expect(capture('both', 'no').svg).toContain('&#59522;');
        expect(capture('actual', 'no').svg).not.toContain('&#59530;');
    });
    it('does not let a hidden group suppress the following ordinary group', () => {
        const second = source('', '').match(/<measure number="1">(.*)<\/measure>/)![1];
        const xml = source('none', 'no').replace('</part>', `<measure number="2">${second}</measure></part>`);
        const c = capture('none', 'no', xml);
        expect((c.svg.match(/&#59523;/g) ?? []).length).toBe(1);
        expect(bracketCount(c.svg)).toBe(1);
    });
    it('ignores unknown display attribute values without changing ordinary tuplets', () => {
        const c = capture('invalid', 'invalid');
        expect(hasThree(c.svg)).toBe(true);
        expect(bracketCount(c.svg)).toBe(1);
        expect(c.events).toEqual(capture('', '').events);
    });
});
