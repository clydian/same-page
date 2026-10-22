import assert from 'node:assert/strict';
import test from 'node:test';
import * as alphaTab from '@coderline/alphatab';
import { loadMusicXml, loadPreparedMusicXml } from '../src/engine.ts';
import { prepareMusicXmlForAlphaTabBytes } from '../src/musicxml-direction-timing.ts';
import { readMusicXmlTempoMeasures } from '../src/musicxml-metronome.ts';

const bytes = text => new TextEncoder().encode(text);
const note = '<note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><type>quarter</type></note>';
const metronome = (unit, bpm, dots = 0) => `<metronome><beat-unit>${unit}</beat-unit>${'<beat-unit-dot/>'.repeat(dots)}<per-minute>${bpm}</per-minute></metronome>`;
const direction = (mark, sound = '', offset = '') => `<direction><direction-type>${mark}</direction-type>${offset}${sound === '' ? '' : `<sound tempo="${sound}"/>`}</direction>`;
const scoreXml = content => `<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Voice</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>2</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>${content}</measure></part></score-partwise>`;
function tempos(score) {
  const result = [];
  const handler = new Proxy({ addTempo: (tick, bpm) => result.push([tick, bpm]) }, { get: (target, key) => target[key] ?? (() => {}) });
  new alphaTab.midi.MidiFileGenerator(score, new alphaTab.Settings(), handler).generate();
  return result;
}
const load = xml => loadMusicXml(bytes(xml), new alphaTab.Settings());

for (const [unit, bpm, dots, expected] of [
  ['quarter', 56, 0, 56],
  ['quarter', 56, 1, 84],
  ['quarter', 40, 2, 70],
  ['half', 60, 0, 120],
  ['eighth', 120, 0, 60],
  ['eighth', 80, 1, 60],
  ['whole', 30, 0, 120],
  ['16th', 160, 0, 40],
]) {
  test(`${unit} with ${dots} dots at ${bpm} plays at quarter ${expected}`, () => {
    const xml = scoreXml(direction(metronome(unit, bpm, dots)) + note.repeat(4));
    assert.deepEqual(tempos(load(xml)), [[0, expected]]);
  });
}

test('source dotted-quarter 56 plus sound 84 produces one quarter-84 event through both load routes', () => {
  const input = bytes(scoreXml(direction(metronome('quarter', 56, 1), 84) + note.repeat(4)));
  const original = input.slice();
  const prepared = prepareMusicXmlForAlphaTabBytes(input);
  assert.match(new TextDecoder().decode(prepared.bytes), /beat-unit-dot/);
  assert.deepEqual(tempos(loadMusicXml(input, new alphaTab.Settings())), [[0, 84]]);
  assert.deepEqual(tempos(loadPreparedMusicXml(prepared, new alphaTab.Settings())), [[0, 84]]);
  assert.deepEqual(input, original, 'host MusicXML bytes must remain unchanged');
});

test('explicit sound playback tempo remains authoritative over the visible metronome value', () => {
  const xml = scoreXml(direction(metronome('quarter', 56, 1), 90) + note.repeat(4));
  assert.deepEqual(tempos(load(xml)), [[0, 90]]);
});

test('non-quarter tempo after a note retains its direction offset and beat position', () => {
  const xml = scoreXml(direction(metronome('quarter', 100)) + note + direction(metronome('eighth', 120), '', '<offset>1</offset>') + note.repeat(3));
  const events = tempos(load(xml));
  assert.deepEqual(events[0], [0, 100]);
  assert.deepEqual(events.at(-1), [1440, 60]);
});

for (const mark of [
  '<metronome><beat-unit>quarter</beat-unit><beat-unit-tied><beat-unit>eighth</beat-unit></beat-unit-tied><per-minute>56</per-minute></metronome>',
  metronome('quarter', '56–60', 1),
  metronome('quarter', 'ca. 56', 1),
  metronome('quarter', '0', 1),
  metronome('unknown', 56),
]) {
  test(`unsupported or nonnumeric metronome stays unchanged: ${mark}`, () => {
    const input = bytes(scoreXml(direction(mark) + note.repeat(4)));
    assert.equal(readMusicXmlTempoMeasures(input)[0].complete, false);
  });
}

test('sound offset overrides direction offset in divisions', () => {
  const xml = scoreXml(direction(metronome('quarter', 100)) + note + `<direction><direction-type>${metronome('quarter', 56, 1)}</direction-type><offset>1</offset><sound tempo="90"><offset>2</offset></sound></direction>` + note.repeat(3));
  assert.deepEqual(tempos(load(xml)), [[0, 100], [1440, 84], [1920, 90]]);
});

test('sound=no leaves playback at the direction cursor', () => {
  const xml = scoreXml(direction(metronome('quarter', 100)) + note + direction(metronome('quarter', 60), '', '<offset sound="no">1</offset>') + note.repeat(3));
  assert.deepEqual(tempos(load(xml)), [[0, 100], [960, 60]]);
});

test('returning to an earlier tempo at a later onset is not deduplicated', () => {
  const xml = scoreXml(direction(metronome('quarter', 84)) + note + direction(metronome('quarter', 56)) + note + direction(metronome('quarter', 84)) + note.repeat(2));
  assert.deepEqual(tempos(load(xml)), [[0, 84], [960, 56], [1920, 84]]);
});

