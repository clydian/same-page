import { MusicXmlImporter } from '@coderline/alphatab/importer/MusicXmlImporter';
import { ByteBuffer } from '@coderline/alphatab/io/ByteBuffer';
import { LayoutMode } from '@coderline/alphatab/LayoutMode';
import { AlphaSynthMidiFileHandler } from '@coderline/alphatab/midi/AlphaSynthMidiFileHandler';
import { MidiFile } from '@coderline/alphatab/midi/MidiFile';
import { MidiFileGenerator } from '@coderline/alphatab/midi/MidiFileGenerator';
import { JsonConverter } from '@coderline/alphatab/model/JsonConverter';
import type { Note } from '@coderline/alphatab/model/Note';
import type { Score } from '@coderline/alphatab/model/Score';
import { ScoreRenderer } from '@coderline/alphatab/rendering/ScoreRenderer';
import { Settings } from '@coderline/alphatab/Settings';
import { StaveProfile } from '@coderline/alphatab/StaveProfile';
import { describe, expect, it } from 'vitest';

const rest = (voice: number, duration: number, type: string) =>
    `<note><rest/><duration>${duration}</duration><voice>${voice}</voice><type>${type}</type>${duration === 3 ? '<dot/>' : ''}</note>`;
const note = (voice: number, type: 'start' | 'stop', id: string, pitch = 'F', duration = type === 'start' ? 1 : 2) =>
    `<note><pitch><step>${pitch}</step><octave>4</octave></pitch><duration>${duration}</duration><tie type="${type}"/><voice>${voice}</voice><type>${duration === 1 ? 'eighth' : 'quarter'}</type><notations><tied type="${type}"${id ? ` number="${id}"` : ''}/></notations></note>`;
const backup = '<backup><duration>8</duration></backup>';
function measure(id: string, order = false, startPitch = 'F', stopPitch = 'F') {
    const upper = rest(1, 4, 'half') + note(1, 'stop', id, stopPitch) + rest(1, 2, 'quarter');
    const lower = rest(2, 3, 'quarter') + note(2, 'start', id, startPitch) + rest(2, 4, 'half');
    return order ? lower + backup + upper : upper + backup + lower;
}
function document(measures: string[]) {
    return `<score-partwise version="4.0"><part-list><score-part id="P"><part-name>Piano</part-name></score-part></part-list><part id="P">${measures.map((m, i) => `<measure number="${i + 1}">${i === 0 ? '<attributes><divisions>2</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>' : ''}${m}</measure>`).join('')}</part></score-partwise>`;
}
function load(xml: string) {
    const settings = new Settings();
    const importer = new MusicXmlImporter();
    importer.init(ByteBuffer.fromBuffer(new TextEncoder().encode(xml)), settings);
    return { score: importer.readScore(), settings };
}
function notes(score: Score): Note[] {
    return score.tracks.flatMap(t =>
        t.staves.flatMap(s => s.bars.flatMap(b => b.voices.flatMap(v => v.beats.flatMap(b => b.notes))))
    );
}
function events(score: Score, settings: Settings) {
    const midi = new MidiFile();
    const generator = new MidiFileGenerator(score, settings, new AlphaSynthMidiFileHandler(midi));
    generator.applyTranspositionPitches = false;
    generator.generate();
    return midi.tracks
        .flatMap(t => t.events)
        .filter(e => e.constructor.name === 'NoteOnEvent' || e.constructor.name === 'NoteOffEvent')
        .map(e => ({ type: e.constructor.name, tick: e.tick }));
}
const expected = [
    { type: 'NoteOnEvent', tick: 1440 },
    { type: 'NoteOffEvent', tick: 2880 },
    { type: 'NoteOnEvent', tick: 5280 },
    { type: 'NoteOffEvent', tick: 6720 }
];
function expectLocalTies(score: Score) {
    const pitched = notes(score);
    for (const n of pitched.filter(n => n.beat.voice.index === 0)) {
        expect(n.isTieDestination).toBe(true);
        expect(n.tieOrigin?.beat.voice.index).toBe(1);
        expect(n.tieOrigin?.beat.voice.bar.index).toBe(n.beat.voice.bar.index);
        expect(n.tieOrigin?.beat.displayEnd).toBe(n.beat.displayStart);
    }
}

