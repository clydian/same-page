// @vitest-environment node
import assert from 'node:assert/strict';
import { test } from 'vitest';
import * as alphaTab from '@coderline/alphatab';
import { loadMusicXml } from '@same-page/player/engine';

function source(accent: string, reversed: boolean) {
  const marks = reversed ? `<tenuto placement="above"/><${accent}/>` : `<${accent}/><tenuto placement="above"/>`;
  return `<score-partwise><part-list><score-part id="P"><part-name>Piano</part-name></score-part></part-list><part id="P"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><note><pitch><step>C</step><octave>5</octave></pitch><duration>2</duration><type>half</type><stem>up</stem><notations><articulations>${marks}</articulations></notations></note><note><pitch><step>D</step><octave>5</octave></pitch><duration>2</duration><type>half</type><stem>up</stem></note></measure></part></score-partwise>`;
}
function prepared(accent: string, reversed: boolean) {
  const score = loadMusicXml(new TextEncoder().encode(source(accent, reversed)), new alphaTab.Settings());
  assert.ok(score instanceof alphaTab.model.Score, 'player and renderer use one installed native module');
  return alphaTab.model.JsonConverter.jsObjectToScore(structuredClone(alphaTab.model.JsonConverter.scoreToJsObject(score)));
}
function render(score: alphaTab.model.Score, mode: alphaTab.LayoutMode) {
  const settings = new alphaTab.Settings();
  settings.core.engine = 'svg'; settings.core.enableLazyLoading = false;
  settings.display.staveProfile = alphaTab.StaveProfile.Score; settings.display.layoutMode = mode;
  const renderer = new alphaTab.rendering.ScoreRenderer(settings);
  renderer.width = 600;
  let svg = '';
  renderer.partialRenderFinished.on(e => { if (typeof e.renderResult === 'string') svg += e.renderResult; });
  renderer.error.on(error => { throw error; });
  try { renderer.renderScore(score, [0]); } finally { renderer.destroy(); }
  return svg;
}
function midi(score: alphaTab.model.Score) {
  const file = new alphaTab.midi.MidiFile();
  const generator = new alphaTab.midi.MidiFileGenerator(score, new alphaTab.Settings(), new alphaTab.midi.AlphaSynthMidiFileHandler(file));
  generator.generate();
  return { events: JSON.stringify(file.tracks.flatMap(t => t.events)), bounds: generator.tickLookup.masterBars.map(b => [b.start, b.end]) };
}
for (const mode of [alphaTab.LayoutMode.Page, alphaTab.LayoutMode.Horizontal]) {
  test(`installed dual articulation survives player and Worker JSON (${alphaTab.LayoutMode[mode]})`, () => {
    for (const accent of ['accent', 'strong-accent']) {
      const a = prepared(accent, false), b = prepared(accent, true);
      const notes = a.tracks[0].staves[0].bars[0].voices[0].beats.flatMap(beat => beat.notes);
      assert.equal(notes[0].isTenuto, true);
      assert.equal(notes[0].accentuated, accent === 'accent' ? alphaTab.model.AccentuationType.Normal : alphaTab.model.AccentuationType.Heavy);
      assert.equal(notes[1].isTenuto, false);
      const svg = render(a, mode);
      assert.equal((svg.match(/&#58532;/g) ?? []).length, 1);
      assert.equal((svg.match(new RegExp(`&#${accent === 'accent' ? alphaTab.model.MusicFontSymbol.ArticAccentBelow : alphaTab.model.MusicFontSymbol.ArticMarcatoBelow};`, 'g')) ?? []).length, 1);
      assert.equal(render(b, mode), svg);
      assert.deepEqual(midi(a), midi(b));
      assert.deepEqual(midi(a).bounds, [[0, 3840]]);
    }
  });
}
