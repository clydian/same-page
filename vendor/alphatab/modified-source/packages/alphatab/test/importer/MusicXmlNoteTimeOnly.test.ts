import { NoteCloner } from '@coderline/alphatab/generated/model/NoteCloner';
import { NoteSerializer } from '@coderline/alphatab/generated/model/NoteSerializer';
import { ScoreLoader } from '@coderline/alphatab/importer/ScoreLoader';
import { AlphaSynthMidiFileHandler } from '@coderline/alphatab/midi/AlphaSynthMidiFileHandler';
import { MidiFile } from '@coderline/alphatab/midi/MidiFile';
import { MidiFileGenerator } from '@coderline/alphatab/midi/MidiFileGenerator';
import { JsonConverter } from '@coderline/alphatab/model/JsonConverter';
import { Note } from '@coderline/alphatab/model/Note';
import { Settings } from '@coderline/alphatab/Settings';
import { describe, expect, it } from 'vitest';

const note = (pass = '', tie = '', chord = '') =>
    `<note${pass ? ` time-only="${pass}"` : ''}>${chord}<pitch><step>C</step><octave>4</octave></pitch><duration>4</duration>${tie ? `<tie type="${tie}"/>` : ''}<type>whole</type>${tie ? `<notations><tied type="${tie}"/></notations>` : ''}</note>`;
const open = '<barline location="left"><repeat direction="forward"/></barline>';
const close = '<barline location="right"><repeat direction="backward" times="2"/></barline>';
function collect(bars: string[], roundtrip = false) {
    const xml = `<score-partwise version="4.0"><part-list><score-part id="P"><part-name>Voice</part-name></score-part></part-list><part id="P">${bars.map((b, i) => `<measure number="${i + 1}">${i === 0 ? '<attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>' : ''}${b}</measure>`).join('')}</part></score-partwise>`;
    const settings = new Settings();
    let score = ScoreLoader.loadScoreFromBytes(new TextEncoder().encode(xml), settings);
    if (roundtrip) {
        score = JsonConverter.jsObjectToScore(JsonConverter.scoreToJsObject(score));
    }
    const file = new MidiFile();
    new MidiFileGenerator(score, settings, new AlphaSynthMidiFileHandler(file)).generate();
    return { score, events: file.tracks.flatMap(t => t.events) };
}
function ticks(bars: string[], roundtrip = false) {
    const { events } = collect(bars, roundtrip);
    return {
        on: events.filter(e => e.constructor.name === 'NoteOnEvent').map(e => e.tick),
        off: events.filter(e => e.constructor.name === 'NoteOffEvent').map(e => e.tick)
    };
}
describe('MusicXML note time-only', () => {
    it('supports comma-separated note passes 2,3', () => {
        expect(ticks([open + note('2, 3') + close.replace('times="2"', 'times="3"')], true)).toEqual({
            on: [3840, 7680],
            off: [7680, 11520]
        });
    });
    for (const invalid of ['2-3', '0', '2,bad', '9007199254740992']) {
        it(`retains legacy unconditional fallback for unsupported pass syntax ${invalid}`, () => {
            expect(ticks([open + note(invalid) + close], true)).toEqual({ on: [0, 3840], off: [3840, 7680] });
        });
    }
    it('does not leak passes between separate repeat groups', () => {
        expect(ticks([open + note('2') + close, open + note('2') + close, note()], true)).toEqual({
            on: [3840, 11520, 15360],
            off: [7680, 15360, 19200]
        });
    });
    it('uses innermost passes for nested repeat groups', () => {
        expect(ticks([open + note('2'), open + note('2') + close, note('2') + close], true)).toEqual({
            on: [7680, 15360, 23040, 26880],
            off: [11520, 19200, 26880, 30720]
        });
    });
    it('plays a second ending on pass2 even though the bar is visited only once', () => {
        const end1 = '<barline location="left"><ending number="1" type="start"/></barline>';
        const end2 = '<barline location="left"><ending number="2" type="start"/></barline>';
        expect(ticks([open + note('2'), end1 + note('2') + close, end2 + note('2')], true)).toEqual({
            on: [7680, 11520],
            off: [11520, 15360]
        });
    });
    it('defaults a missing field in legacy note JSON to unconditional null', () => {
        const n = new Note();
        NoteSerializer.fromJson(n, new Map([['isvisible', true]]));
        expect(n.repeatPasses).toBeNull();
    });
    for (const json of [false, true]) {
        it(`omits first-pass NoteOn/Off and restores subsequent unconditional notes (JSON=${json})`, () => {
            expect(ticks([open + note('2') + close, note()], json)).toEqual({ on: [3840, 7680], off: [7680, 11520] });
        });
    }
    for (const [origin, destination, on, off] of [
        ['2', '2', [7680, 15360], [15360, 19200]],
        ['1', '2', [0, 11520, 15360], [3840, 15360, 19200]],
        ['', '2', [0, 7680, 15360], [3840, 15360, 19200]],
        ['2', '', [3840, 7680, 15360], [7680, 15360, 19200]]
    ] as const) {
        it(`preserves visible tie but only sustains eligible endpoints ${origin || 'all'}→${destination || 'all'}`, () => {
            const bars = [open + note(origin, 'start'), note(destination, 'stop') + close, note()];
            expect(ticks(bars, true)).toEqual({ on, off });
            const { score } = collect(bars, true);
            const a = score.tracks[0].staves[0].bars[0].voices[0].beats[0].notes[0];
            expect(a.tieDestination).not.toBeNull();
            expect(a.tieDestination!.tieOrigin).toBe(a);
        });
    }
    it('deep clones passes and keeps old unconditional notes null', () => {
        const { score } = collect([note('2,3'), note()], true);
        const n = score.tracks[0].staves[0].bars[0].voices[0].beats[0].notes[0];
        const copy = NoteCloner.clone(n);
        expect(copy.repeatPasses).toEqual([2, 3]);
        expect(copy.repeatPasses).not.toBe(n.repeatPasses);
        expect(score.tracks[0].staves[0].bars[1].voices[0].beats[0].notes[0].repeatPasses).toBeNull();
    });
    it('conditions an individual chord member without suppressing its sibling', () => {
        const conditional = note('2', '', '<chord/>').replace('<step>C</step>', '<step>E</step>');
        expect(ticks([open + note() + conditional + close])).toEqual({ on: [0, 3840, 3840], off: [3840, 7680, 7680] });
    });
});

