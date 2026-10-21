import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import * as at from "@coderline/alphatab";
import { loadMusicXml } from "../src/engine.ts";
const read = (n) =>
  fs.readFileSync(
    new URL(`./fixtures/offbeat-wedge-stop-${n}.musicxml`, import.meta.url),
    "utf8",
  );
function playback(xml, native = false) {
  const settings = new at.Settings(),
    bytes = new TextEncoder().encode(xml),
    score = native
      ? at.importer.ScoreLoader.loadScoreFromBytes(bytes, settings)
      : loadMusicXml(bytes, settings),
    notes = [];
  const handler = new Proxy(
    {
      addNote: (track, start, length, key, velocity, channel) =>
        notes.push({ track, start, length, key, velocity, channel }),
    },
    { get: (t, k) => t[k] ?? (() => {}) },
  );
  const g = new at.midi.MidiFileGenerator(score, settings, handler);
  g.applyTranspositionPitches = false;
  g.generate();
  return { notes, score };
}
for (const name of ["single", "grandstaff"])
  test(`offbeat wedge stop preserves whole following explicitmf bar (${name})`, () => {
    const xml = read(name),
      n = playback(xml, true),
      s = playback(xml);
    assert(
      n.notes.filter((e) => e.start >= 3840).every((e) => e.velocity === 79),
    );
    assert(
      s.notes.filter((e) => e.start >= 3840).every((e) => e.velocity === 79),
    );
    assert(
      s.notes
        .filter((e) => e.start >= 2880 && e.start < 3840)
        .every((e) => e.velocity === 63),
      "after exact2.5 stop priorMP holds onbeat3; no continueddim",
    );
    assert.deepEqual(
      s.notes.map(({ velocity, ...e }) => e),
      n.notes.map(({ velocity, ...e }) => e),
    );
  });
