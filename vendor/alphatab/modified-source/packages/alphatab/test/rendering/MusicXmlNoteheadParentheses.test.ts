import { NoteCloner } from '@coderline/alphatab/generated/model/NoteCloner';
import { NoteSerializer } from '@coderline/alphatab/generated/model/NoteSerializer';
import { AlphaTexImporter } from '@coderline/alphatab/importer/AlphaTexImporter';
import { MusicXmlImporter } from '@coderline/alphatab/importer/MusicXmlImporter';
import { ByteBuffer } from '@coderline/alphatab/io/ByteBuffer';
import { LayoutMode } from '@coderline/alphatab/LayoutMode';
import { AlphaSynthMidiFileHandler } from '@coderline/alphatab/midi/AlphaSynthMidiFileHandler';
import { MidiFile } from '@coderline/alphatab/midi/MidiFile';
import { MidiFileGenerator } from '@coderline/alphatab/midi/MidiFileGenerator';
import { DynamicValue } from '@coderline/alphatab/model/DynamicValue';
import { JsonConverter } from '@coderline/alphatab/model/JsonConverter';
import type { Score } from '@coderline/alphatab/model/Score';
import { GhostParenthesisGlyph } from '@coderline/alphatab/rendering/glyphs/GhostParenthesisGlyph';
import { ScoreRenderer } from '@coderline/alphatab/rendering/ScoreRenderer';
import { Settings } from '@coderline/alphatab/Settings';
import { StaveProfile } from '@coderline/alphatab/StaveProfile';
import { describe, expect, it, vi } from 'vitest';

