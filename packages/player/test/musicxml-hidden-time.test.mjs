import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import * as at from '@coderline/alphatab';
import { zipSync, strToU8 } from 'fflate';
import { loadMusicXml, loadPreparedMusicXml } from '../src/engine.ts';
import { prepareMusicXmlForAlphaTabBytes } from '../src/musicxml-direction-timing.ts';
import { applyMusicXmlTimeVisibility, readMusicXmlTimeVisibility } from '../src/musicxml-hidden-time.ts';
const source = fs.readFileSync(new URL('./fixtures/hidden-time.musicxml', import.meta.url), 'utf8');
const bytes = xml => new TextEncoder().encode(xml);
const settings = () => { const s = new at.Settings(); s.core.engine = 'svg'; s.core.enableLazyLoading = false; s.display.staveProfile = at.StaveProfile.Score; return s; };
const load = xml => loadMusicXml(bytes(xml), settings());
const hidden = (score, staff = 0, bar = 1, track = 0) => score.tracks[track].staves[staff].bars[bar].style?.colors.get(at.model.BarSubElement.StandardNotationTimeSignature)?.a === 0;
function render(score) {
  const renderer = new at.rendering.ScoreRenderer(settings()); renderer.width = 1200;
  const pieces = []; renderer.partialRenderFinished.on(e => { if (typeof e.renderResult === 'string') pieces.push(e.renderResult); });
  renderer.error.on(error => { throw error; }); renderer.renderScore(score, score.tracks.map(track => track.index)); renderer.destroy(); return pieces.join('\n');
}
const visibleThrees = svg => (svg.match(/<text(?![^>]*rgba\(0,0,0,0\))[^>]*>\&\#57475;<\/text>/g) ?? []).length;
function timeline(score) {
  const file = new at.midi.MidiFile();
  const generator = new at.midi.MidiFileGenerator(score, settings(), new at.midi.AlphaSynthMidiFileHandler(file)); generator.generate();
  return { events: file.tracks.map(track => track.events.map(event => JSON.stringify(event))), ticks: generator.tickLookup.masterBars.map(bar => [bar.start, bar.end]) };
}
test('native red control and source-hidden meter paint: both staves, visible 4/4 restored, exact MIDI/ticks', () => {
  const input = bytes(source), original = input.slice();
  const native = at.importer.ScoreLoader.loadScoreFromBytes(input, settings());
  assert.equal(visibleThrees(render(native)), 2, 'control reaches native defect');
  const score = loadMusicXml(input, settings());
  const svg = render(score);
  assert.equal(visibleThrees(svg), 0);
  assert.equal((svg.match(/<text(?![^>]*rgba\(0,0,0,0\))[^>]*>\&\#57476;<\/text>/g) ?? []).length,8,'both visible 4/4 controls remain painted');
  assert.deepEqual(score.masterBars.map(bar => [bar.timeSignatureNumerator, bar.timeSignatureDenominator]), [[4,4],[3,4],[4,4]]);
  for (const staff of [0,1]) { assert.equal(hidden(score, staff), true); assert.equal(hidden(score, staff, 0), false); assert.equal(hidden(score, staff, 2), false); }
  const control = prepareMusicXmlForAlphaTabBytes(input); control.timeVisibility = { partIds: [], parts: [] };
  assert.deepEqual(timeline(score), timeline(loadPreparedMusicXml(control,settings()))); assert.deepEqual(input, original);
});
test('number=1 hidden / number=2 visible applies to just the source staff', () => {
  const xml = source.replace('<time print-object="no"><beats>3</beats><beat-type>4</beat-type></time>', '<time number="1" print-object="no"><beats>3</beats><beat-type>4</beat-type></time><time number="2" print-object="yes"><beats>3</beats><beat-type>4</beat-type></time>');
  const score = load(xml); assert.equal(hidden(score,0),true); assert.equal(hidden(score,1),false); assert.equal(visibleThrees(render(score)),1);
});
test('numbered visible override of unnumbered hidden remains visible', () => {
  const xml = source.replace('<time print-object="no">', '<time number="2"><beats>3</beats><beat-type>4</beat-type></time><time print-object="no">');
  const score = load(xml); assert.equal(hidden(score,0),true); assert.equal(hidden(score,1),false);
});
test('part-list order, not part document order or duplicate names, determines target track', () => {
  const part = source.match(/<part id="P1">[\s\S]*<\/part>/)[0];
  const xml = source.replace('<score-part id="P1"><part-name>Piano</part-name></score-part>', '<score-part id="P2"><part-name>Piano</part-name></score-part><score-part id="P1"><part-name>Piano</part-name></score-part>').replace(part, part + part.replace('id="P1"','id="P2"').replace(' print-object="no"',' print-object="yes"'));
  const score = load(xml); assert.equal(hidden(score,0,1,0),false); assert.equal(hidden(score,0,1,1),true);
});
test('prepared payload survives structuredClone and older prepared callers fall back to source intent', () => {
  const prepared = prepareMusicXmlForAlphaTabBytes(bytes(source));
  const clone = structuredClone(prepared); const transferred = structuredClone(clone, {transfer:[clone.bytes.buffer]});
  assert.equal(clone.bytes.byteLength,0);
  assert.equal(hidden(loadPreparedMusicXml(transferred,settings())),true);
  delete prepared.timeVisibility; assert.equal(hidden(loadPreparedMusicXml(prepared,settings())),true);
});
test('default namespace and prefixed source metadata retain exact mapping', () => {
  const xml = source.replace('<score-partwise ', '<score-partwise xmlns="http://www.musicxml.org/ns/musicxml" ');
  assert.equal(hidden(load(xml)),true);
  const prefixed = source.replace(/<(\/?)([\w-]+)/g, '<$1m:$2').replace('<m:score-partwise ', '<m:score-partwise xmlns:m="http://www.musicxml.org/ns/musicxml" ');
  assert.deepEqual(readMusicXmlTimeVisibility(bytes(prefixed)),readMusicXmlTimeVisibility(bytes(source)));
  // alphaTab's format detector already rejects prefixed root elements. Metadata
  // supports local names, but this paint correction does not widen admission.
  assert.throws(() => loadPreparedMusicXml(prepareMusicXmlForAlphaTabBytes(bytes(prefixed)),settings()), /No compatible importer/);
});
test('transparent color and unrelated styles survive native worker score serialization', () => {
  const score = at.importer.ScoreLoader.loadScoreFromBytes(bytes(source),settings());
  const bar = score.tracks[0].staves[0].bars[1]; bar.style = new at.model.BarStyle();
  bar.style.colors.set(at.model.BarSubElement.StandardNotationClef,new at.model.Color(255,0,0));
  applyMusicXmlTimeVisibility(score,readMusicXmlTimeVisibility(bytes(source)));
  const restored = at.model.JsonConverter.jsonToScore(at.model.JsonConverter.scoreToJson(score),settings());
  assert.equal(hidden(restored),true);
  assert.equal(restored.tracks[0].staves[0].bars[1].style.colors.get(at.model.BarSubElement.StandardNotationClef).r,255);
  assert.equal(visibleThrees(render(restored)),0);
});
test('absent/yes print-object and ambiguous/out-of-range mapping preserve native styles', () => {
  for (const xml of [source.replace(' print-object="no"',''),source.replace(' print-object="no"',' print-object="yes"'),source.replace(' print-object="no"',' number="99" print-object="no"'),source.replace('<time print-object="no">','<time print-object="no"><beats>3</beats><beat-type>4</beat-type></time><time>')]) assert.equal(hidden(load(xml)),false);
  const score = load(source.replace(' print-object="no"',''));
  applyMusicXmlTimeVisibility(score,{partIds:['P1','P2'],parts:readMusicXmlTimeVisibility(bytes(source)).parts}); assert.equal(hidden(score),false);
});

test('compressed MXL normal load retains time visibility without changing archive bytes', () => {
  const input = zipSync({'META-INF/container.xml':strToU8('<container><rootfiles><rootfile full-path="score.xml"/></rootfiles></container>'),'score.xml':strToU8(source)});
  const original = input.slice(); assert.equal(hidden(loadMusicXml(input,settings())),true); assert.deepEqual(input,original);
});
