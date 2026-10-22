import assert from "node:assert/strict";
import { test } from "node:test";

import * as alphaTab from "@coderline/alphatab";

import { applyAlphaTabPlaybackDynamics } from "../src/alphatab-playback-dynamics.ts";
import { prepareMusicXmlForAlphaTabBytes } from "../src/musicxml-direction-timing.ts";

const fixture = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list>
    <score-part id="P1"><part-name>Soprano</part-name></score-part>
    <score-part id="P2"><part-name>Accompaniment</part-name></score-part>
  </part-list>
  <part id="P1"><measure number="1">
    <attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
    <direction><direction-type><dynamics><p/></dynamics></direction-type></direction>
    <direction><direction-type><wedge type="crescendo"/></direction-type></direction>
    <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type></note>
    <note><pitch><step>D</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type></note>
    <note><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type></note>
    <direction><direction-type><wedge type="stop"/></direction-type></direction>
    <direction><direction-type><dynamics><f/></dynamics></direction-type></direction>
    <note><pitch><step>F</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type></note>
  </measure></part>
  <part id="P2"><measure number="1">
    <attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
    <note><pitch><step>C</step><octave>3</octave></pitch><duration>16</duration><voice>1</voice><type>whole</type></note>
  </measure></part>
</score-partwise>`;

class CaptureMidiHandler {
  notes = [];
  addTickShift() {}
  addTimeSignature() {}
  addRest() {}
  addNote(track, start, length, key, velocity, channel) {
    this.notes.push({ track, start, length, key, velocity, channel });
  }
  addControlChange() {}
  addProgramChange() {}
  addTempo() {}
  addBend() {}
  addNoteBend() {}
  finishTrack() {}
}

const dynamicNames = (beats, source = "beat") =>
  beats.map((beat) =>
    alphaTab.model.DynamicValue[
      source === "note" ? beat.notes[0].dynamics : beat.dynamics
    ],
  );

test("hairpins shape MIDI velocities without inventing printed dynamic glyphs", () => {
  const prepared = prepareMusicXmlForAlphaTabBytes(new TextEncoder().encode(fixture));
  assert.deepEqual(prepared.partsWithExplicitDynamics, [true, false]);

  const settings = new alphaTab.Settings();
  const score = alphaTab.importer.ScoreLoader.loadScoreFromBytes(prepared.bytes, settings);
  const sopranoBeats = score.tracks[0].staves[0].bars[0].voices[0].beats;
  const accompanimentBeat = score.tracks[1].staves[0].bars[0].voices[0].beats[0];

  assert.deepEqual(dynamicNames(sopranoBeats), ["P", "P", "P", "F"]);
  assert.equal(alphaTab.model.DynamicValue[accompanimentBeat.dynamics], "F");

  const result = applyAlphaTabPlaybackDynamics(
    score,
    prepared.partsWithExplicitDynamics,
    4,
    prepared.dynamicEventsByPart,
  );
  assert.deepEqual(result.unmarkedTracks, [1]);
  assert.equal(result.hairpinAdjustedNotes, 3);
  assert.equal(result.textAdjustedNotes, 0);
  assert.deepEqual(dynamicNames(sopranoBeats), ["P", "P", "P", "F"]);
  assert.deepEqual(dynamicNames(sopranoBeats, "note"), ["P", "MP", "MF", "F"]);
  assert.equal(accompanimentBeat.dynamics, -1);
  assert.equal(alphaTab.model.DynamicValue[accompanimentBeat.notes[0].dynamics], "MF");

  const handler = new CaptureMidiHandler();
  new alphaTab.midi.MidiFileGenerator(score, settings, handler).generate();
  const sopranoVelocities = handler.notes
    .filter(({ track }) => track === 0)
    .map(({ velocity }) => velocity);
  assert.equal(sopranoVelocities.length, 4);
  assert.ok(
    sopranoVelocities.every(
      (velocity, index) => index === 0 || velocity > sopranoVelocities[index - 1],
    ),
  );
  assert.equal(
    handler.notes.find(({ track }) => track === 1)?.velocity,
    sopranoVelocities[2],
  );
});

test("printed cresc. words shape playback without adding visual hairpins", () => {
  const wordsFixture = fixture
    .replace(
      '<direction><direction-type><wedge type="crescendo"/></direction-type></direction>',
      '<direction><direction-type><words>cresc.</words></direction-type></direction>',
    )
    .replace(
      '<direction><direction-type><wedge type="stop"/></direction-type></direction>',
      "",
    );
  const prepared = prepareMusicXmlForAlphaTabBytes(
    new TextEncoder().encode(wordsFixture),
  );
  const score = alphaTab.importer.ScoreLoader.loadScoreFromBytes(
    prepared.bytes,
    new alphaTab.Settings(),
  );
  const sopranoBeats = score.tracks[0].staves[0].bars[0].voices[0].beats;
  const result = applyAlphaTabPlaybackDynamics(
    score,
    prepared.partsWithExplicitDynamics,
    4,
    prepared.dynamicEventsByPart,
  );

  assert.equal(result.hairpinAdjustedNotes, 0);
  assert.equal(result.textAdjustedNotes, 3);
  assert.deepEqual(
    sopranoBeats.map((beat) => alphaTab.model.CrescendoType[beat.crescendo]),
    ["None", "None", "None", "None"],
  );
  assert.deepEqual(dynamicNames(sopranoBeats), ["P", "P", "P", "F"]);
  assert.deepEqual(dynamicNames(sopranoBeats, "note"), ["P", "MP", "MF", "F"]);
});

test("source-timed dynamics repair alphaTab leakage into a later MusicXML voice", () => {
  const twoVoiceFixture = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Divisi</part-name></score-part></part-list>
  <part id="P1"><measure number="1">
    <attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
    <direction><direction-type><dynamics><p/></dynamics></direction-type></direction>
    <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type></note>
    <direction><direction-type><dynamics><f/></dynamics></direction-type></direction>
    <note><pitch><step>D</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type></note>
    <note><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type></note>
    <note><pitch><step>F</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type></note>
    <backup><duration>16</duration></backup>
    <note><pitch><step>G</step><octave>3</octave></pitch><duration>4</duration><voice>2</voice><type>quarter</type></note>
    <note><pitch><step>A</step><octave>3</octave></pitch><duration>4</duration><voice>2</voice><type>quarter</type></note>
    <note><pitch><step>B</step><octave>3</octave></pitch><duration>4</duration><voice>2</voice><type>quarter</type></note>
    <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><voice>2</voice><type>quarter</type></note>
  </measure></part>
</score-partwise>`;
  const prepared = prepareMusicXmlForAlphaTabBytes(
    new TextEncoder().encode(twoVoiceFixture),
  );
  const score = alphaTab.importer.ScoreLoader.loadScoreFromBytes(
    prepared.bytes,
    new alphaTab.Settings(),
  );
  const secondVoice = score.tracks[0].staves[0].bars[0].voices[1].beats;
  assert.deepEqual(dynamicNames(secondVoice), ["F", "F", "F", "F"]);

  applyAlphaTabPlaybackDynamics(
    score,
    prepared.partsWithExplicitDynamics,
    4,
    prepared.dynamicEventsByPart,
  );
  assert.deepEqual(dynamicNames(secondVoice), ["P", "F", "F", "F"]);
  assert.deepEqual(dynamicNames(secondVoice, "note"), ["P", "F", "F", "F"]);
});

