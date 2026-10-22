import assert from 'node:assert/strict';
import { test } from 'vitest';
import * as alphaTab from '@coderline/alphatab';
import { assignPlaybackChannels, loadMusicXml, loadPreparedMusicXml, preparePianoPlaybackMidi } from '@same-page/player/engine';
import { prepareMusicXmlForAlphaTabBytes } from '@same-page/player/musicxml-direction-timing';

function source(parentheses?: 'yes' | 'no', chord = false) {
  const head = parentheses === undefined ? '' : `<notehead parentheses="${parentheses}">normal</notehead>`;
  const lower = chord ? '<note><pitch><step>C</step><octave>5</octave></pitch><duration>2</duration><type>half</type><stem>down</stem></note>' : '';
  return new TextEncoder().encode(`<score-partwise version="4.0"><part-list><score-part id="S"><part-name>Soprano</part-name></score-part></part-list><part id="S"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><direction><direction-type><dynamics><mf/></dynamics></direction-type></direction>${lower}<note>${chord ? '<chord/>' : ''}<pitch><step>A</step><alter>-1</alter><octave>5</octave></pitch><duration>${chord ? 2 : 4}</duration><type>${chord ? 'half' : 'whole'}</type>${chord ? '<stem>down</stem>' : ''}${head}</note>${chord ? '<note><rest/><duration>2</duration><type>half</type></note>' : ''}</measure></part></score-partwise>`);
}

function load(bytes: Uint8Array, prepared: boolean) {
  const settings = new alphaTab.Settings();
  const score = prepared
    ? loadPreparedMusicXml(structuredClone(prepareMusicXmlForAlphaTabBytes(bytes)), settings)
    : loadMusicXml(bytes, settings);
  assert.ok(score instanceof alphaTab.model.Score, 'public player and MIDI generator share the installed native package');
  return score;
}

function midi(score: alphaTab.model.Score, ghostVelocity?: number) {
  const settings = new alphaTab.Settings();
  assignPlaybackChannels(score.tracks);
  const file = new alphaTab.midi.MidiFile();
  const generator = new alphaTab.midi.MidiFileGenerator(score, settings, new alphaTab.midi.AlphaSynthMidiFileHandler(file));
  generator.applyTranspositionPitches = false;
  generator.generate();
  preparePianoPlaybackMidi(score, file, settings);
  // Compare every event and master-bar bound, including controllers, bends,
  // tempo and end-of-track. Only the legacy ghost oracle changes velocities.
  return {
    events: file.tracks.map(track => track.events.map(event => JSON.stringify(
      ghostVelocity !== undefined && (event instanceof alphaTab.midi.NoteOnEvent || event instanceof alphaTab.midi.NoteOffEvent)
        ? { ...event, noteVelocity: ghostVelocity } : event,
    ))),
    notes: file.tracks.flatMap(track => track.events).filter(event => event instanceof alphaTab.midi.NoteOnEvent || event instanceof alphaTab.midi.NoteOffEvent)
      .map(event => [event.type, event.tick, event.noteKey, ghostVelocity ?? event.noteVelocity]),
    bounds: generator.tickLookup.masterBars.map(bar => [bar.start, bar.end]),
  };
}

for (const prepared of [false, true]) {
  const entry = prepared ? 'prepared Worker payload' : 'direct MusicXML';
  test(`source parentheses preserve complete mf MIDI through ${entry}`, () => {
    const plain = load(source(), prepared), explicitNo = load(source('no'), prepared), yes = load(source('yes'), prepared);
    const expected = midi(plain);
    assert.deepEqual(expected.notes, [[128, 0, 80, 79], [144, 3840, 80, 79]]);
    assert.deepEqual(expected.bounds, [[0, 3840]]);
    assert.deepEqual(midi(explicitNo), expected);
    assert.deepEqual(midi(yes), expected);
    const note = yes.tracks[0].staves[0].bars[0].voices[0].beats[0].notes[0];
    assert.equal(note.isNoteHeadParenthesized, true);
    assert.equal(note.isGhost, false);
  });

  test(`only the authored upper chord head is parenthesized through ${entry}`, () => {
    const plain = load(source(undefined, true), prepared), yes = load(source('yes', true), prepared);
    assert.deepEqual(midi(yes), midi(plain));
    assert.deepEqual(midi(yes).notes, [[128, 0, 72, 79], [128, 0, 80, 79], [144, 1920, 72, 79], [144, 1920, 80, 79]]);
    const notes = yes.tracks[0].staves[0].bars[0].voices[0].beats[0].notes;
    assert.deepEqual(notes.map(note => [note.realValue, note.isNoteHeadParenthesized, note.isGhost]), [[72, false, false], [80, true, false]]);
    const clone = alphaTab.model.JsonConverter.jsObjectToScore(structuredClone(alphaTab.model.JsonConverter.scoreToJsObject(yes)));
    // This explicit-mf miniature alone checks JSON compatibility; production MIDI uses the original prepared score, not a render clone.
    assert.deepEqual(midi(clone), midi(yes), 'renderer JSON transport retains appearance without acquiring ghost dynamics');
  });
}

test('legacy JSON without the new field retains ghost mf velocity and complete MIDI', () => {
  const plain = load(source(), false), ghost = load(source(), false);
  ghost.tracks[0].staves[0].bars[0].voices[0].beats[0].notes[0].isGhost = true;
  const oldJson = JSON.stringify(alphaTab.model.JsonConverter.scoreToJsObject(ghost), (key, value) =>
    key.toLowerCase() === 'isnoteheadparenthesized' ? undefined : value instanceof Map ? Object.fromEntries(value) : value);
  assert.doesNotMatch(oldJson, /isnoteheadparenthesized/i);
  const restored = alphaTab.model.JsonConverter.jsObjectToScore(JSON.parse(oldJson));
  const note = restored.tracks[0].staves[0].bars[0].voices[0].beats[0].notes[0];
  assert.equal(note.isGhost, true);
  assert.equal(note.isNoteHeadParenthesized, false);
  assert.deepEqual(midi(restored), midi(plain, 63));
  assert.deepEqual(midi(restored), midi(ghost));
});

test('legacy AlphaTex ghost still attenuates complete mf MIDI', () => {
  const read = (ghost: boolean) => {
    const importer = new alphaTab.importer.AlphaTexImporter();
    importer.initFromString(`. :1 3.3${ghost ? '{g}' : ''}`, new alphaTab.Settings());
    const score = importer.readScore();
    for (const beat of score.tracks[0].staves[0].bars[0].voices[0].beats) {
      beat.dynamics = alphaTab.model.DynamicValue.MF;
      for (const note of beat.notes) note.dynamics = alphaTab.model.DynamicValue.MF;
    }
    return score;
  };
  const plain = read(false), ghost = read(true);
  assert.deepEqual(midi(plain).notes.map(note => note[3]), [79, 79]);
  assert.deepEqual(midi(ghost), midi(plain, 63));
  assert.equal(ghost.tracks[0].staves[0].bars[0].voices[0].beats[0].notes[0].isNoteHeadParenthesized, false);
});
