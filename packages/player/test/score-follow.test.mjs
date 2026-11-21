import assert from "node:assert/strict";
import { test } from "node:test";

import { isPointerDrag, ScoreFollowSession, ScoreFollowScroll, playbackMillisecondsUntil } from "../src/score-follow.ts";

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

test("remaining playback time integrates tempo changes and playback speed", () => {
 const bar={start:0,end:3840,tempoChanges:[{tick:0,tempo:120},{tick:3600,tempo:240}]};
 assert.equal(playbackMillisecondsUntil(bar,3480,3840,120,1),125);
 assert.equal(playbackMillisecondsUntil(bar,3480,3840,120,2),62.5);
 assert.equal(playbackMillisecondsUntil({...bar,start:4000,end:7840},7480,7840,120,1),null,'piece-local ticks cannot predict a global deadline');
 assert.equal(playbackMillisecondsUntil(bar,3480,3840,120,0),null);
});

test("system transition stays inside its deadline, cancels, and never replays late frames", () => {
 let now=0,id=0,reduced=false,hidden=false;const frames=new Map();
 const view={performance:{now:()=>now},document:{get hidden(){return hidden;}},matchMedia:()=>({matches:reduced}),requestAnimationFrame(fn){frames.set(++id,fn);return id;},cancelAnimationFrame(key){frames.delete(key);}};
 const viewport={scrollTop:0,scrollHeight:2000,clientHeight:600,ownerDocument:{defaultView:view}};
 const scroll=new ScoreFollowScroll(viewport);
 const advance=time=>{now=time;const pending=[...frames.values()];frames.clear();pending.forEach(fn=>fn(time));};
 scroll.move(400,200);assert.equal(viewport.scrollTop,0,'cannot start before the 120ms window');assert.equal(frames.size,0);
 now=100;scroll.move(400,200);advance(125);const middle=viewport.scrollTop;assert.ok(middle>0&&middle<400);advance(200);assert.equal(viewport.scrollTop,400);assert.equal(frames.size,0);
 now=300;scroll.move(800,400);advance(325);scroll.cancel();const cancelled=viewport.scrollTop;advance(500);assert.equal(viewport.scrollTop,cancelled);
 scroll.move(1000,400);assert.equal(viewport.scrollTop,1000,'missed deadline is immediate');
 now=600;scroll.move(1200,700);advance(1000);assert.equal(viewport.scrollTop,1200);assert.equal(frames.size,0,'background delay cannot replay a transition');
 reduced=true;now=1100;scroll.move(1400,1200);assert.equal(viewport.scrollTop,1400);assert.equal(frames.size,0);
 reduced=false;hidden=true;scroll.move(0,1200);assert.equal(viewport.scrollTop,0);assert.equal(frames.size,0);
});