describe('combined silent cue and repeat eligibility', () => {
    const cue = (pass: string, tie: string) => note(pass, tie).replace('<pitch>', '<cue/><pitch>');
    it('never lets an eligible silent cue origin swallow an ordinary tied destination', () => {
        const bars = [open + cue('2', 'start'), note('', 'stop') + close, note()];
        expect(ticks(bars, true)).toEqual({ on: [3840, 11520, 15360], off: [7680, 15360, 19200] });
        const { score } = collect(bars, true);
        const origin = score.tracks[0].staves[0].bars[0].voices[0].beats[0].notes[0];
        expect(origin.isCue).toBe(true);
        expect(origin.repeatPasses).toEqual([2]);
        expect(origin.tieDestination!.tieOrigin).toBe(origin);
    });
    it('does not extend a second-pass ordinary origin into a silent cue endpoint', () => {
        expect(ticks([open + note('2', 'start'), cue('2', 'stop') + close, note()], true)).toEqual({
            on: [7680, 15360],
            off: [11520, 19200]
        });
    });
    for (const cueEndpoint of [false, true]) {
        it(`applies shared staccato when the visible endpoint cannot sound (cue=${cueEndpoint})`, () => {
            const bars = [
                open + note(cueEndpoint ? '' : '1', 'start'),
                (cueEndpoint ? cue('2', 'stop') : note('2', 'stop')) + close,
                note()
            ];
            const { score } = collect(bars, true);
            score.tracks[0].staves[0].bars[0].voices[0].beats[0].sourceChordStaccato = true;
            const file = new MidiFile();
            new MidiFileGenerator(score, new Settings(), new AlphaSynthMidiFileHandler(file)).generate();
            const events = file.tracks.flatMap(t => t.events);
            expect({
                on: events.filter(e => e.constructor.name === 'NoteOnEvent').map(e => e.tick),
                off: events.filter(e => e.constructor.name === 'NoteOffEvent').map(e => e.tick)
            }).toEqual(
                cueEndpoint
                    ? { on: [0, 7680, 15360], off: [1920, 9600, 19200] }
                    : { on: [0, 11520, 15360], off: [1920, 15360, 19200] }
            );
        });
    }
    it('keeps the normal tie chain while a simultaneous conditioned cue remains silent', () => {
        const simultaneousCue = cue('2', '')
            .replace('<cue/>', '<chord/><cue/>')
            .replace('<step>C</step>', '<step>E</step>');
        expect(ticks([open + note('', 'start') + simultaneousCue, note('', 'stop') + close, note()], true)).toEqual({
            on: [0, 7680, 15360],
            off: [7680, 15360, 19200]
        });
    });
});
