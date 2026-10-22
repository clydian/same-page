import assert from "node:assert/strict";
import test from "node:test";
import { solfegeDegreeLabel } from "../src/solfege-degree.ts";

test("C major maps diatonic notes to movable-do degrees without octaves", () => {
  assert.deepEqual(
    [60, 62, 64, 65, 67, 69, 71, 72].map((value) => solfegeDegreeLabel(value, 0, 0)),
    ["1", "2", "3", "4", "5", "6", "7", "1"],
  );
});

test("key-signature accidentals belong to the scale and do not receive a prefix", () => {
  assert.equal(solfegeDegreeLabel(66, 1, 0), "7"); // F-sharp in G major
  assert.equal(solfegeDegreeLabel(70, -1, 0), "4"); // B-flat in F major
  assert.equal(solfegeDegreeLabel(61, -5, 0), "1"); // D-flat in D-flat major
});

test("chromatic alterations are written relative to the current key signature", () => {
  assert.equal(solfegeDegreeLabel(61, 0, 3), "♯1");
  assert.equal(solfegeDegreeLabel(61, 0, 5), "♭2");
  assert.equal(solfegeDegreeLabel(65, 1, 2), "♭7"); // F-natural in G major
  assert.equal(solfegeDegreeLabel(71, -1, 2), "♯4"); // B-natural in F major
  assert.equal(solfegeDegreeLabel(62, 0, 4), "♯♯1");
});

test("minor keys keep the key-signature-relative la-based convention", () => {
  assert.equal(solfegeDegreeLabel(69, 0, 0), "6"); // A in A minor / C major signature
  assert.equal(solfegeDegreeLabel(64, 1, 0), "6"); // E in E minor / G major signature
});
