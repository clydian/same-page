import { ScoreLoader } from '@coderline/alphatab/importer/ScoreLoader';
import { AlphaSynthMidiFileHandler } from '@coderline/alphatab/midi/AlphaSynthMidiFileHandler';
import { MidiFile } from '@coderline/alphatab/midi/MidiFile';
import { MidiFileGenerator } from '@coderline/alphatab/midi/MidiFileGenerator';
import { NoteOnEvent, NoteOffEvent } from '@coderline/alphatab/midi/MidiEvent';
import { JsonConverter } from '@coderline/alphatab/model/JsonConverter';
import { Settings } from '@coderline/alphatab/Settings';
import { describe, expect, it } from 'vitest';

function note(duration: number, type: string, ties: string[], marks: number | null) {
    return `<note><pitch><step>C</step><octave>4</octave></pitch><duration>${duration}</duration>${ties.map(t => `<tie type="${t}"/>`).join('')}<type>${type}</type><notations>${ties.map(t => `<tied type="${t}"/>`).join('')}${marks === null ? '' : `<ornaments><tremolo type="single">${marks}</tremolo></ornaments>`}</notations></note>`;
}
function collect(secondMarks: number | null, firstTie = true) {
    const first = note(4, 'quarter', firstTie ? ['start'] : [], 2);
    const second = note(
        secondMarks === null ? 2 : 4,
        secondMarks === null ? 'eighth' : 'quarter',
        firstTie ? ['stop'] : [],
        secondMarks
    );
    const xml = `<score-partwise version="4.0"><part-list><score-part id="P"><part-name>Piano</part-name></score-part></part-list><part id="P"><measure number="1"><attributes><divisions>4</divisions><time><beats>1</beats><beat-type>4</beat-type></time></attributes><direction><direction-type><dynamics><mp/></dynamics></direction-type></direction>${first}</measure><measure number="2"><direction><direction-type><dynamics><f/></dynamics></direction-type></direction>${second}</measure></part></score-partwise>`;
    const settings = new Settings();
    const score = JsonConverter.jsObjectToScore(
        JsonConverter.scoreToJsObject(ScoreLoader.loadScoreFromBytes(new TextEncoder().encode(xml), settings))
    );
    const file = new MidiFile();
    const generator = new MidiFileGenerator(score, settings, new AlphaSynthMidiFileHandler(file));
    generator.applyTranspositionPitches = false;
    generator.generate();
    const events = file.tracks.flatMap(t => t.events);
    return {
        on: events
            .filter((e): e is NoteOnEvent => e instanceof NoteOnEvent)
            .map(e => [e.tick, e.noteKey, e.noteVelocity]),
        off: events.filter((e): e is NoteOffEvent => e instanceof NoteOffEvent).map(e => [e.tick, e.noteKey]),
        bounds: generator.tickLookup.masterBars.map(b => [b.start, b.end])
    };
}
describe('Measured single tremolo tie boundaries', () => {
    it('does not duplicate a roll over the next explicitly rolled beat, retaining its new dynamic', () => {
        const result = collect(2);
        expect(result.on).toEqual(Array.from({ length: 8 }, (_, i) => [i * 240, 60, i < 4 ? 63 : 95]));
        expect(result.off).toEqual(Array.from({ length: 8 }, (_, i) => [(i + 1) * 240, 60]));
    });
    it('retains the next rolled beat own one-stroke subdivision', () => {
        expect(collect(1).on).toEqual([
            [0, 60, 63],
            [240, 60, 63],
            [480, 60, 63],
            [720, 60, 63],
            [960, 60, 95],
            [1440, 60, 95]
        ]);
    });
    it('sustains only the last stroke into a tied unmarked eighth without a new attack', () => {
        const result = collect(null);
        expect(result.on).toEqual([
            [0, 60, 63],
            [240, 60, 63],
            [480, 60, 63],
            [720, 60, 63]
        ]);
        expect(result.off).toEqual([
            [240, 60],
            [480, 60],
            [720, 60],
            [1440, 60]
        ]);
    });
    it('keeps an untied final eighth a new explicit dynamic attack', () => {
        const result = collect(null, false);
        expect(result.on).toEqual([
            [0, 60, 63],
            [240, 60, 63],
            [480, 60, 63],
            [720, 60, 63],
            [960, 60, 95]
        ]);
    });
});
