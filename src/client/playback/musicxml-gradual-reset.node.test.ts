import assert from 'node:assert/strict';
import { test } from 'vitest';
import * as alphaTab from '@coderline/alphatab';
import { loadMusicXml } from '@clydian/chorus-player/engine';

function source(word: string, value: 'mf' | 'f' = 'mf') {
  const dynamic = `<direction><direction-type><dynamics><${value}/></dynamics></direction-type></direction>`;
  const eighths = '<note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>eighth</type></note>'.repeat(8);
  return new TextEncoder().encode(`<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Voice</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>2</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>${dynamic}${word ? `<direction><direction-type><words>${word}</words></direction-type></direction>` : ''}${eighths}</measure><measure number="2">${dynamic}${eighths}</measure><measure number="3">${eighths}</measure></part></score-partwise>`);
}

test('installed artifact preserves source non dim. text and does not diminish', () => {
  const bytes = source('non dim.', 'f');
  assert.deepEqual(events(bytes), events(source('', 'f')));
  const score = loadMusicXml(bytes, new alphaTab.Settings());
  assert.equal(score.tracks[0].staves[0].bars[0].voices[0].beats[0].text,'non dim.');
});

test('installed artifact retains affirmative dim. when non qualifies troppo', () => {
  const firstBar = events(source('non troppo dim.', 'f')).filter(event => event.tick < 3840 && event instanceof alphaTab.midi.NoteOnEvent);
  assert.equal(firstBar.length,8);
  assert.ok(firstBar.some(event => event instanceof alphaTab.midi.NoteOnEvent && event.noteVelocity < 95));
});
function events(bytes: Uint8Array) {
  const file = new alphaTab.midi.MidiFile();
  new alphaTab.midi.MidiFileGenerator(loadMusicXml(bytes, new alphaTab.Settings()), new alphaTab.Settings(), new alphaTab.midi.AlphaSynthMidiFileHandler(file)).generate();
  return file.tracks.flatMap(track => track.events);
}

for (const word of ['cresc.', 'dim.']) {
  test(`installed artifact ends ${word} at a new explicit MF and retains the following bar`, () => {
    const actual = events(source(word));
    const control = events(source(''));
    // The prior bar's last note ends at 3840 and legitimately retains its own
    // inferred release velocity. The reset governs new attacks from 3840 on.
    const afterReset = (event: alphaTab.midi.MidiEvent) => event.tick >= 3840 && !(event.tick === 3840 && event instanceof alphaTab.midi.NoteOffEvent);
    assert.deepEqual(actual.filter(afterReset), control.filter(afterReset));
    const attacks = actual.filter(event => event.tick >= 3840 && event instanceof alphaTab.midi.NoteOnEvent);
    assert.equal(attacks.length,16);
    assert.ok(attacks.every(event => event instanceof alphaTab.midi.NoteOnEvent && event.noteVelocity === 79));
    const bytes = source(word);
    const original = bytes.slice();
    loadMusicXml(bytes, new alphaTab.Settings());
    assert.deepEqual(bytes, original);
  });
}