test('sound-only tempo does not invent a printed metronome', () => {
  const xml = scoreXml('<direction><direction-type><words>dolce</words></direction-type><sound tempo="84"/></direction>' + note.repeat(4));
  const score = load(xml);
  assert.deepEqual(tempos(score), [[0, 84]]);
  assert.equal(score.masterBars[0].tempoAutomations[0].isVisible, false);
});

test('old prepared payloads use the same timing fallback', () => {
  const prepared = prepareMusicXmlForAlphaTabBytes(bytes(scoreXml(direction(metronome('quarter', 56, 1), 84) + note.repeat(4))));
  delete prepared.tempoMeasures;
  assert.deepEqual(tempos(loadPreparedMusicXml(prepared, new alphaTab.Settings())), [[0, 84]]);
});

test('backup, chord and carried divisions locate a second-voice direction', () => {
  const xml = scoreXml(direction(metronome('quarter', 100)) + note.repeat(4) + '<backup><duration>8</duration></backup>' + note + note.replace('<pitch>', '<chord/><pitch>') + direction(metronome('half', 30), '', '<offset>-1</offset>') + note.repeat(3));
  assert.deepEqual(tempos(load(xml)), [[0, 100], [480, 60]]);
});

test('same-onset part copies produce one effective tempo event', () => {
  const xml = scoreXml(direction(metronome('quarter', 56, 1), 84) + note.repeat(4));
  const duplicate = xml.match(/<part id="P1">[\s\S]*?<\/part>/)[0].replace('id="P1"', 'id="P2"');
  const multi = xml.replace('</part-list>', '<score-part id="P2"><part-name>Second</part-name></score-part></part-list>').replace('</score-partwise>', duplicate + '</score-partwise>');
  assert.deepEqual(tempos(load(multi)), [[0, 84]]);
});

test('an unsupported mark does not erase other native automation in its measure', () => {
  const xml = scoreXml(direction(metronome('quarter', 100)) + note + direction(metronome('quarter', 'ca. 56', 1)) + note.repeat(3));
  const prepared = prepareMusicXmlForAlphaTabBytes(bytes(xml));
  assert.equal(prepared.tempoMeasures[0].complete, false);
  const native = alphaTab.importer.ScoreLoader.loadScoreFromBytes(prepared.bytes, new alphaTab.Settings());
  assert.deepEqual(tempos(loadPreparedMusicXml(prepared, new alphaTab.Settings())), tempos(native));
});

test('a first tempo starting mid-bar does not retroactively change the opening', () => {
  const xml = scoreXml(note + direction(metronome('quarter', 60)) + note.repeat(3));
  assert.deepEqual(tempos(load(xml)), [[0, 120], [960, 60]]);
});

test('a short implicit pickup uses its actual duration for a mid-bar tempo', () => {
  const xml = scoreXml(note + direction(metronome('quarter', 60), '', '<offset>-1</offset>')).replace('<measure number="1">', '<measure number="1" implicit="yes">');
  const score = load(xml);
  assert.equal(score.masterBars[0].isAnacrusis, true);
  assert.equal(score.masterBars[0].calculateDuration(), 960);
  assert.deepEqual(tempos(score), [[0, 120], [480, 60]]);
});

test('divisions changes carry into the next measure tempo offsets', () => {
  const q = note.replace('<duration>2</duration>', '<duration>4</duration>');
  const second = '<measure number="2"><attributes><divisions>4</divisions></attributes>' + q + direction(metronome('quarter', 80), '', '<offset>2</offset>') + q.repeat(3) + '</measure>';
  const third = '<measure number="3">' + q + direction(metronome('quarter', 60), '', '<offset>2</offset>') + q.repeat(3) + '</measure>';
  const xml = scoreXml(direction(metronome('quarter', 100)) + note.repeat(4)).replace('</part></score-partwise>', second + third + '</part></score-partwise>');
  assert.deepEqual(tempos(load(xml)), [[0, 100], [5280, 80], [9120, 60]]);
});

test('a later short implicit measure locates its tempo by actual duration', () => {
  const later = '<measure number="2" implicit="yes">' + note + direction(metronome('quarter', 60), '', '<offset>-1</offset>') + '</measure>';
  const xml = scoreXml(direction(metronome('quarter', 100)) + note.repeat(4)).replace('</part></score-partwise>', later + '</part></score-partwise>');
  const score = load(xml);
  assert.equal(score.masterBars[1].isAnacrusis, true);
  assert.deepEqual(tempos(score), [[0, 100], [4320, 60]]);
});

test('pass-specific sound tempo remains an explicit native fallback', () => {
  const xml = scoreXml(direction(metronome('quarter', 100)) + note + '<direction><direction-type><words>second pass</words></direction-type><sound tempo="60" time-only="2"/></direction>' + note.repeat(3));
  const prepared = prepareMusicXmlForAlphaTabBytes(bytes(xml));
  assert.equal(prepared.tempoMeasures[0].complete, false);
  const native = alphaTab.importer.ScoreLoader.loadScoreFromBytes(prepared.bytes, new alphaTab.Settings());
  assert.deepEqual(tempos(loadPreparedMusicXml(prepared, new alphaTab.Settings())), tempos(native));
});
