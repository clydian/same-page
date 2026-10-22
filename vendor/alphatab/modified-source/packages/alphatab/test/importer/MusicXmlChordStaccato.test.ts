import { BeatCloner } from '@coderline/alphatab/generated/model/BeatCloner';
import { BeatSerializer } from '@coderline/alphatab/generated/model/BeatSerializer';
import { MusicXmlImporter } from '@coderline/alphatab/importer/MusicXmlImporter';
import { ByteBuffer } from '@coderline/alphatab/io/ByteBuffer';
import { AlphaSynthMidiFileHandler } from '@coderline/alphatab/midi/AlphaSynthMidiFileHandler';
import { NoteOffEvent, NoteOnEvent } from '@coderline/alphatab/midi/MidiEvent';
import { MidiFile } from '@coderline/alphatab/midi/MidiFile';
import { MidiFileGenerator } from '@coderline/alphatab/midi/MidiFileGenerator';
import { Beat } from '@coderline/alphatab/model/Beat';
import { JsonConverter } from '@coderline/alphatab/model/JsonConverter';
import { ScoreRenderer } from '@coderline/alphatab/rendering/ScoreRenderer';
import { Settings } from '@coderline/alphatab/Settings';
import { StaveProfile } from '@coderline/alphatab/StaveProfile';
import { describe, expect, it } from 'vitest';

function capture(articulation: string, noteIndex = 0, secondVoice = false, legacy = false, noteCount = 3) {
    const notes = ['C', 'E', 'G']
        .slice(0, noteCount)
        .map(
            (step, i) =>
                `<note>${i ? '<chord/>' : ''}<pitch><step>${step}</step><octave>5</octave></pitch><duration>1</duration><type>quarter</type>${i === noteIndex && articulation ? `<notations><articulations>${articulation}</articulations></notations>` : ''}</note>`
        )
        .join('');
    const xml = `<score-partwise version="4.0"><part-list><score-part id="P"><part-name>Owned chord</part-name></score-part></part-list><part id="P"><measure number="1"><attributes><divisions>1</divisions><time><beats>1</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>${notes}${secondVoice ? '<backup><duration>1</duration></backup><note><pitch><step>F</step><octave>4</octave></pitch><duration>1</duration><voice>2</voice><type>quarter</type></note>' : ''}</measure></part></score-partwise>`;
    const importer = new MusicXmlImporter();
    importer.init(ByteBuffer.fromBuffer(new TextEncoder().encode(xml)), new Settings());
    const score = JsonConverter.jsonToScore(JsonConverter.scoreToJson(importer.readScore()));
    const beat = score.tracks[0].staves[0].bars[0].voices[0].beats[0];
    if (legacy) {
        beat.sourceChordStaccato = false;
    }
    const file = new MidiFile(),
        generator = new MidiFileGenerator(score, new Settings(), new AlphaSynthMidiFileHandler(file));
    generator.generate();
    const events = file.tracks.flatMap(t => t.events);
    return {
        score,
        beat,
        on: events.filter((e): e is NoteOnEvent => e instanceof NoteOnEvent).map(e => [e.tick, e.noteKey]),
        off: events.filter((e): e is NoteOffEvent => e instanceof NoteOffEvent).map(e => [e.tick, e.noteKey]),
        notes: score.tracks[0].staves[0].bars[0].voices[0].beats[0].notes,
        bounds: generator.tickLookup.masterBars.map(b => [b.start, b.end])
    };
}

