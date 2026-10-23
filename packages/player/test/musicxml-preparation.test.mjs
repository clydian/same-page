import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { zipSync, strToU8 } from 'fflate';
import * as alphaTab from '@coderline/alphatab';
import { assignPlaybackChannels, loadPreparedMusicXml, preparePianoPlaybackMidi } from '../src/engine.ts';
import { prepareMusicXmlSource } from '../src/format.ts';
import { CURRENT_IMPORT_INPUT_VERSION, isCompatibleMusicXmlPreparation, prepareMusicXmlForAlphaTabBytes } from '../src/musicxml-direction-timing.ts';
import { IncompatibleMusicXmlPreparationError, musicXmlImportBytes, prepareMusicXmlForPlaybackBytes } from '../src/musicxml-preparation.ts';
import { normalizeMusicXmlRepeatEndings } from '../src/musicxml-repeat-endings.ts';
import { normalizeMusicXmlTransposedTies } from '../src/musicxml-transposed-ties.ts';

const encode = xml => new TextEncoder().encode(xml);
const attributes = '<attributes><divisions>1</divisions><time print-object="no"><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef><transpose><diatonic>-1</diatonic><chromatic>-2</chromatic></transpose></attributes>';
const note = (type = '') => `<note><pitch><step>D</step><octave>4</octave></pitch><duration>4</duration><type>whole</type>${type ? `<tie type="${type}"/><notations><tied type="${type}"/></notations>` : ''}</note>`;
const part = (id, endings) => `<part id="${id}"><measure number=" 0 " implicit="yes">${attributes}<barline location="left"><repeat direction="forward"/></barline><direction><direction-type><metronome><beat-unit>half</beat-unit><per-minute>40</per-minute></metronome></direction-type></direction><direction placement="above"><direction-type><words font-family="serif">dolce</words></direction-type><offset>0.5</offset></direction>${note('start')}</measure><measure number="1a">${endings ? '<barline location="left"><ending number="1" type="start"/></barline>' : ''}${note('stop')}<barline location="right">${endings ? '<ending number="1" type="stop"/>' : ''}<repeat direction="backward"/></barline></measure><measure number=" ">${endings ? '<barline location="left"><ending number="2" type="start"/></barline>' : ''}${note()}${endings ? '<barline location="right"><ending number="2" type="discontinue"/></barline>' : ''}</measure></part>`;
const repeated = encode(`<score-partwise xmlns="http://www.musicxml.org/ns/musicxml" version="4.0"><identification><creator type="composer">Composer</creator><creator type="arranger">Arranger</creator></identification><part-list><score-part id="P1"><part-name>Voice</part-name></score-part><score-part id="P2"><part-name>Piano</part-name></score-part></part-list>${part('P1', true)}${part('P2', false)}</score-partwise>`);

function midi(score) {
  const settings = new alphaTab.Settings(), file = new alphaTab.midi.MidiFile();
  assignPlaybackChannels(score.tracks);
  const generator = new alphaTab.midi.MidiFileGenerator(score, settings, new alphaTab.midi.AlphaSynthMidiFileHandler(file));
  generator.generate(); preparePianoPlaybackMidi(score, file, settings);
  return { events: file.tracks.map(track => track.events.map(event => ({ kind: event.constructor.name, ...event }))), route: generator.tickLookup.masterBars.map(bar => [bar.masterBar.index, bar.start, bar.end]) };
}

