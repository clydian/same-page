import assert from 'node:assert/strict';
import { test } from 'vitest';
import * as alphaTab from '@coderline/alphatab';
import { loadMusicXml, loadPreparedMusicXml } from '@clydian/chorus-player/engine';
import { prepareMusicXmlForAlphaTabBytes } from '@clydian/chorus-player/musicxml-direction-timing';

const mixedTies = `<score-partwise version="4.0"><part-list><score-part id="T"><part-name>Tenor</part-name></score-part></part-list><part id="T"><measure number="1"><attributes><divisions>2</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line><clef-octave-change>-1</clef-octave-change></clef></attributes><note><pitch><step>G</step><octave>3</octave></pitch><duration>4</duration><tie type="start"/><voice>1</voice><type>half</type><notations><tied type="start" number="1"/></notations></note><note><pitch><step>G</step><octave>3</octave></pitch><duration>1</duration><tie type="stop"/><voice>1</voice><type>eighth</type><notations><tied type="stop" number="1"/></notations></note><note><rest/><duration>3</duration><voice>1</voice><type>quarter</type><dot/></note></measure><measure number="2"><note><pitch><step>G</step><octave>3</octave></pitch><duration>8</duration><tie type="start"/><voice>1</voice><type>whole</type><notations><tied type="start"/></notations></note></measure><measure number="3"><note><pitch><step>G</step><octave>3</octave></pitch><duration>4</duration><tie type="stop"/><voice>1</voice><type>half</type><notations><tied type="stop"/></notations></note><note><rest/><duration>4</duration><voice>1</voice><type>half</type></note></measure></part></score-partwise>`;
function attacks(score: alphaTab.model.Score) {
  const result: number[][] = [];
  class Handler extends alphaTab.midi.AlphaSynthMidiFileHandler {
    override addNote(track: number, start: number, length: number, key: number) { result.push([track, start, length, key]); }
  }
  new alphaTab.midi.MidiFileGenerator(score, new alphaTab.Settings(), new Handler(new alphaTab.midi.MidiFile())).generate();
  return result;
}
function importedVariants(text: string) {
  const bytes = new TextEncoder().encode(text), original = bytes.slice();
  const result = [loadMusicXml(bytes, new alphaTab.Settings()), loadPreparedMusicXml(structuredClone(prepareMusicXmlForAlphaTabBytes(bytes)), new alphaTab.Settings())];
  assert.deepEqual(bytes, original);
  return result;
}
test('installed mixed numbered and unnumbered ties retain two separate source attacks and durations', () => {
  for (const score of importedVariants(mixedTies)) assert.deepEqual(attacks(score), [[0, 0, 2400, 55], [0, 3840, 5760, 55]]);
});
test('installed tied-grace fallback cannot extend a preceding completed ordinary tie', () => {
  const text = mixedTies.replace(/(<tied[^>]*) number="1"/g, '$1').replace(/<measure number="2">[\s\S]*?<\/measure>/, '<measure number="2"><note><grace/><pitch><step>G</step><octave>3</octave></pitch><tie type="stop"/><voice>1</voice><type>eighth</type><notations><tied type="stop"/></notations></note><note><pitch><step>A</step><octave>3</octave></pitch><duration>8</duration><voice>1</voice><type>whole</type></note></measure>').replace(/<measure number="3">[\s\S]*?<\/measure>/, '');
  for (const score of importedVariants(text)) assert.deepEqual(attacks(score), [[0, 0, 2400, 55], [0, 3840, 120, 55], [0, 3960, 3720, 57]]);
});
const upper = '<note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration><voice>1</voice><type>whole</type><staff>1</staff></note>';
const glyphXml = `<score-partwise version="4.0"><part-list><score-part id="P"><part-name>Piano</part-name></score-part></part-list><part id="P"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><direction><direction-type><dynamics><f/></dynamics></direction-type><staff>1</staff></direction>${upper}</measure><measure number="2">${upper}<backup><duration>4</duration></backup><note><rest/><duration>1</duration><voice>2</voice><type>quarter</type></note><note><pitch><step>E</step><octave>4</octave></pitch><duration>3</duration><voice>2</voice><type>half</type><dot/></note></measure></part></score-partwise>`;
function forteCount(score: alphaTab.model.Score) {
  const settings = new alphaTab.Settings(); settings.core.engine = 'svg'; settings.core.enableLazyLoading = false;
  const renderer = new alphaTab.rendering.ScoreRenderer(settings), pieces: string[] = []; renderer.width = 1000;
  renderer.partialRenderFinished.on(event => { if (typeof event.renderResult === 'string') pieces.push(event.renderResult); });
  renderer.error.on(error => { throw error; });
  try { renderer.renderScore(score, [0]); return pieces.join('').split(`&#${alphaTab.model.MusicFontSymbol.DynamicForte};`).length - 1; } finally { renderer.destroy(); }
}
test('installed source glyph prints once while legacy prepared metadata retains its compatible marker path', () => {
  const prepared = structuredClone(prepareMusicXmlForAlphaTabBytes(new TextEncoder().encode(glyphXml)));
  const legacy = { ...prepared, dynamicGlyphsCompleteByPart: undefined };
  const currentScore = loadPreparedMusicXml(prepared, new alphaTab.Settings()), legacyScore = loadPreparedMusicXml(legacy, new alphaTab.Settings());
  assert.equal(forteCount(currentScore), 1);
  assert.equal(forteCount(legacyScore), 2);
  assert.deepEqual(attacks(currentScore), attacks(legacyScore));
});
