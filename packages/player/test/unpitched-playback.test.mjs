import assert from 'node:assert/strict';
import test from 'node:test';
import * as at from '@coderline/alphatab';
import { loadMusicXml, assignPlaybackChannels } from '../src/engine.ts';

const declaration = (id, mapping = '') => `<score-instrument id="${id}"><instrument-name>Voice</instrument-name></score-instrument><midi-instrument id="${id}"><midi-channel>1</midi-channel><midi-program>1</midi-program>${mapping}</midi-instrument>`;
const pitched = '<note><pitch><step>C</step><octave>-1</octave></pitch><duration>1</duration><type>quarter</type></note>';
const spoken = (instrument = '', chord = '') => `<note>${chord}<unpitched><display-step>B</display-step><display-octave>4</display-octave></unpitched><duration>1</duration>${instrument ? `<instrument id="${instrument}"/>` : ''}<type>quarter</type><notehead>x</notehead><lyric><text>下</text></lyric></note>`;
const source = (notes, declarations = declaration('V')) => `<score-partwise version="4.0"><part-list><score-part id="P"><part-name>Voice</part-name>${declarations}</score-part></part-list><part id="P"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>${notes}</measure></part></score-partwise>`;
const load = xml => { const score = loadMusicXml(new TextEncoder().encode(xml), new at.Settings()); assignPlaybackChannels(score.tracks); return score; };
const notes = score => score.tracks.flatMap(t => t.staves.flatMap(s => s.bars.flatMap(b => b.voices.flatMap(v => v.beats.flatMap(b => b.notes)))));
function midi(score) {
  const file = new at.midi.MidiFile();
  const gen = new at.midi.MidiFileGenerator(score, new at.Settings(), new at.midi.AlphaSynthMidiFileHandler(file));
  gen.applyTranspositionPitches = false; gen.generate();
  return { events: file.tracks.flatMap(t => t.events), bounds: gen.tickLookup.masterBars.map(b => [b.start, b.end]) };
}
const attacks = result => result.events.filter(e => e instanceof at.midi.NoteOnEvent).map(e => [e.tick, e.noteKey]);

for (const clone of [false, true]) test(`unmapped spoken note stays visible and timed, real MIDI 0 still plays (clone=${clone})`, () => {
  const original = load(source(pitched + spoken() + pitched + pitched));
  const score = clone ? at.model.JsonConverter.jsonToScore(at.model.JsonConverter.scoreToJson(original)) : original;
  assert.equal(notes(score).length, 4);
  assert.equal(notes(score)[1].isVisible, true);
  assert.equal(notes(score)[1].isCue, false);
  assert.deepEqual(attacks(midi(score)), [[0, 0], [1920, 0], [2880, 0]]);
  assert.deepEqual(midi(score).bounds, [[0, 3840]]);
  assert.equal(score.tracks[0].staves[0].bars[0].voices[0].beats[1].lyrics[0], '下');
});

for (const [value, key] of [[1, 0], [39, 38], ['+39', 38], [128, 127]]) {
  for (const explicit of [false, true]) test(`declared unpitched mapping ${value} plays ${key}, instrument reference=${explicit}`, () => {
    const score = load(source(spoken(explicit ? 'V' : '') + pitched + pitched + pitched, declaration('V', `<midi-unpitched>${value}</midi-unpitched>`)));
    assert.deepEqual(attacks(midi(score)), [[0, key], [960, 0], [1920, 0], [2880, 0]]);
  });
}

for (const mapping of ['', '0', '129', '38oops']) test(`unmapped/invalid sound ${JSON.stringify(mapping)} does not invent a pitch`, () => {
  const score = load(source(spoken('V') + pitched + pitched + pitched, declaration('V', mapping ? `<midi-unpitched>${mapping}</midi-unpitched>` : '')));
  assert.deepEqual(attacks(midi(score)), [[960, 0], [1920, 0], [2880, 0]]);
});

test('muting an unmapped member preserves a simultaneous mapped member', () => {
  const score = load(source(spoken('V') + spoken('D', '<chord/>') + pitched + pitched + pitched,
    declaration('V') + declaration('D', '<midi-unpitched>39</midi-unpitched>')));
  assert.equal(notes(score).length, 5);
  assert.deepEqual(attacks(midi(score)), [[0, 38], [960, 0], [1920, 0], [2880, 0]]);
});

for (const layout of [at.LayoutMode.Page, at.LayoutMode.Horizontal]) test(`silent notation engraves identically to its mapped control (layout=${layout})`, () => {
  function render(xml) {
    const settings = new at.Settings();
    settings.core.engine = 'svg'; settings.core.enableLazyLoading = false;
    settings.display.layoutMode = layout; settings.display.staveProfile = at.StaveProfile.Score;
    const score = at.model.JsonConverter.jsonToScore(at.model.JsonConverter.scoreToJson(load(xml)));
    const renderer = new at.rendering.ScoreRenderer(settings); renderer.width = 1000;
    const pieces = []; renderer.error.on(error => { throw error; });
    renderer.partialRenderFinished.on(event => { if (typeof event.renderResult === 'string') pieces.push(event.renderResult); });
    try { renderer.renderScore(score, [0]); } finally { renderer.destroy(); }
    return pieces.join('');
  }
  const unmapped = source(spoken('V') + pitched + pitched + pitched);
  const mapped = source(spoken('V') + pitched + pitched + pitched, declaration('V', '<midi-unpitched>39</midi-unpitched>'));
  const svg = render(unmapped);
  assert.ok(svg.length > 1000);
  assert.deepEqual(svg, render(mapped));
});
