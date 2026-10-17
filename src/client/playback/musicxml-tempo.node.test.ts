import assert from 'node:assert/strict';
import { test } from 'vitest';
import * as alphaTab from '@coderline/alphatab';
import { loadMusicXml, loadPreparedMusicXml } from '@clydian/chorus-player/engine';
import { prepareMusicXmlForAlphaTabBytes } from '@clydian/chorus-player/musicxml-direction-timing';

const note = '<note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><type>quarter</type></note>';
const direction = (unit: string, bpm: number, dots = 0, sound = '', offset = '') => `<direction><direction-type><metronome><beat-unit>${unit}</beat-unit>${'<beat-unit-dot/>'.repeat(dots)}<per-minute>${bpm}</per-minute></metronome></direction-type>${offset}${sound ? `<sound tempo="${sound}"/>` : ''}</direction>`;
const xml = (content: string, implicit = false) => `<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Voice</part-name></score-part></part-list><part id="P1"><measure number="1"${implicit ? ' implicit="yes"' : ''}><attributes><divisions>2</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>${content}</measure></part></score-partwise>`;
function tempos(score: alphaTab.model.Score) {
  const events: number[][] = [];
  class Handler extends alphaTab.midi.AlphaSynthMidiFileHandler {
    override addTempo(tick: number, bpm: number) { events.push([tick, bpm]); }
  }
  new alphaTab.midi.MidiFileGenerator(score, new alphaTab.Settings(), new Handler(new alphaTab.midi.MidiFile())).generate();
  return events;
}

for (const [name, source] of [
  ['舟中晓望 dotted quarter 56', xml(direction('quarter', 56, 1, '84') + note.repeat(4))],
  ['Come to Me half 54', xml(direction('half', 54, 0, '108') + note.repeat(4))],
]) {
  test(`fixed player artifact retains source tempo for ${name}`, () => {
    const bytes = new TextEncoder().encode(source);
    const original = bytes.slice();
    const expected = name.startsWith('Come') ? 108 : 84;
    assert.deepEqual(tempos(loadMusicXml(bytes, new alphaTab.Settings())), [[0, expected]]);
    const prepared = structuredClone(prepareMusicXmlForAlphaTabBytes(bytes));
    assert.deepEqual(tempos(loadPreparedMusicXml(prepared, new alphaTab.Settings())), [[0, expected]]);
    assert.deepEqual(bytes, original);
  });
}

test('fixed player artifact applies divisions offsets at the real beat', () => {
  const source = xml(direction('quarter', 100) + note + direction('eighth', 120, 0, '', '<offset>1</offset>') + note.repeat(3));
  assert.deepEqual(tempos(loadMusicXml(new TextEncoder().encode(source), new alphaTab.Settings())), [[0, 100], [1440, 60]]);
});

test('fixed player artifact retains mid-pickup tempo timing', () => {
  const source = xml(note + direction('quarter', 60, 0, '', '<offset>-1</offset>'), true);
  assert.deepEqual(tempos(loadMusicXml(new TextEncoder().encode(source), new alphaTab.Settings())), [[0, 120], [480, 60]]);
});
