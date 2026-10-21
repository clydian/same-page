import assert from 'node:assert/strict';
import test from 'node:test';
import * as alphaTab from '@coderline/alphatab';
import { loadMusicXml } from '../dist/engine.js';

// Owned input, independent of published score content.
function source(placement, stem = 'up') {
  const attr = placement ? ` placement="${placement}"` : '';
  return `<score-partwise version="4.0"><part-list><score-part id="P"><part-name>Piano</part-name></score-part></part-list><part id="P"><measure number="1"><attributes><divisions>1</divisions><time><beats>2</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><note><pitch><step>C</step><octave>5</octave></pitch><duration>2</duration><type>half</type><stem>${stem}</stem><notations><articulations><tenuto${attr}/></articulations></notations></note></measure></part></score-partwise>`;
}
function render(placement, horizontal, stem = 'up') {
  const settings = new alphaTab.Settings();
  settings.core.engine = 'svg'; settings.core.enableLazyLoading = false;
  settings.display.staveProfile = alphaTab.StaveProfile.Score;
  if (horizontal) settings.display.layoutMode = alphaTab.LayoutMode.Horizontal;
  const score = loadMusicXml(new TextEncoder().encode(source(placement, stem)), settings);
  const copy = alphaTab.model.JsonConverter.jsObjectToScore(alphaTab.model.JsonConverter.scoreToJsObject(score));
  const note = copy.tracks[0].staves[0].bars[0].voices[0].beats[0].notes[0];
  assert.equal(note.tenutoPlacement, placement === 'above' ? 1 : placement === 'below' ? 2 : 0);
  const renderer = new alphaTab.rendering.ScoreRenderer(settings), svg = [], errors = [];
  renderer.width = 600;
  renderer.error.on(error => errors.push(error));
  renderer.partialRenderFinished.on(e => { if (typeof e.renderResult === 'string') svg.push(e.renderResult); });
  try { renderer.renderScore(copy, [0]); } finally { renderer.destroy(); }
  assert.deepEqual(errors, []); assert.ok(svg.length > 0);
  const text = svg.join('');
  return { above: text.includes('&#58532;'), below: text.includes('&#58533;') };
}
for (const horizontal of [false, true]) {
  test(`installed native tenuto placement survives JSON and selects default glyph (${horizontal ? 'Horizontal' : 'Page'})`, () => {
    for (const stem of ['up', 'down']) {
      assert.deepEqual(render('above', horizontal, stem), { above: true, below: false });
      assert.deepEqual(render('below', horizontal, stem), { above: false, below: true });
    }
    assert.deepEqual(render(undefined, horizontal), { above: false, below: true });
  });
}
