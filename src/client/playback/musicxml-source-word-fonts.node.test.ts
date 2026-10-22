import assert from 'node:assert/strict';
import { test } from 'vitest';
import * as alphaTab from '@coderline/alphatab';
import { loadMusicXml, loadPreparedMusicXml } from '@same-page/player/engine';
import { prepareMusicXmlForAlphaTabBytes } from '@same-page/player/musicxml-direction-timing';

const xml = (family = 'serif') => new TextEncoder().encode(`<score-partwise version="4.0"><part-list><score-part id="P"><part-name>Soprano</part-name></score-part></part-list><part id="P"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>${['SOLO or Div.', 'gently'].map(text => `<direction placement="above"><direction-type><words font-family="${family}" font-size="9" font-style="italic">${text}</words></direction-type></direction>`).join('')}<note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration><type>whole</type></note></measure></part></score-partwise>`);
function render(score: alphaTab.model.Score, mode: alphaTab.LayoutMode) {
  const settings = new alphaTab.Settings(); settings.core.engine = 'svg'; settings.core.enableLazyLoading = false;
  settings.display.staveProfile = alphaTab.StaveProfile.Score; settings.display.layoutMode = mode;
  const renderer = new alphaTab.rendering.ScoreRenderer(settings), pieces: string[] = []; renderer.width = 800;
  renderer.error.on(error => { throw error; });
  renderer.partialRenderFinished.on(event => { if (typeof event.renderResult === 'string') pieces.push(event.renderResult); });
  try { renderer.renderScore(score, [0]); return pieces.join(''); } finally { renderer.destroy(); }
}
test('installed font-family source words survive cloned preparation, Worker JSON and both actual layouts', () => {
  const bytes = xml(), before = bytes.slice(), prepared = structuredClone(prepareMusicXmlForAlphaTabBytes(bytes));
  assert.ok(prepared.wordEventsByPart?.[0], 'a supported serif family must not force complete-part legacy fallback');
  const settings = new alphaTab.Settings(), loaded = loadPreparedMusicXml(prepared, settings);
  const score = alphaTab.model.JsonConverter.jsObjectToScore(alphaTab.model.JsonConverter.scoreToJsObject(loaded), settings);
  assert.deepEqual(score.tracks[0].staves[0].bars[0].sourceTexts?.map(text => [text.text, text.displayStart, text.placement, text.fontSize, text.italic, text.fontFamilies]), [
    ['SOLO or Div.', 0, alphaTab.model.SourceTextPlacement.Above, 12, true, ['serif']],
    ['gently', 0, alphaTab.model.SourceTextPlacement.Above, 12, true, ['serif']],
  ]);
  for (const mode of [alphaTab.LayoutMode.Page, alphaTab.LayoutMode.Horizontal]) {
    const output = render(score, mode); assert.match(output, /SOLO or Div\./); assert.match(output, /gently/);
    assert.match(output, /font:italic 12px serif/);
  }
  assert.deepEqual(bytes, before);
});
test('unsupported named font still preserves the complete legacy part atomically', () => {
  const bytes = xml('Unsupported Custom Font'), prepared = prepareMusicXmlForAlphaTabBytes(bytes);
  assert.equal(prepared.wordEventsByPart?.[0], null);
  assert.equal(loadMusicXml(bytes, new alphaTab.Settings()).tracks[0].staves[0].bars[0].sourceTexts, null);
});