describe('MusicXML principal staccato has a shared chord playback scope', () => {
    for (const articulation of ['<staccato/>', '<tenuto/><staccato/>']) {
        it(`shortens every chord member while retaining one visible ${articulation}`, () => {
            const actual = capture(articulation),
                plain = capture('');
            expect(actual.on).toEqual(plain.on);
            expect(actual.off).toEqual([
                [480, 72],
                [480, 76],
                [480, 79]
            ]);
            expect(actual.notes.map(n => n.isStaccato)).toEqual([true, false, false]);
            expect(actual.bounds).toEqual(plain.bounds);
        });
    }
    it('leaves a single note on the original note-specific path', () => {
        const actual = capture('<staccato/>', 0, false, false, 1);
        expect(actual.beat.sourceChordStaccato).toBe(false);
        expect(actual.off).toEqual([[480, 72]]);
    });
    it('keeps an unmarked chord unchanged', () => {
        expect(capture('').off).toEqual([
            [960, 72],
            [960, 76],
            [960, 79]
        ]);
    });
    it('keeps a secondary-note-only staccato local', () => {
        const actual = capture('<staccato/>', 1);
        expect(actual.beat.sourceChordStaccato).toBe(false);
        expect(actual.off).toEqual([
            [480, 76],
            [960, 72],
            [960, 79]
        ]);
    });
    it('does not shorten the simultaneous independent voice', () => {
        const actual = capture('<staccato/>', 0, true);
        expect(actual.off).toEqual([
            [480, 72],
            [480, 76],
            [480, 79],
            [960, 65]
        ]);
    });
    it('keeps old model and JSON on the note-specific legacy path', () => {
        const beat = new Beat();
        BeatSerializer.fromJson(beat, new Map([['id', 0]]));
        expect(beat.sourceChordStaccato).toBe(false);
        expect(capture('<staccato/>', 0, false, true).off).toEqual([
            [480, 72],
            [960, 76],
            [960, 79]
        ]);
    });
    it('preserves the imported playback scope in generated clones', () => {
        expect(BeatCloner.clone(capture('<staccato/>').beat).sourceChordStaccato).toBe(true);
        expect(BeatCloner.clone(capture('').beat).sourceChordStaccato).toBe(false);
    });
    it('still draws one staccato glyph for the source chord', () => {
        const { score } = capture('<staccato/>');
        const settings = new Settings();
        settings.core.engine = 'svg';
        settings.core.enableLazyLoading = false;
        settings.display.staveProfile = StaveProfile.Score;
        const renderer = new ScoreRenderer(settings);
        renderer.width = 1000;
        const pieces: string[] = [];
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
        const svg = pieces
            .join('')
            .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(Number.parseInt(h, 16)))
            .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
        expect((svg.match(/[\uE4A2\uE4A3]/g) ?? []).length).toBe(1);
    });
    it('preserves an explicit secondary tie chain while shortening untied chord members', () => {
        const note = (step: string, chord: boolean, extra: string) =>
            `<note>${chord ? '<chord/>' : ''}<pitch><step>${step}</step><octave>5</octave></pitch><duration>1</duration><type>quarter</type>${extra}</note>`;
        const xml = `<score-partwise version="4.0"><part-list><score-part id="P"><part-name>Owned ties</part-name></score-part></part-list><part id="P"><measure number="1"><attributes><divisions>1</divisions><time><beats>1</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>${note('C', false, '<notations><articulations><staccato/></articulations></notations>')}${note('E', true, '<notations><tied type="start"/></notations>')}</measure><measure number="2">${note('E', false, '<notations><tied type="stop"/></notations>')}</measure></part></score-partwise>`;
        const importer = new MusicXmlImporter();
        importer.init(ByteBuffer.fromBuffer(new TextEncoder().encode(xml)), new Settings());
        const score = JsonConverter.jsonToScore(JsonConverter.scoreToJson(importer.readScore()));
        const file = new MidiFile(),
            generator = new MidiFileGenerator(score, new Settings(), new AlphaSynthMidiFileHandler(file));
        generator.generate();
        const events = file.tracks.flatMap(t => t.events);
        expect(events.filter((e): e is NoteOnEvent => e instanceof NoteOnEvent).map(e => [e.tick, e.noteKey])).toEqual([
            [0, 72],
            [0, 76]
        ]);
        expect(
            events.filter((e): e is NoteOffEvent => e instanceof NoteOffEvent).map(e => [e.tick, e.noteKey])
        ).toEqual([
            [480, 72],
            [1920, 76]
        ]);
        expect(generator.tickLookup.masterBars.map(b => [b.start, b.end])).toEqual([
            [0, 960],
            [960, 1920]
        ]);
    });
});
