import { ScoreLoader } from '@coderline/alphatab/importer/ScoreLoader';
import { AlphaSynthMidiFileHandler } from '@coderline/alphatab/midi/AlphaSynthMidiFileHandler';
import { MidiFile } from '@coderline/alphatab/midi/MidiFile';
import { MidiFileGenerator } from '@coderline/alphatab/midi/MidiFileGenerator';
import { JsonConverter } from '@coderline/alphatab/model/JsonConverter';
import { Settings } from '@coderline/alphatab/Settings';
import { describe, expect, it } from 'vitest';

function source(type: string, duration: number, dots = '', tuplet = '') {
    return `<score-partwise version="4.0"><part-list><score-part id="P"><part-name>Piano</part-name></score-part></part-list><part id="P"><measure number="1"><attributes><divisions>12</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>${duration}</duration><type>${type}</type>${dots}${tuplet}<notations><ornaments><tremolo type="single">2</tremolo></ornaments></notations></note></measure></part></score-partwise>`;
}
function collect(xml: string) {
    const settings = new Settings();
    const score = JsonConverter.jsObjectToScore(
        JsonConverter.scoreToJsObject(ScoreLoader.loadScoreFromBytes(new TextEncoder().encode(xml), settings))
    );
    const file = new MidiFile();
    const generator = new MidiFileGenerator(score, settings, new AlphaSynthMidiFileHandler(file));
    generator.applyTranspositionPitches = false;
    generator.generate();
    return file.tracks
        .flatMap(t => t.events)
        .filter(e => e.constructor.name === 'NoteOnEvent')
        .map(e => e.tick);
}

describe('MusicXML measured single tremolo rate', () => {
    for (const [type, duration, count, step] of [
        ['quarter', 12, 4, 240],
        ['half', 24, 8, 240],
        ['whole', 48, 16, 240],
        ['eighth', 6, 4, 120],
        ['16th', 3, 4, 60]
    ] as const) {
        it(`uses fixed subdivisions for ${type} with two strokes`, () => {
            expect(collect(source(type, duration))).toEqual(Array.from({ length: count }, (_, i) => i * step));
        });
    }
    it('extends dotted half total duration without slowing the strokes', () => {
        expect(collect(source('half', 36, '<dot/>'))).toEqual(Array.from({ length: 12 }, (_, i) => i * 240));
    });
    it('retains a genuine tuplet subdivision independently of dotted duration', () => {
        const tm =
            '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>';
        expect(collect(source('half', 24, '<dot/>', tm))).toEqual(Array.from({ length: 12 }, (_, i) => i * 160));
    });
});
