import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildPlaybackMeasures,
  clampPlaybackMeasureIndex,
  findPlaybackMeasureIndex,
  playbackMeasureIndexAtRatio,
} from "../src/playback-measures.ts";

test("measure timeline follows playback ticks at exact bar boundaries", () => {
  const measures = buildPlaybackMeasures([
    { startTick: 960, endTick: 1920, measureIndex: 1 },
    { startTick: 0, endTick: 960, measureIndex: 0 },
    { startTick: 1920, endTick: 2880, measureIndex: 2 },
  ]);

  assert.deepEqual(measures.map(({ measureIndex }) => measureIndex), [0, 1, 2]);
  assert.equal(findPlaybackMeasureIndex(measures, 0), 0);
  assert.equal(findPlaybackMeasureIndex(measures, 959), 0);
  assert.equal(findPlaybackMeasureIndex(measures, 960), 1);
  assert.equal(findPlaybackMeasureIndex(measures, 2880), 2);
});

test("measure timeline preserves repeat playback occurrences", () => {
  const measures = buildPlaybackMeasures([
    { startTick: 0, endTick: 960, measureIndex: 0 },
    { startTick: 960, endTick: 1920, measureIndex: 1 },
    { startTick: 1920, endTick: 2880, measureIndex: 0 },
    { startTick: 2880, endTick: 3840, measureIndex: 1 },
    { startTick: 3840, endTick: 4800, measureIndex: 2 },
  ]);

  assert.equal(findPlaybackMeasureIndex(measures, 2200), 2);
  assert.equal(measures[2].measureIndex, 0);
  assert.equal(measures[3].measureIndex, 1);
});

test("one-measure navigation clamps safely at both score edges", () => {
  const measures = buildPlaybackMeasures([
    { startTick: 0, endTick: 960, measureIndex: 0 },
    { startTick: 960, endTick: 1920, measureIndex: 1 },
  ]);

  assert.equal(clampPlaybackMeasureIndex(measures, -1), 0);
  assert.equal(clampPlaybackMeasureIndex(measures, 1), 1);
  assert.equal(clampPlaybackMeasureIndex(measures, 2), 1);
  assert.equal(clampPlaybackMeasureIndex([], 0), null);
});

test("timeline pointer ratios resolve to the nearest playback measure", () => {
  const measures = buildPlaybackMeasures([
    { startTick: 0, endTick: 960, measureIndex: 0 },
    { startTick: 960, endTick: 1920, measureIndex: 1 },
    { startTick: 1920, endTick: 2880, measureIndex: 2 },
    { startTick: 2880, endTick: 3840, measureIndex: 3 },
    { startTick: 3840, endTick: 4800, measureIndex: 4 },
  ]);

  assert.equal(playbackMeasureIndexAtRatio(measures, -0.2), 0);
  assert.equal(playbackMeasureIndexAtRatio(measures, 0.24), 1);
  assert.equal(playbackMeasureIndexAtRatio(measures, 0.5), 2);
  assert.equal(playbackMeasureIndexAtRatio(measures, 0.76), 3);
  assert.equal(playbackMeasureIndexAtRatio(measures, 1.2), 4);
  assert.equal(playbackMeasureIndexAtRatio([], 0.5), null);
});


test('printed measure labels distinguish repeated visits rather than shifted pickup indices',async()=>{
 const{playbackMeasureLabels}=await import('../dist/playback-measures.js');
 assert.deepEqual(playbackMeasureLabels(['0','1','2','1','2','3']),['第 0 小节','第 1 小节 · 第 1 次经过','第 2 小节 · 第 1 次经过','第 1 小节 · 第 2 次经过','第 2 小节 · 第 2 次经过','第 3 小节']);
});
