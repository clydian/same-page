import assert from 'node:assert/strict';
import { test } from 'vitest';
import * as alphaTab from '@coderline/alphatab';
import { loadMusicXml, loadPreparedMusicXml } from '@clydian/chorus-player/engine';
import { prepareMusicXmlForAlphaTabBytes } from '@clydian/chorus-player/musicxml-direction-timing';

const time = (hidden: boolean, numerator: number, number = '') => `<time${number ? ` number="${number}"` : ''}${hidden ? ' print-object="no"' : ''}><beats>${numerator}</beats><beat-type>4</beat-type></time>`;
function source(middle = time(true, 3)) {
  const measures = [time(false, 4), middle, time(false, 4)].map((meter, index) => `<measure number="${index + 1}"><attributes><divisions>1</divisions><staves>2</staves>${meter}<clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>${index === 1 ? 3 : 4}</duration><voice>1</voice><type>${index === 1 ? 'half' : 'whole'}</type>${index === 1 ? '<dot/>' : ''}<staff>1</staff></note><backup><duration>${index === 1 ? 3 : 4}</duration></backup><note><pitch><step>C</step><octave>3</octave></pitch><duration>${index === 1 ? 3 : 4}</duration><voice>2</voice><type>${index === 1 ? 'half' : 'whole'}</type>${index === 1 ? '<dot/>' : ''}<staff>2</staff></note></measure>`).join('');
  return new TextEncoder().encode(`<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1">${measures}</part></score-partwise>`);
}
function timeline(score: alphaTab.model.Score) {
  const midi = new alphaTab.midi.MidiFile();
  const generator = new alphaTab.midi.MidiFileGenerator(score, new alphaTab.Settings(), new alphaTab.midi.AlphaSynthMidiFileHandler(midi));
  generator.generate();
  return { events: midi.tracks.map(track => track.events.map(event => JSON.stringify(event))), ticks: generator.tickLookup.masterBars.map(bar => [bar.start, bar.end]) };
}
const isHidden = (score: alphaTab.model.Score, staff: number, bar: number) => score.tracks[0].staves[staff].bars[bar].style?.colors.get(alphaTab.model.BarSubElement.StandardNotationTimeSignature)?.a === 0;

test('installed artifact honors source-hidden meter through preparation Worker transfer without changing MIDI or ticks', () => {
  const bytes = source();
  const original = bytes.slice();
  const settings = new alphaTab.Settings();
  const native = alphaTab.importer.ScoreLoader.loadScoreFromBytes(bytes, settings);
  assert.equal(isHidden(native, 0, 1), false, 'control reaches native visibility defect');
  const prepared = prepareMusicXmlForAlphaTabBytes(bytes);
  const transferred = structuredClone(prepared, { transfer: [prepared.bytes.buffer] });
  assert.equal(prepared.bytes.byteLength, 0);
  const actual = loadPreparedMusicXml(transferred, settings);
  for (const staff of [0, 1]) {
    assert.equal(isHidden(actual, staff, 1), true);
    assert.equal(isHidden(actual, staff, 0), false);
    assert.equal(isHidden(actual, staff, 2), false);
  }
  // Compare with the same preparation/dynamics pipeline and only paint disabled.
  // Raw alphaTab has a different default unmarked velocity from the shared player.
  const control = prepareMusicXmlForAlphaTabBytes(bytes);
  control.timeVisibility = { partIds: [], parts: [] };
  assert.deepEqual(timeline(actual), timeline(loadPreparedMusicXml(control, settings)));
  assert.deepEqual(bytes, original);
});

test('installed artifact keeps explicitly visible numbered staff and serialized renderer style', () => {
  const settings = new alphaTab.Settings();
  const score = loadMusicXml(source(time(true, 3) + time(false, 3, '2')), settings);
  const restored = alphaTab.model.JsonConverter.jsonToScore(alphaTab.model.JsonConverter.scoreToJson(score), settings);
  assert.equal(isHidden(restored, 0, 1), true);
  assert.equal(isHidden(restored, 1, 1), false);
});

test('older prepared payload falls back to actual source time visibility', () => {
  const prepared = prepareMusicXmlForAlphaTabBytes(source());
  delete prepared.timeVisibility;
  assert.equal(isHidden(loadPreparedMusicXml(prepared, new alphaTab.Settings()), 0, 1), true);
});
