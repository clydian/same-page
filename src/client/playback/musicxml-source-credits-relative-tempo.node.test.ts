import assert from 'node:assert/strict';
import { test } from 'vitest';
import * as alphaTab from '@coderline/alphatab';
import { loadMusicXml, loadPreparedMusicXml } from '@clydian/chorus-player/engine';
import { prepareMusicXmlForAlphaTabBytes } from '@clydian/chorus-player/musicxml-direction-timing';

const source = (firstDirection = '', secondDirection = '<direction><direction-type><metronome><beat-unit>half</beat-unit><beat-unit-dot/><beat-unit>whole</beat-unit></metronome></direction-type></direction>') => new TextEncoder().encode(`<score-partwise version="4.0"><work><work-title>Host source-credit fixture</work-title></work><identification><creator type="composer">Source Composer</creator><creator type="arranger">Source Arranger</creator><creator type="lyricist">Source Poet</creator></identification><part-list><score-part id="P1"><part-name>Voice</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>3</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>${firstDirection}<note><pitch><step>C</step><octave>5</octave></pitch><duration>3</duration><type>half</type><dot/></note></measure><measure number="2"><attributes><time><beats>2</beats><beat-type>2</beat-type></time></attributes>${secondDirection}<note><pitch><step>D</step><octave>5</octave></pitch><duration>4</duration><type>whole</type></note></measure></part></score-partwise>`);
function tempos(score: alphaTab.model.Score) {
  const result: number[][] = [];
  class Handler extends alphaTab.midi.AlphaSynthMidiFileHandler {
    override addTempo(tick: number, bpm: number) { result.push([tick, bpm]); }
  }
  new alphaTab.midi.MidiFileGenerator(score, new alphaTab.Settings(), new Handler(new alphaTab.midi.MidiFile())).generate();
  return result;
}
function svg(score: alphaTab.model.Score) {
  const settings = new alphaTab.Settings(); settings.core.engine = 'svg'; settings.core.enableLazyLoading = false;
  const renderer = new alphaTab.rendering.ScoreRenderer(settings), pieces: string[] = [];
  renderer.width = 1000;
  renderer.partialRenderFinished.on(event => { if (typeof event.renderResult === 'string') pieces.push(event.renderResult); });
  renderer.error.on(error => { throw error; });
  try { renderer.renderScore(score, [0]); return pieces.join(''); } finally { renderer.destroy(); }
}

test('installed artifact renders composer and arranger in their source roles after Worker-compatible cloning', () => {
  const bytes = source(), original = bytes.slice(), prepared = structuredClone(prepareMusicXmlForAlphaTabBytes(bytes));
  assert.deepEqual(prepared.creatorCredits, { composers: ['Source Composer'], arrangers: ['Source Arranger'] });
  for (const score of [loadMusicXml(bytes, new alphaTab.Settings()), loadPreparedMusicXml(prepared, new alphaTab.Settings()), loadPreparedMusicXml({ ...prepared, creatorCredits: undefined }, new alphaTab.Settings())]) {
    const header = svg(score);
    assert.ok(header.includes('Music by Source Composer'));
    assert.ok(header.includes('Arranged by Source Arranger'));
    assert.ok(!header.includes('Music by Source Arranger'));
    assert.equal(score.words.replaceAll('\u00a0', ' '), 'Source Poet');
  }
  assert.deepEqual(bytes, original);
});

test('installed artifact plays Cantate simple relative tempo at its real bar boundary without inventing a printed number', () => {
  const bytes = source(), original = bytes.slice();
  for (const score of [loadMusicXml(bytes, new alphaTab.Settings()), loadPreparedMusicXml(structuredClone(prepareMusicXmlForAlphaTabBytes(bytes)), new alphaTab.Settings())]) {
    assert.deepEqual(tempos(score), [[0, 120], [2880, 160]]);
    assert.equal(score.masterBars[1].tempoAutomations[0].isVisible, false);
  }
  assert.deepEqual(bytes, original);
});

test('installed artifact does not print a conflicting sound tempo as the source metronome number', () => {
  const bytes = source('<direction><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>88</per-minute></metronome></direction-type><sound tempo="100"/></direction>', '');
  const score = loadPreparedMusicXml(structuredClone(prepareMusicXmlForAlphaTabBytes(bytes)), new alphaTab.Settings());
  assert.deepEqual(tempos(score), [[0, 100]]);
  assert.equal(score.masterBars[0].tempoAutomations[0].isVisible, false);
});