for (const name of ['hidden-time', 'offbeat-wedge-stop-grandstaff', 'offbeat-wedge-stop-single', 'gradual-word-same-mf', 'mixed-numbered-unnumbered-ties', 'native-paired-tremolo', 'native-paired-tremolo-control', 'custom-labels-ties-repeat']) {
  test(`complete preparation preserves legacy imported model and all MIDI events: ${name}`, () => {
    const bytes = name === 'custom-labels-ties-repeat' ? repeated : new Uint8Array(readFileSync(new URL(`./fixtures/${name}.musicxml`, import.meta.url)));
    const original = bytes.slice();
    const legacy = prepareMusicXmlForAlphaTabBytes(prepareMusicXmlSource(bytes));
    const expectedBytes = normalizeMusicXmlRepeatEndings(normalizeMusicXmlTransposedTies(legacy.bytes));
    const prepared = prepareMusicXmlForPlaybackBytes(bytes), snapshot = structuredClone(prepared);
    assert.equal(prepared.importInputVersion, CURRENT_IMPORT_INPUT_VERSION);
    assert.deepEqual(prepared.bytes, expectedBytes, 'direction, ties and repeat transformations retain their established order');
    assert.deepEqual({ ...prepared, bytes: legacy.bytes, importInputVersion: undefined }, { ...legacy, importInputVersion: undefined }, 'source metadata stays from the original direction pass');
    const oldScore = loadPreparedMusicXml(legacy, new alphaTab.Settings());
    const newScore = loadPreparedMusicXml(structuredClone(prepared), new alphaTab.Settings());
    assert.deepEqual(alphaTab.model.JsonConverter.scoreToJsObject(newScore), alphaTab.model.JsonConverter.scoreToJsObject(oldScore));
    assert.deepEqual(midi(newScore), midi(oldScore));
    loadPreparedMusicXml(prepared, new alphaTab.Settings());
    assert.deepEqual(prepared, snapshot, 'multiple sessions cannot mutate reusable preparation');
    assert.deepEqual(bytes, original, 'original attachment bytes remain intact');
  });
}

test('printed labels use only the first part, trim authored labels and preserve ordinal fallback', () => {
  assert.deepEqual(prepareMusicXmlForPlaybackBytes(repeated).measureLabels, ['0', '1a', '3']);
  const noMeasures = new TextDecoder().decode(repeated).replace(/<part id="P1">[\s\S]*?<\/part>/, '<part id="P1"/>');
  assert.deepEqual(prepareMusicXmlForPlaybackBytes(encode(noMeasures)).measureLabels, [], 'an empty first part does not select the later part');
  assert.deepEqual(prepareMusicXmlForAlphaTabBytes(encode('<score-partwise/>')).measureLabels, []);
});

test('MXL is validated and expanded by the same compiler without retaining compressed or intermediate inputs', () => {
  const mxl = zipSync({ 'META-INF/container.xml': strToU8('<container><rootfiles><rootfile full-path="score.musicxml"/></rootfiles></container>'), 'score.musicxml': repeated });
  const original = mxl.slice(), prepared = prepareMusicXmlForPlaybackBytes(mxl);
  assert.deepEqual(prepared, prepareMusicXmlForPlaybackBytes(repeated));
  assert.deepEqual(mxl, original);
  assert.equal(Object.values(prepared).filter(value => value instanceof Uint8Array).length, 1);
});

test('new input is imported directly, old unversioned payloads retain fallback, unknown versions reject explicitly', () => {
  const prepared = prepareMusicXmlForPlaybackBytes(repeated);
  assert.equal(musicXmlImportBytes(prepared), prepared.bytes, 'hot opens must not normalize again');
  const legacy = prepareMusicXmlForAlphaTabBytes(prepareMusicXmlSource(repeated));
  delete legacy.measureLabels;
  assert.equal(isCompatibleMusicXmlPreparation(legacy), true);
  assert.deepEqual(musicXmlImportBytes(legacy), prepared.bytes);
  const unknown = { ...prepared, importInputVersion: 'future-v2', bytes: new Uint8Array([0]) };
  assert.equal(isCompatibleMusicXmlPreparation(unknown), false);
  assert.throws(() => loadPreparedMusicXml(unknown, new alphaTab.Settings()), error => error instanceof IncompatibleMusicXmlPreparationError && error.code === 'INCOMPATIBLE_MUSICXML_PREPARATION');
});

test('the source preparation Worker returns only its own protocol and transfers final input', async () => {
  const previous = globalThis.self, messages = [];
  globalThis.self = { postMessage: (...args) => messages.push(args) };
  try {
    await import('../dist/prepare.worker.js');
    self.onmessage({ data: repeated });
    assert.equal(messages.length, 1, 'no native renderer/synth initialization side effects');
    assert.deepEqual(Object.keys(messages[0][0]), ['prepared']);
    const prepared = messages[0][0].prepared;
    assert.deepEqual(prepared, prepareMusicXmlForPlaybackBytes(repeated));
    assert.equal(messages[0][1].transfer[0], prepared.bytes.buffer);
    self.onmessage({ data: encode('not xml') });
    assert.deepEqual(Object.keys(messages[1][0]), ['error']);
    assert.equal(typeof messages[1][0].error, 'string');
  } finally { globalThis.self = previous; }
});
