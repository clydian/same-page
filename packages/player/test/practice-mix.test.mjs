import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildPracticePartIdentities,
  calculateEffectiveTrackVolumes,
  DEFAULT_OTHER_PART_VOLUME,
  findPracticeTrackIndex,
  normalizePracticePart,
} from "../src/practice-mix.ts";

const assertClose = (actual, expected) => {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} should equal ${expected}`);
};

test("focus mix defaults other parts to an independent quarter-volume group", () => {
  assert.equal(DEFAULT_OTHER_PART_VOLUME, 0.25);
  const volumes = calculateEffectiveTrackVolumes({
    baseVolumes: [0.75, 0.75, 0.75, 0.75, 0.62],
    mixGain: 0.52,
    practiceTrackIndex: 2,
    otherPartVolume: DEFAULT_OTHER_PART_VOLUME,
  });

  assertClose(volumes[2], 0.75 * 0.52);
  volumes.forEach((volume, index) => {
    if (index !== 2) {
      assertClose(volume, 0.25 * 0.52);
    }
  });
});

test("focus and other-part volumes can move independently", () => {
  const volumes = calculateEffectiveTrackVolumes({
    baseVolumes: [0.75, 0.75, 1, 0.75],
    mixGain: 0.52,
    practiceTrackIndex: 2,
    otherPartVolume: 0.4,
  });

  [0.208, 0.208, 0.52, 0.208].forEach((expected, index) => {
    assertClose(volumes[index], expected);
  });
});

test("balanced mode preserves each custom fader and score gain", () => {
  const volumes = calculateEffectiveTrackVolumes({
    baseVolumes: [0.8, 0.5, 0.25],
    mixGain: 0.75,
    practiceTrackIndex: null,
    otherPartVolume: 0.25,
  });

  [0.6, 0.375, 0.1875].forEach((expected, index) => {
    assertClose(volumes[index], expected);
  });
});

test("focus mix supports making the selected part quieter or louder than the others", () => {
  const louderFocus = calculateEffectiveTrackVolumes({
    baseVolumes: [0.6, 0.8, 0.5],
    mixGain: 1,
    practiceTrackIndex: 1,
    otherPartVolume: 0.25,
  });
  const quieterFocus = calculateEffectiveTrackVolumes({
    baseVolumes: [0.6, 0.2, 0.5],
    mixGain: 1,
    practiceTrackIndex: 1,
    otherPartVolume: 0.75,
  });

  assert.deepEqual(louderFocus, [0.25, 0.8, 0.25]);
  assert.deepEqual(quieterFocus, [0.75, 0.2, 0.75]);
});

test("practice roles survive SATB naming differences without storing track indexes", () => {
  assert.equal(normalizePracticePart("Soprano"), "soprano");
  assert.equal(normalizePracticePart("Contralto"), "alto");
  assert.equal(normalizePracticePart("Alto"), "alto");
  assert.equal(normalizePracticePart("Tenor"), "tenor");
  assert.equal(normalizePracticePart("Bass"), "bass");
  assert.equal(normalizePracticePart("Piano"), "accompaniment");
  assert.equal(normalizePracticePart("Harp"), "accompaniment");
});

test("duplicate Voice labels receive unique score-scoped track identities", () => {
  const identities = buildPracticePartIdentities(
    Array.from({ length: 4 }, (_, trackIndex) => ({
      displayName: "Voice",
      normalizedPart: "voice",
      trackIndex,
    })),
    "omr:four-voices",
  );

  assert.deepEqual(
    identities.map(({ displayName }) => displayName),
    ["Voice 1", "Voice 2", "Voice 3", "Voice 4"],
  );
  assert.equal(new Set(identities.map(({ selectionKey }) => selectionKey)).size, 4);
  identities.forEach((identity) => {
    assert.equal(
      findPracticeTrackIndex(identities, identity.selectionKey),
      identity.trackIndex,
    );
  });
  assert.equal(findPracticeTrackIndex(identities, "voice"), null);
});

test("unique SATB identities keep portable semantic preference keys", () => {
  const identities = buildPracticePartIdentities(
    ["soprano", "alto", "tenor", "bass"].map((part, trackIndex) => ({
      displayName: part,
      normalizedPart: part,
      trackIndex,
    })),
    "satb-score",
  );

  assert.deepEqual(
    identities.map(({ selectionKey }) => selectionKey),
    ["soprano", "alto", "tenor", "bass"],
  );
});
