import assert from 'node:assert/strict';
import { test } from 'vitest';
import * as alphaTab from '@coderline/alphatab';
import { loadMusicXml, preparePianoPlaybackMidi } from '@same-page/player/engine';

function fixture(name: string, repeat = false) {
  const note = (duration: number, voice: number) => `<note><pitch><step>G</step><octave>4</octave></pitch><duration>${duration}</duration><voice>${voice}</voice><type>${duration === 2 ? 'quarter' : 'eighth'}</type></note>`;
  return new TextEncoder().encode(`<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>${name}</part-name><score-instrument id="I1"><instrument-name>${name}</instrument-name></score-instrument><midi-instrument id="I1"><midi-channel>1</midi-channel><midi-program>1</midi-program></midi-instrument></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>2</divisions><time><beats>1</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>${note(2, 1)}<backup><duration>2</duration></backup>${note(1, 2)}${repeat ? note(1, 2) : '<note><rest/><duration>1</duration><voice>2</voice><type>eighth</type></note>'}</measure></part></score-partwise>`);
}

function playback(source: Uint8Array) {
  const settings = new alphaTab.Settings();
  const score = loadMusicXml(source, settings);
  const file = new alphaTab.midi.MidiFile();
  const generator = new alphaTab.midi.MidiFileGenerator(score, settings, new alphaTab.midi.AlphaSynthMidiFileHandler(file));
  generator.applyTranspositionPitches = false;
  generator.generate();
  const events = () => file.tracks.flatMap(track => track.events);
  const attacks = () => events().filter(event => event instanceof alphaTab.midi.NoteOnEvent).map(event => [event.tick, event.noteKey]);
  return { score, settings, file, events, attacks };
}

test('pinned player artifact plays a shared piano head once with its longest written hold', () => {
  const source = fixture('Piano'), original = source.slice();
  const p = playback(source);
  assert.deepEqual(p.attacks(), [[0, 67], [0, 67]], 'fixture reaches native duplicate attacks');
  const voices = p.score.tracks[0].staves[0].bars[0].voices;
  assert.equal(voices.flatMap(voice => voice.beats.flatMap(beat => beat.notes)).length, 2);
  assert.equal(preparePianoPlaybackMidi(p.score, p.file, p.settings), 1);
  assert.deepEqual(p.attacks(), [[0, 67]]);
  assert.deepEqual(p.events().filter(event => event instanceof alphaTab.midi.NoteOffEvent).map(event => [event.tick, event.noteKey]), [[960, 67]]);
  assert.ok(p.events().at(-1) instanceof alphaTab.midi.EndOfTrackEvent);
  assert.equal(voices.flatMap(voice => voice.beats.flatMap(beat => beat.notes)).length, 2);
  assert.deepEqual(source, original);
});

test('pinned player artifact preserves a later piano reattack', () => {
  const p = playback(fixture('Piano', true));
  preparePianoPlaybackMidi(p.score, p.file, p.settings);
  assert.deepEqual(p.attacks(), [[0, 67], [480, 67]]);
});

test('pinned player artifact does not infer piano from a default GM program', () => {
  const p = playback(fixture('Voice'));
  const before = p.events().map(event => JSON.stringify(event));
  assert.equal(preparePianoPlaybackMidi(p.score, p.file, p.settings), 0);
  assert.deepEqual(p.events().map(event => JSON.stringify(event)), before);
});