describe('MusicXML stop-before-start ties', () => {
    it('resolves two repeated cross-voice chains by music time, not XML encounter order', () => {
        const { score, settings } = load(document([measure('7'), measure('7')]));
        expectLocalTies(score);
        expect(events(score, settings)).toEqual(expected);
    });
    it('keeps the equivalent start-first serialization unchanged', () => {
        const { score, settings } = load(document([measure('7', true), measure('7', true)]));
        expectLocalTies(score);
        expect(events(score, settings)).toEqual(expected);
    });
    it('does not require unique IDs for successive bars, and also handles distinct IDs', () => {
        const { score, settings } = load(document([measure('7'), measure('8')]));
        expectLocalTies(score);
        expect(events(score, settings)).toEqual(expected);
    });
    it('can resolve unnumbered adjacent reverse endpoints when unambiguous', () => {
        const { score, settings } = load(document([measure(''), measure('')]));
        expectLocalTies(score);
        expect(events(score, settings)).toEqual(expected);
    });
    it('retains resolved endpoints through public Worker JSON', () => {
        const { score, settings } = load(document([measure('7'), measure('7')]));
        const cloned = JsonConverter.jsObjectToScore(JsonConverter.scoreToJsObject(score));
        expectLocalTies(cloned);
        expect(events(cloned, settings)).toEqual(expected);
    });
    it('keeps old same-voice JSON without explicit linked IDs compatible', () => {
        const chain = rest(1, 3, 'quarter') + note(1, 'start', '7') + note(1, 'stop', '7') + rest(1, 2, 'quarter');
        const { score, settings } = load(document([chain, chain]));
        const oldJson: unknown = JSON.parse(JsonConverter.scoreToJson(score), (key, value) =>
            key === 'tieoriginnoteid' || key === 'tiedestinationnoteid' ? undefined : value
        );
        const cloned = JsonConverter.jsObjectToScore(oldJson);
        expect(events(cloned, settings)).toEqual(expected);
    });
    it('treats an omitted number as the default 1 for a reverse pair', () => {
        const source = document([measure('1'), measure('1')]).replaceAll('type="start" number="1"', 'type="start"');
        const { score, settings } = load(source);
        expectLocalTies(score);
        expect(events(score, settings)).toEqual(expected);
    });
    for (const mode of [LayoutMode.Page, LayoutMode.Horizontal]) {
        it(`renders identical complete source ties for both serialization orders in layout ${mode}`, () => {
            const render = (source: string) => {
                const { score, settings } = load(source);
                settings.core.engine = 'svg';
                settings.core.enableLazyLoading = false;
                settings.display.layoutMode = mode;
                settings.display.staveProfile = StaveProfile.Score;
                const renderer = new ScoreRenderer(settings),
                    surfaces: string[] = [];
                renderer.width = 1000;
                renderer.error.on(error => {
                    throw error;
                });
                renderer.partialRenderFinished.on(event => {
                    if (typeof event.renderResult === 'string') {
                        surfaces.push(event.renderResult);
                    }
                });
                renderer.renderScore(score, [0]);
                renderer.destroy();
                expect(surfaces.length).toBeGreaterThan(0);
                // Beat IDs follow XML encounter order; preserve every geometry,
                // glyph and source tie while removing only these incidental IDs.
                return surfaces.map(svg => svg.replace(/class="b\d+"/g, 'class="beat"'));
            };
            expect(render(document([measure('7'), measure('7')]))).toEqual(
                render(document([measure('7', true), measure('7', true)]))
            );
        });
    }
    it('does not join reverse endpoints of different pitch', () => {
        const { score } = load(document([measure('7', false, 'F', 'G')]));
        expect(notes(score).every(n => !n.isTieDestination)).toBe(true);
    });
    it('does not infer pitched reverse endpoints for unpitched percussion', () => {
        const source = document([measure('7')]).replaceAll(
            '<pitch><step>F</step><octave>4</octave></pitch>',
            '<unpitched><display-step>F</display-step><display-octave>4</display-octave></unpitched>'
        );
        const { score } = load(source);
        expect(notes(score).every(n => n.isPercussion && !n.isTieDestination)).toBe(true);
    });
    it('does not bridge a gap between otherwise matching reverse endpoints', () => {
        const upper = rest(1, 4, 'half') + rest(1, 1, 'eighth') + note(1, 'stop', '7') + rest(1, 1, 'eighth');
        const lower = rest(2, 3, 'quarter') + note(2, 'start', '7') + rest(2, 4, 'half');
        const { score } = load(document([upper + backup + lower]));
        expect(notes(score).every(n => !n.isTieDestination)).toBe(true);
    });
    it('does not pick between two possible reverse origins', () => {
        const upper = rest(1, 4, 'half') + note(1, 'stop', '7') + rest(1, 2, 'quarter');
        const lower = (v: number) => rest(v, 3, 'quarter') + note(v, 'start', '7') + rest(v, 4, 'half');
        const { score } = load(document([upper + backup + lower(2) + backup + lower(3)]));
        expect(notes(score).every(n => !n.isTieDestination)).toBe(true);
    });
    it('does not attach one reverse origin to multiple destinations', () => {
        const upper = (v: number) => rest(v, 4, 'half') + note(v, 'stop', '7') + rest(v, 2, 'quarter');
        const lower = rest(2, 3, 'quarter') + note(2, 'start', '7') + rest(2, 4, 'half');
        const { score } = load(document([upper(1) + backup + upper(3) + backup + lower]));
        expect(notes(score).every(n => !n.isTieDestination)).toBe(true);
    });
    it('preserves normal same-voice forward chains and reused numbers', () => {
        const chain = rest(1, 3, 'quarter') + note(1, 'start', '7') + note(1, 'stop', '7') + rest(1, 2, 'quarter');
        const { score, settings } = load(document([chain, chain]));
        expect(events(score, settings)).toEqual(expected);
    });
});