function source(parentheses: string, chord = false) {
    const head = parentheses ? `<notehead parentheses="${parentheses}">normal</notehead>` : '';
    return `<score-partwise version="4.0"><part-list><score-part id="S"><part-name>Soprano</part-name></score-part></part-list><part id="S"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><direction><direction-type><dynamics><mf/></dynamics></direction-type></direction>${chord ? '<note><pitch><step>C</step><octave>5</octave></pitch><duration>2</duration><type>half</type><stem>down</stem></note>' : ''}<note>${chord ? '<chord/>' : ''}<pitch><step>A</step><alter>-1</alter><octave>5</octave></pitch><duration>${chord ? 2 : 4}</duration><type>${chord ? 'half' : 'whole'}</type><stem>down</stem>${head}</note>${chord ? '<note><rest/><duration>2</duration><type>half</type></note>' : ''}</measure></part></score-partwise>`;
}
const notes = (s: Score) => s.tracks[0].staves[0].bars[0].voices[0].beats.flatMap(b => b.notes);
function load(parentheses: string, chord = false) {
    const importer = new MusicXmlImporter();
    importer.init(ByteBuffer.fromBuffer(new TextEncoder().encode(source(parentheses, chord))), new Settings());
    const score = importer.readScore();
    // Explicit mf avoids a saturated default-velocity control.
    for (const note of notes(score)) { note.dynamics = DynamicValue.MF; }
    return score;
}
function midi(score: Score) {
    const file = new MidiFile();
    const generator = new MidiFileGenerator(score, new Settings(), new AlphaSynthMidiFileHandler(file));
    generator.applyTranspositionPitches = false;
    generator.generate();
    return JSON.parse(JSON.stringify(file.tracks.flatMap(t => t.events)));
}
function clone(score: Score) {
    return JsonConverter.jsObjectToScore(structuredClone(JsonConverter.scoreToJsObject(score)));
}
function render(score: Score, mode: LayoutMode, profile = StaveProfile.Score) {
    const settings = new Settings();
    settings.core.engine = 'svg';
    settings.core.enableLazyLoading = false;
    settings.display.staveProfile = profile;
    settings.display.layoutMode = mode;
    const renderer = new ScoreRenderer(settings);
    renderer.width = 700;
    let svg = '';
    const painted = vi.spyOn(GhostParenthesisGlyph.prototype, 'paint');
    renderer.partialRenderFinished.on(e => { if (typeof e.renderResult === 'string') { svg += e.renderResult; } });
    renderer.error.on(e => { throw e; });
    try {
        renderer.renderScore(score, [0]);
        return { svg, parentheses: painted.mock.calls.length };
    } finally { renderer.destroy(); painted.mockRestore(); }
}
function texGhost() {
    const importer = new AlphaTexImporter();
    importer.initFromString('. :1 3.3{g}', new Settings());
    const score = importer.readScore();
    notes(score)[0].dynamics = DynamicValue.MF;
    return score;
}
describe('MusicXML notehead parentheses are display-only', () => {
    for (const value of ['', 'no', 'yes']) {
        it(`imports ${value || 'omitted'} independently from legacy ghost`, () => {
            const n = notes(load(value))[0];
            expect(n.isGhost).toBe(false);
            expect(n.isNoteHeadParenthesized).toBe(value === 'yes');
        });
    }
    for (const chord of [false, true]) {
        it(`preserves every MIDI event with explicit mf, chord=${chord}`, () => {
            const plain = load('no', chord);
            const marked = load('yes', chord);
            expect(midi(marked)).toEqual(midi(plain));
            expect(midi(marked).filter((e: { type: number }) => e.type === 128).map((e: { noteVelocity: number }) => e.noteVelocity)).toEqual(chord ? [79, 79] : [79]);
            expect(midi(clone(marked))).toEqual(midi(plain));
        });
    }
    it('retains appearance through Worker JSON and generated deep clone', () => {
        const score = load('yes', true);
        for (const copied of [notes(clone(score))[1], NoteCloner.clone(notes(score)[1])]) {
            expect(copied.isNoteHeadParenthesized).toBe(true);
            expect(copied.isGhost).toBe(false);
            expect([copied.octave, copied.tone]).toEqual([notes(score)[1].octave, notes(score)[1].tone]);
        }
        expect(notes(clone(score))[0].isNoteHeadParenthesized).toBe(false);
        expect(notes(clone(score))[1].realValue).toBe(80);
    });
    it('keeps absent-field old JSON ghost playback and appearance', () => {
        const score = load('');
        const n = notes(score)[0];
        NoteSerializer.fromJson(n, new Map([['isghost', true]]));
        expect(n.isNoteHeadParenthesized).toBe(false);
        expect(n.isGhost).toBe(true);
        expect(notes(clone(score))[0].isGhost).toBe(true);
        expect(midi(score).filter((e: { type: number }) => [128, 144].includes(e.type)).map((e: { noteVelocity: number }) => e.noteVelocity)).toEqual([63, 63]);
        expect(midi(clone(score))).toEqual(midi(score));
    });
    it('keeps AlphaTex ghost semantics', () => {
        const score = texGhost();
        expect(notes(score)[0].isGhost).toBe(true);
        expect(notes(score)[0].isNoteHeadParenthesized).toBe(false);
        expect(midi(score).filter((e: { type: number }) => [128, 144].includes(e.type)).map((e: { noteVelocity: number }) => e.noteVelocity)).toEqual([63, 63]);
    });
    for (const mode of [LayoutMode.Page, LayoutMode.Horizontal]) {
        for (const chord of [false, true]) {
            it(`draws only marked head parentheses in ${LayoutMode[mode]}, chord=${chord}`, () => {
                const plain = render(clone(load('no', chord)), mode);
                const marked = render(clone(load('yes', chord)), mode);
                expect(plain.parentheses).toBe(0);
                expect(marked.parentheses).toBe(2);
                expect(marked.svg).not.toEqual(plain.svg);
            });
        }
        it(`keeps legacy ghost and combined flags appearance in ${LayoutMode[mode]}`, () => {
            const score = load('yes');
            const n = notes(score)[0];
            n.isGhost = true;
            expect(render(score, mode).parentheses).toBe(2);
            n.isNoteHeadParenthesized = false;
            expect(render(score, mode).parentheses).toBe(2);
            expect(midi(score).filter((e: { type: number }) => e.type === 128)[0].noteVelocity).toBe(63);
        });
        it(`preserves existing tablature parentheses in ${LayoutMode[mode]}`, () => {
            const legacy = texGhost();
            const displayOnly = texGhost();
            notes(displayOnly)[0].isGhost = false;
            notes(displayOnly)[0].isNoteHeadParenthesized = true;
            expect(render(displayOnly, mode, StaveProfile.ScoreTab).svg).toEqual(render(legacy, mode, StaveProfile.ScoreTab).svg);
        });
    }
});
