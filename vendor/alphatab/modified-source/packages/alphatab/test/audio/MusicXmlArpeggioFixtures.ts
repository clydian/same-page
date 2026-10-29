import { MusicXmlImporter } from '@coderline/alphatab/importer/MusicXmlImporter';
import { ByteBuffer } from '@coderline/alphatab/io/ByteBuffer';
import { Settings } from '@coderline/alphatab/Settings';
import { MidiFile } from '@coderline/alphatab/midi/MidiFile';
import { MidiFileGenerator } from '@coderline/alphatab/midi/MidiFileGenerator';
import { AlphaSynthMidiFileHandler } from '@coderline/alphatab/midi/AlphaSynthMidiFileHandler';
import { NoteOnEvent, NoteOffEvent } from '@coderline/alphatab/midi/MidiEvent';
import type { Score } from '@coderline/alphatab/model/Score';

export function source(direction = '', multi = false, lowerNumber = 1, marked = true) {
    const tag = (number: number) =>
        marked
            ? `<notations><arpeggiate number="${number}" ${direction ? `direction="${direction}"` : ''}/></notations>`
            : '';
    const note = (step: string, octave: number, chord: boolean, staff: number, number: number) =>
        `<note>${chord ? '<chord/>' : ''}<pitch><step>${step}</step><octave>${octave}</octave></pitch><duration>2</duration><voice>${staff}</voice><type>half</type><staff>${staff}</staff>${tag(number)}</note>`;
    return `<score-partwise version="4.0"><part-list><score-part id="P"><part-name>Piano</part-name></score-part></part-list><part id="P"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><staves>${multi ? 2 : 1}</staves><clef number="1"><sign>G</sign><line>2</line></clef>${multi ? '<clef number="2"><sign>F</sign><line>4</line></clef>' : ''}</attributes>${note('C', 4, false, 1, 1)}${note('E', 4, true, 1, 1)}${note('G', 4, true, 1, 1)}<note><rest/><duration>2</duration><voice>1</voice><type>half</type><staff>1</staff></note>${multi ? `<backup><duration>4</duration></backup>${note('C', 2, false, 2, lowerNumber)}${note('G', 2, true, 2, lowerNumber)}<note><rest/><duration>2</duration><voice>2</voice><type>half</type><staff>2</staff></note>` : ''}</measure></part></score-partwise>`;
}
export function load(xml: string) {
    const importer = new MusicXmlImporter();
    importer.init(ByteBuffer.fromBuffer(new TextEncoder().encode(xml)), new Settings());
    return importer.readScore();
}
export function midi(score: Score) {
    const file = new MidiFile();
    const generator = new MidiFileGenerator(score, new Settings(), new AlphaSynthMidiFileHandler(file));
    generator.applyTranspositionPitches = false;
    generator.generate();
    const events = file.tracks.flatMap(t => t.events);
    return {
        events,
        on: events.filter((e): e is NoteOnEvent => e instanceof NoteOnEvent).sort((a, b) => a.noteKey - b.noteKey),
        off: events.filter((e): e is NoteOffEvent => e instanceof NoteOffEvent).sort((a, b) => a.noteKey - b.noteKey),
        bounds: generator.tickLookup.masterBars.map(b => [b.start, b.end])
    };
}