test("exact beatstop control and offbeatstop have same outside-span notes", () => {
  const a = playback(read("single")),
    b = playback(
      read("single").replace("<offset>60</offset>", "<offset>72</offset>"),
    );
  assert.deepEqual(
    a.notes.filter((e) => e.start >= 3840),
    b.notes.filter((e) => e.start >= 3840),
  );
});
test("voice/staff scoped wedge cannot weaken independently marked otherstaff", () => {
  let xml = read("grandstaff")
    .replaceAll(
      '<wedge type="diminuendo" number="1"/></direction-type>',
      '<wedge type="diminuendo" number="1"/></direction-type><voice>1</voice>',
    )
    .replaceAll(
      '<wedge type="stop" number="1"/></direction-type>',
      '<wedge type="stop" number="1"/></direction-type><voice>1</voice>',
    );
  xml = xml.replace(
    "<note>",
    "<direction><direction-type><dynamics><mf/></dynamics></direction-type><staff>2</staff></direction><note>",
  );
  const s = playback(xml);
  assert(s.notes.filter((e) => e.key === 52).every((e) => e.velocity === 79));
  assert(
    s.notes.filter((e) => e.start >= 3840).every((e) => e.velocity === 79),
  );
});
test("explicit same MF after offbeatstop restores all following attacks", () => {
  const s = playback(read("grandstaff").replace("<mp/>", "<mf/>"));
  assert(
    s.notes.some((e) => e.start === 1920 && e.velocity < 79),
    "genuine dim must still affect inside-span attack",
  );
  assert(
    s.notes.filter((e) => e.start >= 3840).every((e) => e.velocity === 79),
  );
});
test("source preparation retains exact offbeat wedge stop without mutating input", async () => {
  const { prepareMusicXmlForAlphaTabBytes } = await import(
    "../src/musicxml-direction-timing.ts"
  );
  const bytes = new TextEncoder().encode(read("single")),
    before = new Uint8Array(bytes),
    prepared = prepareMusicXmlForAlphaTabBytes(bytes);
  assert.deepEqual(bytes, before);
  assert.deepEqual(
    prepared.wedgeEventsByPart[0].map((e) => [
      e.measureIndex,
      e.quarter,
      e.type,
    ]),
    [
      [0, 1, "diminuendo"],
      [0, 2.5, "stop"],
    ],
  );
});
test("all wedges in one direction retain stop/start order when reusing a number", async () => {
  const { prepareMusicXmlForAlphaTabBytes } = await import(
    "../src/musicxml-direction-timing.ts"
  );
  let xml = read("single")
    .replace(
      '<wedge type="stop" number="1"/>',
      '<wedge type="stop" number="1"/><wedge type="crescendo" number="1"/>',
    )
    .replace("<offset>60</offset>", "<offset>48</offset>");
  xml = xml.replace(
    "<note>",
    '<direction><direction-type><wedge type="stop" number="1"/></direction-type><offset>96</offset><staff>1</staff></direction><note>',
  );
  const events = prepareMusicXmlForAlphaTabBytes(new TextEncoder().encode(xml))
    .wedgeEventsByPart[0];
  assert.deepEqual(
    events.map((e) => [e.quarter, e.type]),
    [
      [1, "diminuendo"],
      [2, "stop"],
      [2, "crescendo"],
      [4, "stop"],
    ],
  );
  const s = playback(xml);
  assert(
    s.notes.filter((e) => e.start === 2880).every((e) => e.velocity === 79),
    "same-number newcrescendo must affect its lastattack",
  );
});
test("nonconsecutive numeric source voice keeps offbeat-stop coverage", () => {
  let xml = read("single")
    .replaceAll("<voice>1</voice>", "<voice>7</voice>")
    .replaceAll(
      "</direction-type><offset>",
      "</direction-type><voice>7</voice><offset>",
    );
  const s = playback(xml);
  assert(
    s.notes.filter((e) => e.start >= 3840).every((e) => e.velocity === 79),
  );
  assert(s.notes.some((e) => e.start === 1920 && e.velocity < 63));
});
test("unmapped nonnumeric source voice safely retains imported native wedge markers", async () => {
  const { prepareMusicXmlForAlphaTabBytes } = await import(
    "../src/musicxml-direction-timing.ts"
  );
  const xml = read("single")
    .replaceAll("<voice>1</voice>", "<voice>Upper</voice>")
    .replaceAll(
      "</direction-type><offset>",
      "</direction-type><voice>Upper</voice><offset>",
    );
  const prepared = prepareMusicXmlForAlphaTabBytes(
      new TextEncoder().encode(xml),
    ),
    native = at.importer.ScoreLoader.loadScoreFromBytes(
      prepared.bytes,
      new at.Settings(),
    ),
    wrapped = playback(xml).score;
  const marks = (s) =>
    s.tracks[0].staves[0].bars.flatMap((b) =>
      b.voices.flatMap((v) => v.beats.map((n) => n.crescendo)),
    );
  assert.deepEqual(
    marks(wrapped),
    marks(native),
    "unsupported voice must not silently clear every native wedge",
  );
});
for (const scope of ["omitted-staff", "cross-staff", "omitted-voice"])
  test(`unique wedge number closes across optional scope (${scope})`, () => {
    let xml = read("grandstaff");
    const stop = '<wedge type="stop" number="1"/></direction-type><offset>60</offset><staff>1</staff>';
    if (scope === "omitted-staff") xml = xml.replace(stop, '<wedge type="stop" number="1"/></direction-type><offset>60</offset>');
    if (scope === "cross-staff") xml = xml.replace(stop, stop.replace('<staff>1</staff>', '<staff>2</staff>'));
    if (scope === "omitted-voice") xml = xml.replace('<wedge type="diminuendo" number="1"/></direction-type>', '<wedge type="diminuendo" number="1"/></direction-type><voice>1</voice>');
    const result = playback(xml);
    assert(result.notes.some(e => e.start === 1920 && e.velocity < 63));
    assert(result.notes.filter(e => e.start === 2880).every(e => e.velocity === 63), "source stop must close original start lane at exact2.5");
    assert(result.notes.filter(e => e.start >= 3840).every(e => e.velocity === 79));
  });
test("ambiguous concurrent same-number lanes retain native markers before clearing", async () => {
  const { prepareMusicXmlForAlphaTabBytes } = await import('../src/musicxml-direction-timing.ts');
  const xml = read('grandstaff').replace('<note>', '<direction><direction-type><wedge type="crescendo" number="1"/></direction-type><offset>36</offset><staff>2</staff></direction><note>');
  const prepared = prepareMusicXmlForAlphaTabBytes(new TextEncoder().encode(xml));
  const native = at.importer.ScoreLoader.loadScoreFromBytes(prepared.bytes, new at.Settings());
  const { applyAlphaTabPlaybackDynamics } = await import('../src/alphatab-playback-dynamics.ts');
  applyAlphaTabPlaybackDynamics(native, prepared.partsWithExplicitDynamics, native.tracks.length, prepared.dynamicEventsByPart, []);
  const actual = playback(xml).score;
  const markers = score => score.tracks[0].staves.flatMap(s => s.bars.flatMap(b => b.voices.flatMap(v => v.beats.map(n => n.crescendo))));
  assert.deepEqual(markers(actual), markers(native));
});
