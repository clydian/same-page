import { NoteOnEvent, NoteBendEvent } from '@coderline/alphatab/midi/MidiEvent';
import { expect, it } from 'vitest';
import { JsonConverter } from '@coderline/alphatab/model/JsonConverter';
import { NoteCloner } from '@coderline/alphatab/generated/model/NoteCloner';

import { source, load, midi } from './MusicXmlArpeggioFixtures';
for (const multi of [false, true]) {
    for (const direction of ['', 'up', 'down']) {
        it(`orders ${multi ? 'cross-staff' : 'single-staff'} authored heads, direction=${direction || 'default'}`, () => {
            const actual = midi(load(source(direction, multi)));
            const plain = midi(load(source(direction, multi, 1, false)));
            expect(actual.on.map(n => n.noteKey)).toEqual(multi ? [36, 43, 60, 64, 67] : [60, 64, 67]);
            const ticks = actual.on.map(n => n.tick);
            for (let i = 1; i < ticks.length; i++) {
                expect(Math.sign(ticks[i] - ticks[i - 1])).toBe(direction === 'down' ? -1 : 1);
            }
            expect(actual.events.filter(e => !(e instanceof NoteOnEvent) && !(e instanceof NoteBendEvent))).toEqual(
                plain.events.filter(e => !(e instanceof NoteOnEvent) && !(e instanceof NoteBendEvent))
            );
            const resets = (events: typeof actual.events) =>
                events
                    .filter((e): e is NoteBendEvent => e instanceof NoteBendEvent)
                    .sort((a, b) => a.noteKey - b.noteKey);
            expect(resets(actual.events).map(e => ({ ...e, tick: 0 }))).toEqual(
                resets(plain.events).map(e => ({ ...e, tick: 0 }))
            );
            for (const reset of resets(actual.events)) {
                expect(reset.tick).toBe(actual.on.find(on => on.noteKey === reset.noteKey)!.tick);
            }
            expect(actual.on.map(e => ({ ...e, tick: 0 }))).toEqual(plain.on.map(e => ({ ...e, tick: 0 })));
            expect(actual.off).toEqual(plain.off);
            expect(actual.bounds).toEqual(plain.bounds);
            expect(actual.on.map(({ noteKey, noteVelocity, channel }) => [noteKey, noteVelocity, channel])).toEqual(
                plain.on.map(({ noteKey, noteVelocity, channel }) => [noteKey, noteVelocity, channel])
            );
            for (const event of actual.on) {
                expect(event.tick).toBeLessThan(actual.off.find(off => off.noteKey === event.noteKey)!.tick);
            }
        });
    }
}
it('keeps different simultaneous numbers as separate rolls', () => {
    const on = midi(load(source('', true, 2))).on;
    expect(on[0].tick).toBe(on[2].tick);
    expect(on[1].tick).toBeGreaterThan(on[0].tick);
    expect(on[3].tick).toBeGreaterThan(on[2].tick);
});
it('does not absorb unmarked heads or another unmarked voice', () => {
    const xml = source('', true);
    const score = load(xml);
    const lower = score.tracks[0].staves[1].bars[0].voices.flatMap(v => v.beats.flatMap(b => b.notes));
    for (const note of lower) {
        note.sourceArpeggio = null;
    }
    const upper = score.tracks[0].staves[0].bars[0].voices[0].beats[0].notes;
    upper[1].sourceArpeggio = null;
    const on = midi(score).on;
    expect(on.find(n => n.noteKey === 43)!.tick).toBe(0);
    expect(on.find(n => n.noteKey === 64)!.tick).toBe(0);
    expect(on.find(n => n.noteKey === 67)!.tick).toBeGreaterThan(0);
});
it('round trips membership through typed JSON and deep note clone; absent legacy fields remain absent', () => {
    const score = load(source('down', true));
    const json = JsonConverter.scoreToJsObject(score);
    const restored = JsonConverter.jsObjectToScore(structuredClone(json));
    expect(midi(restored)).toEqual(midi(score));
    const note = score.tracks[0].staves[0].bars[0].voices[0].beats[0].notes[0];
    const clone = NoteCloner.clone(note);
    expect(clone.sourceArpeggio).toEqual(note.sourceArpeggio);
    expect(clone.sourceArpeggio).not.toBe(note.sourceArpeggio);
    const old = JSON.parse(JsonConverter.scoreToJson(score), (key, value) =>
        key.toLowerCase() === 'sourcearpeggio' ? undefined : value
    );
    const legacy = JsonConverter.jsObjectToScore(old);
    expect(new Set(midi(legacy).on.map(n => n.tick)).size).toBe(1);
});
it('does not retrigger a held cross-staff member and preserves the entire tie tail', () => {
    const original = source('', true);
    const attributes = original.match(/<attributes>.*?<\/attributes>/)![0];
    const first = `<measure number="1">${attributes}<note><rest measure="yes"/><duration>4</duration><voice>1</voice><type>whole</type><staff>1</staff></note><backup><duration>4</duration></backup><note><pitch><step>C</step><octave>2</octave></pitch><duration>4</duration><tie type="start"/><voice>2</voice><type>whole</type><staff>2</staff><notations><tied type="start"/></notations></note></measure>`;
    let second = original
        .match(/<measure.*?<\/measure>/)![0]
        .replace('number="1"', 'number="2"')
        .replace(attributes, '');
    second = second.replace(
        '<step>C</step><octave>2</octave></pitch><duration>2</duration>',
        '<step>C</step><octave>2</octave></pitch><duration>2</duration><tie type="stop"/>'
    );
    second = second.replace(
        '<voice>2</voice><type>half</type><staff>2</staff><notations>',
        '<voice>2</voice><type>half</type><staff>2</staff><notations><tied type="stop"/>'
    );
    const xml = original.replace(/<measure.*?<\/measure>/, first + second);
    const actual = midi(load(xml));
    const plain = midi(load(xml.replaceAll(/<arpeggiate[^>]*\/>/g, '')));
    expect(actual.on.filter(n => n.noteKey === 36).map(n => n.tick)).toEqual([0]);
    expect(actual.off).toEqual(plain.off);
    expect(actual.bounds).toEqual([
        [0, 3840],
        [3840, 7680]
    ]);
    const fresh = actual.on.filter(n => n.noteKey !== 36);
    expect(fresh[0].tick).toBe(3840);
    for (let i = 1; i < fresh.length; i++) {
        expect(fresh[i].tick).toBeGreaterThan(fresh[i - 1].tick);
    }
});
it('keeps a one-tag chord strictly per-head for new MusicXML, without inventing participation', () => {
    let count = 0;
    const xml = source().replaceAll(/<arpeggiate[^>]*\/>/g, tag => (count++ === 0 ? tag : ''));
    const score = load(xml);
    expect(score.tracks[0].staves[0].bars[0].voices[0].beats[0].notes.map(n => !!n.sourceArpeggio)).toEqual([
        true,
        false,
        false
    ]);
    expect(midi(score).on.map(n => n.tick)).toEqual([0, 0, 0]);
});
it('excludes cue heads from the sounding roll without removing their source membership', () => {
    const score = load(source());
    score.tracks[0].staves[0].bars[0].voices[0].beats[0].notes[0].isCue = true;
    const on = midi(score).on;
    expect(on.map(n => n.noteKey)).toEqual([64, 67]);
    expect(on[0].tick).toBe(0);
    expect(on[1].tick).toBeGreaterThan(0);
});

