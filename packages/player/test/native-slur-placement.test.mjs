import assert from 'node:assert/strict';
import test from 'node:test';
import * as alphaTab from '@coderline/alphatab';
import { loadMusicXml } from '../dist/engine.js';

// Owned one-bar input; no published score is embedded in this regression.
function source(placement) {
  const attr = placement ? ` placement="${placement}"` : '';
  return `<score-partwise version="4.0"><part-list><score-part id="P"><part-name>Tenor</part-name></score-part></part-list><part id="P"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line><clef-octave-change>-1</clef-octave-change></clef></attributes><note><pitch><step>G</step><octave>3</octave></pitch><duration>1</duration><type>quarter</type><notations><slur type="start" number="1"${attr}/></notations></note><note><pitch><step>A</step><octave>3</octave></pitch><duration>1</duration><type>quarter</type></note><note><pitch><step>B</step><octave>3</octave></pitch><duration>2</duration><type>half</type><notations><slur type="stop" number="1"${attr}/></notations></note></measure></part></score-partwise>`;
}
function render(placement, horizontal) {
  const settings = new alphaTab.Settings();
  settings.core.engine = 'svg'; settings.core.enableLazyLoading = false;
  settings.display.staveProfile = alphaTab.StaveProfile.Score;
  if (horizontal) settings.display.layoutMode = alphaTab.LayoutMode.Horizontal;
  const score = loadMusicXml(new TextEncoder().encode(source(placement)), settings);
  const copy = alphaTab.model.JsonConverter.jsObjectToScore(alphaTab.model.JsonConverter.scoreToJsObject(score));
  const origin = copy.tracks[0].staves[0].bars[0].voices[0].beats[0].notes[0];
  assert.equal(origin.slurPlacement, placement === 'above' ? alphaTab.model.SlurPlacement.Above : placement === 'below' ? alphaTab.model.SlurPlacement.Below : alphaTab.model.SlurPlacement.Automatic);
  const renderer = new alphaTab.rendering.ScoreRenderer(settings), svg = [], errors = [];
  renderer.width = 900;
  renderer.error.on(error => errors.push(error));
  renderer.partialRenderFinished.on(e => { if (typeof e.renderResult === 'string') svg.push(e.renderResult); });
  try { renderer.renderScore(copy, [0]); } finally { renderer.destroy(); }
  assert.deepEqual(errors, []); assert.ok(svg.length > 0);
  return [...svg.join('').matchAll(/<path\b[^>]*\bd="([^"]+)"/g)].map(m => m[1]);
}
for (const horizontal of [false, true]) {
  test(`installed native retains and draws slur placement across JSON (${horizontal ? 'Horizontal' : 'Page'})`, () => {
    assert.notDeepEqual(render('above', horizontal), render('below', horizontal));
    assert.deepEqual(render(undefined, horizontal), render('below', horizontal));
  });
}
