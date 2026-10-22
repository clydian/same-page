import { NoteCloner } from '@coderline/alphatab/generated/model/NoteCloner';
import { NoteSerializer } from '@coderline/alphatab/generated/model/NoteSerializer';
import { MusicXmlImporter } from '@coderline/alphatab/importer/MusicXmlImporter';
import { ByteBuffer } from '@coderline/alphatab/io/ByteBuffer';
import { AlphaSynthMidiFileHandler } from '@coderline/alphatab/midi/AlphaSynthMidiFileHandler';
import { NoteOffEvent, NoteOnEvent } from '@coderline/alphatab/midi/MidiEvent';
import { MidiFile } from '@coderline/alphatab/midi/MidiFile';
import { MidiFileGenerator } from '@coderline/alphatab/midi/MidiFileGenerator';
import { JsonConverter } from '@coderline/alphatab/model/JsonConverter';
import { Note } from '@coderline/alphatab/model/Note';
import type { Score } from '@coderline/alphatab/model/Score';
import { Settings } from '@coderline/alphatab/Settings';
import { describe, expect, it } from 'vitest';

function load(kind: string, step: string | undefined, dynamic: string) {
    const xml = `<score-partwise version="4.0"><part-list><score-part id="P"><part-name>Owned mordent</part-name></score-part></part-list><part id="P"><measure number="1"><attributes><divisions>1</divisions><key><fifths>1</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><direction><direction-type><dynamics><${dynamic}/></dynamics></direction-type></direction><note><pitch><step>B</step><octave>4</octave></pitch><duration>2</duration><type>half</type>${kind ? `<notations><ornaments><${kind}${step === undefined ? '' : ` trill-step="${step}"`}/></ornaments></notations>` : ''}</note><note><rest/><duration>2</duration><type>half</type></note></measure></part></score-partwise>`;
    const importer = new MusicXmlImporter();
    importer.init(ByteBuffer.fromBuffer(new TextEncoder().encode(xml)), new Settings());
    return JsonConverter.jsObjectToScore(JsonConverter.scoreToJsObject(importer.readScore()));
}
function captureScore(score: Score) {
    const file = new MidiFile(),
        g = new MidiFileGenerator(score, new Settings(), new AlphaSynthMidiFileHandler(file));
    g.generate();
    const events = file.tracks.flatMap(t => t.events);
    return {
        on: events.filter((e): e is NoteOnEvent => e instanceof NoteOnEvent),
        off: events.filter((e): e is NoteOffEvent => e instanceof NoteOffEvent),
        bounds: g.tickLookup.masterBars.map(b => [b.start, b.end])
    };
}
function capture(kind: string, step: string | undefined, dynamic: string) {
    return captureScore(load(kind, step, dynamic));
}
describe('MusicXML mordent playback distance', () => {
    for (const kind of ['mordent', 'inverted-mordent']) {
        for (const dynamic of ['f', 'pp']) {
            for (const [step, semitones] of [
                [undefined, 2],
                ['whole', 2],
                ['half', 1],
                ['unison', 0]
            ] as const) {
                it(`${kind} ${step ?? 'default whole'} ${dynamic} survives Worker JSON and uses the source interval`, () => {
                    const c = capture(kind, step, dynamic),
                        plain = capture('', undefined, dynamic);
                    const aux = 71 + (kind === 'mordent' ? -semitones : semitones);
                    expect(c.on.map(e => e.noteKey)).toEqual([71, aux, 71]);
                    expect(c.on.map(e => e.noteVelocity)).toEqual(Array(3).fill((dynamic === 'f' ? 95 : 31) - 16));
                    expect(c.off[c.off.length - 1].tick).toBe(plain.off[plain.off.length - 1].tick);
                    expect(c.bounds).toEqual(plain.bounds);
                });
            }
        }
    }
    it('preserves zero, half and whole distances in generated clones', () => {
        for (const [word, step] of [
            ['unison', 0],
            ['half', 1],
            ['whole', 2]
        ] as const) {
            const n = load('mordent', word, 'f').tracks[0].staves[0].bars[0].voices[0].beats[0].notes[0];
            expect(NoteCloner.clone(n).mordentStep).toBe(step);
        }
    });
    it('keeps old JSON without a source distance on the legacy native ornament path', () => {
        const legacy = new Note();
        NoteSerializer.fromJson(legacy, new Map([['id', 0]]));
        expect(legacy.mordentStep).toBeNull();
        const score = load('mordent', 'whole', 'f');
        score.tracks[0].staves[0].bars[0].voices[0].beats[0].notes[0].mordentStep = null;
        const old = JsonConverter.jsonToScore(JsonConverter.scoreToJson(score));
        expect(captureScore(old).on.map(e => e.noteKey)).toEqual([71, 70, 71]);
    });
    it('does not invent a supported distance for unknown source tokens or invalid model values', () => {
        expect(capture('mordent', 'unknown', 'f').on.map(e => e.noteKey)).toEqual([71, 70, 71]);
        for (const value of [-1, 3, Number.NaN]) {
            const score = load('mordent', 'whole', 'f');
            score.tracks[0].staves[0].bars[0].voices[0].beats[0].notes[0].mordentStep = value;
            expect(captureScore(score).on.map(e => e.noteKey)).toEqual([71, 70, 71]);
        }
    });
});
