import assert from 'node:assert/strict';
import {test} from 'vitest';
import {readFileSync} from 'node:fs';
import * as at from '@coderline/alphatab';
import {loadMusicXml, assignPlaybackChannels, preparePianoPlaybackMidi} from '@clydian/chorus-player/engine';

// All fixtures here are short, independently authored controls, not score extracts.
const scoreXml = measures => `<score-partwise version="4.0"><part-list><score-part id="P"><part-name>Piano</part-name></score-part></part-list><part id="P">${measures}</part></score-partwise>`;
const attrs = '<attributes><divisions>1</divisions><time><beats>1</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>';
const note = (step, octave, extra = '', chord = false) => `<note>${chord ? '<chord/>' : ''}<pitch><step>${step}</step><octave>${octave}</octave></pitch><duration>1</duration><type>quarter</type>${extra}</note>`;
function capture(xml, layout = at.LayoutMode.Page) {
  const settings = new at.Settings();
  settings.core.engine = 'svg';
  settings.core.enableLazyLoading = false;
  settings.display.staveProfile = at.StaveProfile.Score;
  settings.display.layoutMode = layout;
  const imported = loadMusicXml(new TextEncoder().encode(xml), settings);
  assignPlaybackChannels(imported.tracks);
  const score = at.model.JsonConverter.jsonToScore(at.model.JsonConverter.scoreToJson(imported));
  const renderer = new at.rendering.ScoreRenderer(settings);
  renderer.width = 1200;
  const pieces = [];
  renderer.error.on(error => { throw error; });
  renderer.partialRenderFinished.on(event => {
    if (typeof event.renderResult === 'string') pieces.push(event.renderResult);
  });
  try { renderer.renderScore(score, [0]); } finally { renderer.destroy(); }
  const file = new at.midi.MidiFile();
  const generator = new at.midi.MidiFileGenerator(score, settings, new at.midi.AlphaSynthMidiFileHandler(file));
  generator.applyTranspositionPitches = false;
  generator.generate();
  preparePianoPlaybackMidi(score, file, settings);
  const events = file.tracks.flatMap(track => track.events);
  const selected = kind => events.filter(event => event.constructor.name === kind).map(event => [event.tick, event.noteKey]);
  const svg = pieces.join('').replace(/&#x([0-9a-f]+);/gi, (_, value) => String.fromCodePoint(parseInt(value, 16))).replace(/&#(\d+);/g, (_, value) => String.fromCodePoint(+value));
  return {score, svg, on: selected('NoteOnEvent'), off: selected('NoteOffEvent'), bounds: generator.tickLookup.masterBars.map(bar => [bar.start, bar.end])};
}

for (const layout of [at.LayoutMode.Page, at.LayoutMode.Horizontal]) {
  test(`shared chord staccato shortens every member with one printed dot (${at.LayoutMode[layout]})`, () => {
    const got = capture(scoreXml(`<measure number="1">${attrs}${note('C', 5, '<notations><articulations><staccato/></articulations></notations>')}${note('E', 5, '', true)}${note('G', 5, '', true)}</measure>`), layout);
    assert.deepEqual(got.off, [[480, 72], [480, 76], [480, 79]]);
    assert.equal((got.svg.match(/[\uE4A2\uE4A3]/g) ?? []).length, 1);
  });
  test(`mordent uses the source whole step after Worker JSON (${at.LayoutMode[layout]})`, () => {
    const got = capture(scoreXml(`<measure number="1">${attrs}${note('B', 4, '<notations><ornaments><mordent/></ornaments></notations>')}</measure>`), layout);
    assert.deepEqual(got.on.map(event => event[1]), [71, 69, 71]);
  });
  test(`unchanged fifths do not print extra keys for mode changes (${at.LayoutMode[layout]})`, () => {
    const initial = attrs.replace('<beats>1</beats>', '<beats>2</beats>').replace('</attributes>', '<key><fifths>2</fifths><mode>major</mode></key></attributes>');
    const got = capture(scoreXml(`<measure number="1">${initial}${note('A', 4)}<attributes><key><fifths>2</fifths><mode>minor</mode></key></attributes>${note('A', 4)}</measure>`), layout);
    assert.equal((got.svg.match(/\uE262/g) ?? []).length, 2);
    assert.equal(got.score.tracks[0].staves[0].bars[0].notationChanges?.[0]?.keySignatureType, at.model.KeySignatureType.Minor);
  });
  test(`paired tremolo keeps the complete alternating sequence and three beams (${at.LayoutMode[layout]})`, () => {
    const paired = readFileSync(new URL('./native-source-fixtures/native-paired-tremolo.musicxml', import.meta.url), 'utf8');
    const explicit = readFileSync(new URL('./native-source-fixtures/native-paired-tremolo-control.musicxml', import.meta.url), 'utf8');
    const got = capture(paired, layout), control = capture(explicit, layout);
    assert.deepEqual(got.on, control.on);
    assert.deepEqual(got.off, control.off);
    assert.deepEqual(got.bounds, control.bounds);
    assert.equal(got.on.length, 36);
    assert.equal((got.svg.match(/<path d=" M[^"z]+z"/g) ?? []).length, 3);
    assert.ok(!got.svg.includes('2:1'));
    assert.equal((got.svg.match(/\uE882/g) ?? []).length, 0, 'No SMuFL tuplet digit 2 from the tremolo ratio');
  });
}
test('an explicit secondary tie survives shared chord staccato', () => {
  const xml = scoreXml(`<measure number="1">${attrs}${note('C', 5, '<notations><articulations><staccato/></articulations></notations>')}${note('E', 5, '<notations><tied type="start"/></notations>', true)}</measure><measure number="2">${note('E', 5, '<notations><tied type="stop"/></notations>')}</measure>`);
  const got = capture(xml);
  assert.deepEqual(got.on, [[0, 72], [0, 76]]);
  assert.deepEqual(got.off, [[480, 72], [1920, 76]]);
});
test('bar-end clef stays at the end and becomes the following bar context', () => {
  const initial = attrs.replace('<sign>G</sign><line>2</line>', '<sign>F</sign><line>4</line>');
  const got = capture(scoreXml(`<measure number="1">${initial}${note('G', 2)}<attributes><clef><sign>G</sign><line>2</line></clef></attributes></measure><measure number="2">${note('G', 4)}</measure>`));
  const bars = got.score.tracks[0].staves[0].bars;
  assert.equal(bars[0].clef, at.model.Clef.F4);
  assert.equal(bars[0].notationChanges?.[0]?.clef, at.model.Clef.G2);
  assert.equal(bars[1].clef, at.model.Clef.G2);
  assert.deepEqual(got.on, [[0, 43], [960, 67]]);
});
test('an octave line on staff1 leaves staff2 written height and sound unchanged', () => {
  const xml = scoreXml(`<measure number="1"><attributes><divisions>1</divisions><time><beats>1</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>G</sign><line>2</line></clef></attributes><direction><direction-type><octave-shift type="down" size="8"/></direction-type><staff>1</staff></direction><note><pitch><step>C</step><octave>6</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><staff>1</staff></note><backup><duration>1</duration></backup><note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><voice>2</voice><type>quarter</type><staff>2</staff></note></measure>`);
  const got = capture(xml);
  const lower = got.score.tracks[0].staves[1].bars[0].voices.flatMap(voice => voice.beats).flatMap(beat => beat.notes)[0];
  assert.equal(lower.realValue, 60);
  assert.equal(lower.displayValue, 60);
  assert.deepEqual(got.on.map(event => event[1]).sort((a, b) => a - b), [60, 84]);
});
