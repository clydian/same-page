import { AlphaTexImporter } from '@coderline/alphatab/importer/AlphaTexImporter';
import { ScoreLoader } from '@coderline/alphatab/importer/ScoreLoader';
import { AlphaSynthMidiFileHandler } from '@coderline/alphatab/midi/AlphaSynthMidiFileHandler';
import { MidiFile } from '@coderline/alphatab/midi/MidiFile';
import { MidiFileGenerator } from '@coderline/alphatab/midi/MidiFileGenerator';
import { NoteOnEvent } from '@coderline/alphatab/midi/MidiEvent';
import { BendPoint } from '@coderline/alphatab/model/BendPoint';
import { JsonConverter } from '@coderline/alphatab/model/JsonConverter';
import type { Score } from '@coderline/alphatab/model/Score';
import { TremoloPickingEffect } from '@coderline/alphatab/model/TremoloPickingEffect';
import { Settings } from '@coderline/alphatab/Settings';
import { describe, expect, it } from 'vitest';

function onsets(input: Score) {
    const settings = new Settings();
    const score = JsonConverter.jsObjectToScore(JsonConverter.scoreToJsObject(input));
    const file = new MidiFile();
    const generator = new MidiFileGenerator(score, settings, new AlphaSynthMidiFileHandler(file));
    generator.applyTranspositionPitches = false;
    generator.generate();
    return file.tracks
        .flatMap(t => t.events)
        .filter((e): e is NoteOnEvent => e instanceof NoteOnEvent)
        .map(e => e.tick);
}

describe('Complex single tremolo origins retain the legacy boundary', () => {
    it('retains all eight quarter-origin strokes over a legato slide target', () => {
        const importer = new AlphaTexImporter();
        importer.initFromString(':4 3.3{sl} 5.3 r r', new Settings());
        const score = importer.readScore();
        const beat = score.tracks[0].staves[0].bars[0].voices[0].beats[0];
        beat.tremoloPicking = new TremoloPickingEffect();
        beat.tremoloPicking.marks = 2;
        expect(beat.notes[0].slideTarget).not.toBeNull();
        expect(onsets(score)).toEqual(Array.from({ length: 8 }, (_, i) => i * 240));
    });
    it('retains the existing chain span of an explicitly bent roll origin', () => {
        const xml = `<score-partwise version="4.0"><part-list><score-part id="P"><part-name>Guitar</part-name></score-part></part-list><part id="P"><measure number="1"><attributes><divisions>4</divisions><time><beats>2</beats><beat-type>4</beat-type></time></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><tie type="start"/><type>quarter</type><notations><tied type="start"/><ornaments><tremolo type="single">2</tremolo></ornaments></notations></note><note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><tie type="stop"/><type>quarter</type><notations><tied type="stop"/></notations></note></measure></part></score-partwise>`;
        const score = ScoreLoader.loadScoreFromBytes(new TextEncoder().encode(xml), new Settings());
        const note = score.tracks[0].staves[0].bars[0].voices[0].beats[0].notes[0];
        note.addBendPoint(new BendPoint(0, 0));
        note.addBendPoint(new BendPoint(60, 4));
        expect(note.hasBend).toBe(true);
        expect(note.isTieOrigin).toBe(true);
        expect(onsets(score)).toEqual(Array.from({ length: 8 }, (_, i) => i * 240));
    });
});
