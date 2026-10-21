import assert from "node:assert/strict";
import { test } from "node:test";

import { isPointerDrag, ScoreFollowSession } from "../src/score-follow.ts";

test("score following starts enabled and ignores programmatic scrolls", () => {
  const session = new ScoreFollowSession();

  assert.equal(session.mode, "following");
  assert.equal(session.shouldSuspendForScroll(1000, false), false);
  assert.equal(session.mode, "following");
});

test("recent wheel or touch intent suspends follow only when scrolling occurs", () => {
  const session = new ScoreFollowSession();

  session.noteManualScrollIntent(1000);
  assert.equal(session.mode, "following");
  assert.equal(session.shouldSuspendForScroll(1700, false), true);
  session.suspend();
  assert.equal(session.mode, "manual");

  session.restore();
  assert.equal(session.mode, "following");
  assert.equal(session.shouldSuspendForScroll(1701, false), false);
});

test("expired input intent and stationary pointer presses do not suspend follow", () => {
  const session = new ScoreFollowSession();

  session.noteManualScrollIntent(1000);
  assert.equal(session.shouldSuspendForScroll(1801, false), false);
  assert.equal(isPointerDrag({ x: 20, y: 30 }, { x: 23, y: 34 }), false);
  assert.equal(session.shouldSuspendForScroll(1801, false), false);
});

test("a dragged scrollbar or touch pointer is treated as manual browsing", () => {
  const session = new ScoreFollowSession();
  const dragged = isPointerDrag({ x: 20, y: 30 }, { x: 20, y: 40 });

  assert.equal(dragged, true);
  assert.equal(session.shouldSuspendForScroll(1000, dragged), true);
  session.suspend();
  assert.equal(session.mode, "manual");
});
