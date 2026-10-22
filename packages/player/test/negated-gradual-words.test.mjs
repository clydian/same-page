import assert from "node:assert/strict";
import test from "node:test";
import * as at from "@coderline/alphatab";
import { loadMusicXml } from "../src/engine.ts";

// Two attacks are enough to expose a wrongly inferred ramp. The printed F is
// held constant; only the source instruction differs between controls.
function scoreBytes(text) {
  const note = `<note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>`;
  return new TextEncoder().encode(`<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Voice</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>2</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><direction><direction-type><dynamics><f/></dynamics></direction-type></direction>${text ? `<direction><direction-type><words>${text}</words></direction-type></direction>` : ""}${note.repeat(2)}</measure></part></score-partwise>`);
}
function playback(text) {
  const score = loadMusicXml(scoreBytes(text), new at.Settings());
  const events = [];
  const handler = new Proxy({
    addNote: (track, start, length, key, velocity, channel) =>
      events.push({ track, start, length, key, velocity, channel }),
  }, { get: (target, key) => target[key] ?? (() => {}) });
  const generator = new at.midi.MidiFileGenerator(score, new at.Settings(), handler);
  generator.generate();
  return { score, events };
}
test("source non dim. retains F in actual MIDI and remains visible as text", () => {
  const actual = playback("non dim.");
  assert.deepEqual(actual.events, playback("").events);
  assert.deepEqual(actual.events.map(n => n.velocity), [95, 95]);
  assert.equal(actual.score.tracks[0].staves[0].bars[0].voices[0].beats[0].text, "non dim.");
});
test("affirmative dim. still decreases actual MIDI velocity", () => {
  assert.deepEqual(playback("dim.").events.map(n => n.velocity), [95, 79]);
});
for (const word of ["NON   DIM.", "non diminuendo", "non decresc.", "non cresc.", "non crescendo"]) {
  test(`directly negated ${word} leaves actual playback unchanged`, () => {
    assert.deepEqual(playback(word).events, playback("").events);
  });
}
for (const [word, expected] of [
  ["dim. non troppo", [95, 79]],
  ["non troppo dim.", [95, 79]],
  ["non legato; dim.", [95, 79]],
  ["cresc. non troppo", [95, 111]],
  ["non troppo cresc.", [95, 111]],
  ["non dim., cresc.", [95, 111]],
  ["cresc., non dim.", [95, 111]],
  ["non cresc., dim.", [95, 79]],
]) {
  test(`negation scope in ${word} preserves the affirmative instruction`, () => {
    const result = playback(word).events;
    assert.deepEqual(result.map(n => n.velocity), expected);
    const withoutVelocity = ({ velocity, ...event }) => event;
    assert.deepEqual(result.map(withoutVelocity), playback("").events.map(withoutVelocity));
  });
}