test("a contradictory endpoint never reverses the printed hairpin direction", () => {
  const contradictoryFixture = fixture.replace(
    '<wedge type="crescendo"/>',
    '<wedge type="diminuendo"/>',
  );
  const prepared = prepareMusicXmlForAlphaTabBytes(
    new TextEncoder().encode(contradictoryFixture),
  );
  const score = alphaTab.importer.ScoreLoader.loadScoreFromBytes(
    prepared.bytes,
    new alphaTab.Settings(),
  );
  const sopranoBeats = score.tracks[0].staves[0].bars[0].voices[0].beats;
  applyAlphaTabPlaybackDynamics(
    score,
    prepared.partsWithExplicitDynamics,
    4,
    prepared.dynamicEventsByPart,
  );
  assert.deepEqual(dynamicNames(sopranoBeats, "note"), ["P", "P", "PP", "F"]);
});

test("a single printed piano dynamic controls both staves without duplicating its glyph", () => {
  const pianoFixture = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1"><measure number="1">
    <attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>
    <direction><direction-type><dynamics><p/></dynamics></direction-type><staff>1</staff></direction>
    <direction><direction-type><wedge type="crescendo"/></direction-type><staff>1</staff></direction>
    <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
    <note><pitch><step>D</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
    <note><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
    <direction><direction-type><wedge type="stop"/></direction-type><staff>1</staff></direction>
    <direction><direction-type><dynamics><f/></dynamics></direction-type><staff>1</staff></direction>
    <note><pitch><step>F</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
    <backup><duration>16</duration></backup>
    <note><pitch><step>C</step><octave>3</octave></pitch><duration>4</duration><voice>2</voice><type>quarter</type><staff>2</staff></note>
    <note><pitch><step>D</step><octave>3</octave></pitch><duration>4</duration><voice>2</voice><type>quarter</type><staff>2</staff></note>
    <note><pitch><step>E</step><octave>3</octave></pitch><duration>4</duration><voice>2</voice><type>quarter</type><staff>2</staff></note>
    <note><pitch><step>F</step><octave>3</octave></pitch><duration>4</duration><voice>2</voice><type>quarter</type><staff>2</staff></note>
  </measure></part>
</score-partwise>`;
  const prepared = prepareMusicXmlForAlphaTabBytes(
    new TextEncoder().encode(pianoFixture),
  );
  const score = alphaTab.importer.ScoreLoader.loadScoreFromBytes(
    prepared.bytes,
    new alphaTab.Settings(),
  );
  applyAlphaTabPlaybackDynamics(
    score,
    prepared.partsWithExplicitDynamics,
    score.tracks.length,
    prepared.dynamicEventsByPart,
  );

  const upper = score.tracks[0].staves[0].bars[0].voices[0].beats;
  const lower = score.tracks[0].staves[1].bars[0].voices
    .flatMap((voice) => voice.beats)
    .filter((beat) => beat.notes.length > 0);
  assert.deepEqual(dynamicNames(upper), ["P", "P", "P", "F"]);
  assert.deepEqual(dynamicNames(upper, "note"), ["P", "MP", "MF", "F"]);
  assert.deepEqual(lower.map((beat) => beat.dynamics), [-1, -1, -1, -1]);
  assert.deepEqual(dynamicNames(lower, "note"), ["P", "MP", "MF", "F"]);
  assert.deepEqual(
    lower.map((beat) => alphaTab.model.CrescendoType[beat.crescendo]),
    ["None", "None", "None", "None"],
  );
});