it('gives authored unison heads one pitch onset and keeps short-note endpoints bounded', () => {
    const xml = source('', true).replace('<step>G</step><octave>2</octave>', '<step>C</step><octave>4</octave>');
    const score = load(xml);
    const notes = score.tracks[0].staves.flatMap(st => st.bars[0].voices.flatMap(v => v.beats.flatMap(b => b.notes)));
    for (const note of notes) {
        note.isStaccato = true;
    }
    const actual = midi(score);
    expect(new Set(actual.on.filter(n => n.noteKey === 60).map(n => n.tick)).size).toBe(1);
    for (const event of actual.on) {
        expect(event.tick).toBeLessThan(actual.off.find(off => off.noteKey === event.noteKey)!.tick);
    }
    for (const note of notes) {
        note.sourceArpeggio = null;
    }
    expect(actual.off).toEqual(midi(score).off);
});

it('preserves explicit yes/no/omitted unbroken hints without changing common playback', () => {
    const plain = midi(load(source('', true)));
    for (const value of ['yes', 'no']) {
        const score = load(source('', true).replaceAll('<arpeggiate ', `<arpeggiate unbroken="${value}" `));
        const note = score.tracks[0].staves[0].bars[0].voices[0].beats[0].notes[0];
        expect(note.sourceArpeggio!.unbroken).toBe(value === 'yes');
        expect(midi(JsonConverter.jsonToScore(JsonConverter.scoreToJson(score)))).toEqual(plain);
    }
    expect(load(source()).tracks[0].staves[0].bars[0].voices[0].beats[0].notes[0].sourceArpeggio!.unbroken).toBeNull();
});
it('orders synthetic five-head and four-head grand-staff shapes used by source acceptance', () => {
    const five = source('', true)
        .replace('<step>C</step><octave>2</octave>', '<step>A</step><alter>-1</alter><octave>2</octave>')
        .replace('<step>G</step><octave>2</octave>', '<step>A</step><alter>-1</alter><octave>3</octave>')
        .replace('<step>E</step><octave>4</octave>', '<step>E</step><alter>-1</alter><octave>4</octave>')
        .replace('<step>G</step><octave>4</octave>', '<step>A</step><alter>-1</alter><octave>4</octave>');
    const four = source('', true)
        .replace('<step>C</step><octave>4</octave>', '<step>D</step><octave>4</octave>')
        .replace('<step>E</step><octave>4</octave>', '<step>E</step><alter>-1</alter><octave>4</octave>')
        .replace('<step>C</step><octave>2</octave>', '<step>E</step><alter>-1</alter><octave>3</octave>')
        .replace(/<note><chord\/><pitch><step>G<\/step><octave>2<\/octave>.*?<\/note>/, '');
    for (const [xml, pitches] of [
        [five, [44, 56, 60, 63, 68]],
        [four, [51, 62, 63, 67]]
    ] as const) {
        const actual = midi(load(xml.replaceAll('<arpeggiate ', '<arpeggiate unbroken="yes" ')));
        expect(actual.on.map(n => n.noteKey)).toEqual(pitches);
        for (let i = 1; i < actual.on.length; i++) {
            expect(actual.on[i].tick).toBeGreaterThan(actual.on[i - 1].tick);
        }
    }
});
