import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import * as at from "@coderline/alphatab";
import { loadMusicXml } from "../src/engine.ts";
const source = fs.readFileSync(
  new URL("./fixtures/gradual-word-same-mf.musicxml", import.meta.url),
  "utf8",
);
function notes(xml) {
  const score = loadMusicXml(new TextEncoder().encode(xml), new at.Settings());
  const events = [];
  const handler = new Proxy(
    {
      addNote: (track, start, length, key, velocity, channel) =>
        events.push({ track, start, length, key, velocity, channel }),
    },
    { get: (target, key) => target[key] ?? (() => {}) },
  );
  const generator = new at.midi.MidiFileGenerator(
    score,
    new at.Settings(),
    handler,
  );
  generator.generate();
  return events;
}
test("explicit same MF ends cresc word inference at source bar2, including following bar", () => {
  const result = notes(source),
    control = notes(
      source.replace(
        /<direction[^>]*>\s*<direction-type>\s*<words[^>]*>cresc\.<\/words>\s*<\/direction-type>[\s\S]*?<\/direction>/,
        "",
      ),
    );
  const after = (values) =>
    values.filter((note) => note.start >= 3840).map((note) => note.velocity);
  assert.deepEqual(after(control), Array(9).fill(79));
  assert.deepEqual(after(result), after(control));
});
const dynamic = (value, scope = "") =>
  `<direction><direction-type><dynamics><${value}/></dynamics></direction-type>${scope}</direction>`;
const words = (text) =>
  `<direction><direction-type><words>${text}</words></direction-type></direction>`;
const eighths = (voice = 1, staff = 1, step = "C", octave = 4) =>
  Array(8)
    .fill(
      `<note><pitch><step>${step}</step><octave>${octave}</octave></pitch><duration>1</duration><voice>${voice}</voice><type>eighth</type><staff>${staff}</staff></note>`,
    )
    .join("");
function fixture({
  reset = "mf",
  word = "cresc.",
  scope = "",
  lanes = 1,
  staffs = 1,
  bar2 = "",
  bar3 = "",
} = {}) {
  const measures = [1, 2, 3]
    .map(
      (m) =>
        `<measure number="${m}">${m === 1 ? `<attributes><divisions>2</divisions><time><beats>4</beats><beat-type>4</beat-type></time><staves>${staffs}</staves><clef number="1"><sign>G</sign><line>2</line></clef>${staffs === 2 ? '<clef number="2"><sign>F</sign><line>4</line></clef>' : ""}</attributes>${dynamic("mf", scope)}${lanes === 2 ? dynamic("mf", staffs === 2 ? "<staff>2</staff>" : "<voice>2</voice>") : ""}${words(word)}` : m === 2 ? dynamic(reset, scope) + bar2 : bar3}${eighths()}${lanes === 2 ? "<backup><duration>8</duration></backup>" + eighths(2, staffs === 2 ? 2 : 1, "G", 2) : ""}</measure>`,
    )
    .join("");
  return `<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1">${measures}</part></score-partwise>`;
}
for (const word of ["cresc.", "dim."])
  test(`${word} stops at equal explicit MF; pitch/onset/duration/channel unchanged`, () => {
    const xml = fixture({ word });
    const actual = notes(xml),
      control = notes(xml.replace(words(word), ""));
    assert.deepEqual(
      actual.filter((n) => n.start >= 3840),
      control.filter((n) => n.start >= 3840),
    );
    const musical = (n) => {
      const { velocity, ...rest } = n;
      return rest;
    };
    assert.deepEqual(actual.map(musical), control.map(musical));
  });
test("opposite-direction explicit P stops crescendo rather than skipping onward", () => {
  const actual = notes(fixture({ reset: "p" }));
  assert.ok(
    actual.filter((n) => n.start >= 3840).every((n) => n.velocity === 47),
  );
  assert.ok(actual.filter((n) => n.start < 3840).at(-1).velocity >= 79);
});
test("directional explicit F remains the ramp target", () => {
  const actual = notes(fixture({ reset: "f" }));
  assert.ok(
    actual.filter((n) => n.start >= 3840).every((n) => n.velocity === 95),
  );
  const before = actual.filter((n) => n.start < 3840).map((n) => n.velocity);
  assert.equal(before[0], 79);
  assert.ok(before.at(-1) > before[0]);
});
for (const staffs of [1, 2])
  test(`explicit reset stays in its ${staffs === 1 ? "voice" : "staff"} scope`, () => {
    const scope = staffs === 1 ? "<voice>1</voice>" : "<staff>1</staff>";
    const actual = notes(fixture({ scope, lanes: 2, staffs }));
    assert.ok(
      actual
        .filter((n) => n.start >= 3840 && n.key === 60)
        .every((n) => n.velocity === 79),
    );
    assert.ok(
      actual
        .filter((n) => n.start >= 3840 && n.key === 43)
        .some((n) => n.velocity === 95),
      "other lane continues its inferred crescendo",
    );
  });
