import assert from "node:assert/strict";
import { test } from "node:test";

import * as alphaTab from "@coderline/alphatab";

import {
  normalizeMusicXmlDirectionTiming,
  normalizeMusicXmlDirectionTimingBytes,
  prepareMusicXmlForAlphaTabBytes,
} from "../src/musicxml-direction-timing.ts";

const fixture = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Soprano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>4</divisions><key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <direction><direction-type><dynamics><p/></dynamics></direction-type></direction>
      <direction><direction-type><dynamics><mf/></dynamics></direction-type><offset>8</offset></direction>
      <direction><direction-type><wedge type="crescendo"/></direction-type><offset>4</offset></direction>
      <direction><direction-type><wedge type="stop"/></direction-type><offset>12</offset></direction>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type></note>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type></note>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type></note>
      <note><pitch><step>F</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type></note>
    </measure>
  </part>
</score-partwise>`;

const load = (bytes) =>
  alphaTab.importer.ScoreLoader.loadScoreFromBytes(bytes, new alphaTab.Settings());

const beats = (score) => score.tracks[0].staves[0].bars[0].voices[0].beats;

test("raw alphaTab import applies offset dynamics at the bar start", () => {
  const score = load(new TextEncoder().encode(fixture));
  assert.deepEqual(
    beats(score).map((beat) => alphaTab.model.DynamicValue[beat.dynamics]),
    ["MF", "MF", "MF", "MF"],
  );
});

test("direction normalization attaches dynamics and wedges to their intended beats", () => {
  const score = load(normalizeMusicXmlDirectionTimingBytes(new TextEncoder().encode(fixture)));
  assert.deepEqual(
    beats(score).map((beat) => alphaTab.model.DynamicValue[beat.dynamics]),
    ["P", "P", "MF", "MF"],
  );
  assert.deepEqual(
    beats(score).map((beat) => alphaTab.model.CrescendoType[beat.crescendo]),
    ["None", "Crescendo", "Crescendo", "None"],
  );
});

test("negative offsets move a dynamic back to the intended earlier onset", () => {
  const negativeOffsetFixture = fixture
    .replace(
      '<direction><direction-type><dynamics><mf/></dynamics></direction-type><offset>8</offset></direction>',
      "",
    )
    .replace(
      '<direction><direction-type><wedge type="crescendo"/></direction-type><offset>4</offset></direction>',
      "",
    )
    .replace(
      '<direction><direction-type><wedge type="stop"/></direction-type><offset>12</offset></direction>',
      "",
    )
    .replace(
      '<note><pitch><step>E</step><octave>4</octave></pitch>',
      '<direction><direction-type><dynamics><mf/></dynamics></direction-type><offset>-4</offset></direction><note><pitch><step>E</step><octave>4</octave></pitch>',
    );
  const raw = load(new TextEncoder().encode(negativeOffsetFixture));
  assert.deepEqual(
    beats(raw).map((beat) => alphaTab.model.DynamicValue[beat.dynamics]),
    ["P", "P", "MF", "MF"],
  );
  const normalized = load(
    normalizeMusicXmlDirectionTimingBytes(new TextEncoder().encode(negativeOffsetFixture)),
  );
  assert.deepEqual(
    beats(normalized).map((beat) => alphaTab.model.DynamicValue[beat.dynamics]),
    ["P", "MF", "MF", "MF"],
  );
});

test("tempo-only offsets remain on alphaTab's dedicated automation path", () => {
  const tempoFixture = fixture.replace(
    '<direction><direction-type><dynamics><p/></dynamics></direction-type></direction>',
    '<direction><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>80</per-minute></metronome></direction-type><offset>6</offset><sound tempo="80"/></direction>',
  );
  const normalized = normalizeMusicXmlDirectionTiming(tempoFixture);
  assert.match(normalized, /<offset>6<\/offset>/);
});

test("visual offsets inside a sustained note are preserved instead of quantized", () => {
  const sustainedFixture = fixture
    .replace(
      '<direction><direction-type><dynamics><p/></dynamics></direction-type></direction>',
      '<direction><direction-type><words>rit.</words></direction-type><offset>12</offset></direction>',
    )
    .replace(
      '<direction><direction-type><dynamics><mf/></dynamics></direction-type><offset>8</offset></direction>',
      "",
    )
    .replace(
      '<direction><direction-type><wedge type="crescendo"/></direction-type><offset>4</offset></direction>',
      "",
    )
    .replace(
      '<direction><direction-type><wedge type="stop"/></direction-type><offset>12</offset></direction>',
      "",
    )
    .replace(
      /<note><pitch><step>C<\/step>[\s\S]*?<\/note>\s*<note><pitch><step>D<\/step>[\s\S]*?<\/note>\s*<note><pitch><step>E<\/step>[\s\S]*?<\/note>\s*<note><pitch><step>F<\/step>[\s\S]*?<\/note>/u,
      '<note><pitch><step>C</step><octave>4</octave></pitch><duration>16</duration><voice>1</voice><type>whole</type></note>',
    );
  const normalized = normalizeMusicXmlDirectionTiming(sustainedFixture);
  assert.match(normalized, /<words>rit\.<\/words>[\s\S]*?<offset>12<\/offset>/u);
});

test("voice-scoped offsets anchor inside the matching MusicXML lane", () => {
  const twoVoiceFixture = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1"><measure number="1">
    <attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
    <direction><direction-type><dynamics><p/></dynamics></direction-type></direction>
    <note><pitch><step>C</step><octave>4</octave></pitch><duration>16</duration><voice>1</voice><type>whole</type></note>
    <backup><duration>16</duration></backup>
    <direction><direction-type><dynamics><ff/></dynamics></direction-type><offset>8</offset><voice>2</voice></direction>
    <note><pitch><step>D</step><octave>4</octave></pitch><duration>4</duration><voice>2</voice><type>quarter</type></note>
    <note><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration><voice>2</voice><type>quarter</type></note>
    <note><pitch><step>F</step><octave>4</octave></pitch><duration>4</duration><voice>2</voice><type>quarter</type></note>
    <note><pitch><step>G</step><octave>4</octave></pitch><duration>4</duration><voice>2</voice><type>quarter</type></note>
  </measure></part>
</score-partwise>`;
  const score = load(
    normalizeMusicXmlDirectionTimingBytes(new TextEncoder().encode(twoVoiceFixture)),
  );
  const secondVoice = score.tracks[0].staves[0].bars[0].voices[1].beats;
  assert.deepEqual(
    secondVoice.map((beat) => alphaTab.model.DynamicValue[beat.dynamics]),
    ["P", "P", "FF", "FF"],
  );
});

test("alphaTab preparation preserves silent time represented by forward elements", () => {
  const forwardFixture = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1"><measure number="1">
    <attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>
    <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
    <forward><duration>12</duration><voice>1</voice></forward>
    <backup><duration>16</duration></backup>
    <note><pitch><step>C</step><octave>3</octave></pitch><duration>16</duration><voice>5</voice><type>whole</type><staff>2</staff></note>
  </measure></part>
</score-partwise>`;

  const raw = load(new TextEncoder().encode(forwardFixture));
  assert.equal(raw.tracks[0].staves[0].bars[0].calculateDuration(), 960);

  const prepared = load(
    prepareMusicXmlForAlphaTabBytes(new TextEncoder().encode(forwardFixture)).bytes,
  );
  assert.equal(
    prepared.tracks[0].staves[0].bars[0].calculateDuration(),
    prepared.masterBars[0].calculateDuration(true),
  );
  assert.equal(
    prepared.tracks[0].staves[1].bars[0].calculateDuration(),
    prepared.masterBars[0].calculateDuration(true),
  );
});
