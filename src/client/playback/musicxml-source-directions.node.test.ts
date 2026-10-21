import assert from 'node:assert/strict';
import { test } from 'vitest';
import * as alphaTab from '@coderline/alphatab';
import { loadMusicXml, loadPreparedMusicXml } from '@same-page/player/engine';
import { prepareMusicXmlForAlphaTabBytes } from '@same-page/player/musicxml-direction-timing';

const note = '<note><pitch><step>C</step><octave>5</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type></note>';
const words = (text: string, placement: string) => `<direction placement="${placement}"><direction-type><words>${text}</words></direction-type></direction>`;
function source(placement = 'above', instructions = '') {
  return `<score-partwise version="4.0"><part-list><score-part id="P"><part-name>Voice</part-name></score-part></part-list><part id="P"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>${instructions}<direction placement="${placement}"><direction-type><wedge type="diminuendo" number="1"/></direction-type><offset>0.5</offset></direction><direction placement="${placement}"><direction-type><wedge type="stop" number="1"/></direction-type><offset>2.5</offset></direction>${note.repeat(4)}</measure></part></score-partwise>`;
}
const bytes = (xml: string) => new TextEncoder().encode(xml);
function svg(score: alphaTab.model.Score, hideText = false) {
  const settings = new alphaTab.Settings(); settings.core.engine = 'svg'; settings.core.enableLazyLoading = false;
  settings.display.staveProfile = alphaTab.StaveProfile.Score;
  if (hideText) settings.notation.elements.set(alphaTab.NotationElement.EffectText, false);
  const renderer = new alphaTab.rendering.ScoreRenderer(settings), pieces: string[] = []; renderer.width = 800;
  renderer.error.on(error => { throw error; });
  renderer.partialRenderFinished.on(event => { if (typeof event.renderResult === 'string') pieces.push(event.renderResult); });
  try { renderer.renderScore(score, [0]); return pieces.join(''); } finally { renderer.destroy(); }
}
test('installed package preserves simultaneous source above/below text and authored wedge placement', () => {
  const xml = source('above', words('LAUGH_GROUP', 'above') + words('SING_GROUP', 'below'));
  const score = loadMusicXml(bytes(xml), new alphaTab.Settings()), bar = score.tracks[0].staves[0].bars[0];
  assert.equal(bar.sourceTexts?.length, 2); assert.equal(bar.sourceWedges?.length, 1);
  const output = svg(score); assert.match(output, /LAUGH_GROUP/); assert.match(output, /SING_GROUP/);
  const y = (text: string) => Number(output.match(new RegExp(`y="([^" ]+)"[^>]*>${text}</text>`))?.[1]);
  assert.ok(y('LAUGH_GROUP') < y('SING_GROUP'));
  assert.notEqual(output, svg(loadMusicXml(bytes(xml.replaceAll('placement="above"', 'placement="below"')), new alphaTab.Settings())));
});
test('source wedge uses exact offbeat display coordinates without inserting a beat or quantizing to attacks', () => {
  const score = loadMusicXml(bytes(source()), new alphaTab.Settings()), bar = score.tracks[0].staves[0].bars[0];
  assert.deepEqual(bar.sourceWedges?.map(w => [w.displayStart, w.displayEnd]), [[480, 2400]]);
  assert.equal(bar.voices[0].beats.length, 4);
  assert.deepEqual(bar.voices[0].beats.map(b => [b.playbackStart, b.playbackDuration]), [[0, 960], [960, 960], [1920, 960], [2880, 960]]);
});
test('structuredClone prepared metadata retains multiple directions while old payloads keep the legacy path', () => {
  const prepared = prepareMusicXmlForAlphaTabBytes(bytes(source('above', words('FIRST', 'above') + words('SECOND', 'above'))));
  const score = loadPreparedMusicXml(structuredClone(prepared), new alphaTab.Settings());
  assert.equal(score.tracks[0].staves[0].bars[0].sourceTexts?.length, 2);
  const legacy = { ...prepared }; delete legacy.wordEventsByPart; delete legacy.wedgeEventsByPart;
  const old = loadPreparedMusicXml(legacy, new alphaTab.Settings());
  assert.equal(old.tracks[0].staves[0].bars[0].sourceTexts, null);
  assert.equal(old.tracks[0].staves[0].bars[0].sourceWedges, null);
});
test('independent same-lane words are not overwritten and global text hiding still applies', () => {
  const score = loadMusicXml(bytes(source('above', words('FIRST', 'above') + words('SECOND', 'above'))), new alphaTab.Settings());
  assert.match(svg(score), /FIRST/); assert.match(svg(score), /SECOND/);
  assert.doesNotMatch(svg(score, true), /FIRST|SECOND/);
});
test('unsupported font-family preserves the previous complete-part words renderer rather than a partial projection', () => {
  const xml = source('above', '<direction><direction-type><words font-family="Unsupported Custom Font">TEXT</words></direction-type></direction>');
  const score = loadMusicXml(bytes(xml), new alphaTab.Settings());
  assert.equal(score.tracks[0].staves[0].bars[0].sourceTexts, null); assert.match(svg(score), /TEXT/);
});