test("single-staff piano dynamics policy still resets both playback staves", () => {
  const xml = fixture({
    scope: "<staff>1</staff>",
    lanes: 2,
    staffs: 2,
  }).replace(dynamic("mf", "<staff>2</staff>"), "");
  assert.ok(
    notes(xml)
      .filter((n) => n.start >= 3840)
      .every((n) => n.velocity === 79),
  );
});
test("new hairpin remains authoritative over preceding gradual words", () => {
  const xml = fixture({
    bar2: '<direction><direction-type><wedge type="diminuendo"/></direction-type></direction>',
    bar3: '<direction><direction-type><wedge type="stop"/></direction-type></direction>',
  });
  const actual = notes(xml).filter((n) => n.start >= 3840),
    control = notes(xml.replace(words("cresc."), "")).filter(
      (n) => n.start >= 3840,
    );
  assert.deepEqual(actual, control);
});
test("next gradual instruction keeps its existing boundary", () => {
  const xml = fixture({ bar2: words("dim.") });
  assert.deepEqual(
    notes(xml).filter((n) => n.start >= 3840),
    notes(xml.replace(words("cresc."), "")).filter((n) => n.start >= 3840),
  );
});
test("a source dynamic between attacks stops inference at its exact offset", () => {
  const reset = dynamic("mf").replace(
    "</direction>",
    "<offset>4</offset></direction>",
  );
  const xml = fixture({ bar2: reset }).replace(
    `<measure number="2">${dynamic("mf")}`,
    '<measure number="2">',
  );
  const actual = notes(xml);
  assert.ok(
    actual.filter((n) => n.start >= 5760).every((n) => n.velocity === 79),
  );
  assert.ok(
    actual.filter((n) => n.start < 5760).some((n) => n.velocity === 95),
  );
});
function threeQuarterFixture(resets) {
  const q =
    "<note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>";
  return `<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Voice</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>3</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>${dynamic("mf")}${words("cresc.")}${q.repeat(3)}</measure><measure number="2">${resets}${q.repeat(3)}</measure></part></score-partwise>`;
}
test("same-tick general F followed by specific MF uses the effective scoped reset for ramp target", () => {
  const actual = notes(
    threeQuarterFixture(dynamic("f") + dynamic("mf", "<voice>1</voice>")),
  );
  assert.deepEqual(
    actual.map((n) => n.velocity),
    [79, 95, 95, 79, 79, 79],
  );
});
for (const resets of [
  dynamic("mf") + dynamic("f"),
  dynamic("f") + dynamic("mf"),
])
  test(`same-tick duplicate source dynamics honor the final effective value: ${resets}`, () => {
    const finalMf = resets.endsWith(dynamic("mf"));
    assert.deepEqual(
      notes(threeQuarterFixture(resets)).map((n) => n.velocity),
      finalMf ? [79, 95, 95, 79, 79, 79] : [79, 79, 95, 95, 95, 95],
    );
  });
test("specific MF remains effective when general F appears later at the same tick", () => {
  assert.deepEqual(
    notes(
      threeQuarterFixture(dynamic("mf", "<voice>1</voice>") + dynamic("f")),
    ).map((n) => n.velocity),
    [79, 95, 95, 79, 79, 79],
  );
});
test("same-tick resets in another part cannot change its neighbor MIDI track", () => {
  const one = threeQuarterFixture(
    dynamic("mf", "<voice>1</voice>") + dynamic("f"),
  );
  const body = one.match(/<part id="P1">[\s\S]*<\/part>/)[0];
  const second = body
    .replace('id="P1"', 'id="P2"')
    .replace(words("cresc."), "")
    .replaceAll("<mf/>", "<p/>")
    .replaceAll("<f/>", "<p/>");
  const xml = one
    .replace(
      "</part-list>",
      '<score-part id="P2"><part-name>Other</part-name></score-part></part-list>',
    )
    .replace("</score-partwise>", second + "</score-partwise>");
  const actual = notes(xml);
  assert.deepEqual(
    actual.filter((n) => n.track === 0).map((n) => n.velocity),
    [79, 95, 95, 79, 79, 79],
  );
  assert.deepEqual(
    actual.filter((n) => n.track === 1).map((n) => n.velocity),
    Array(6).fill(47),
  );
});
test("scoped endpoints retain the original shared-onset ramp grid across uneven voices", () => {
  const quarter =
    "<note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>";
  const lower =
    "<note><rest/><duration>4</duration><voice>2</voice><type>half</type><staff>1</staff></note>" +
    eighths(2, 1, "G", 2).slice(0, eighths(2, 1, "G", 2).length / 2);
  const xml = fixture({ scope: "<voice>1</voice>", lanes: 2, reset: "ff" })
    .replace(eighths(), quarter.repeat(4))
    .replace(eighths(2, 1, "G", 2), lower);
  assert.deepEqual(
    notes(xml)
      .filter((n) => n.start < 3840 && n.key === 60)
      .map((n) => n.velocity),
    [79, 79, 95, 95],
  );
});
