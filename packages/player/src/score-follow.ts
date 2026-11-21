export type ScoreFollowMode = "following" | "manual";

export interface PointerPosition {
  x: number;
  y: number;
}

const MANUAL_SCROLL_INTENT_WINDOW_MS = 800;
const POINTER_DRAG_THRESHOLD_PX = 6;

export const isPointerDrag = (
  start: PointerPosition,
  current: PointerPosition,
): boolean => Math.hypot(current.x - start.x, current.y - start.y) >= POINTER_DRAG_THRESHOLD_PX;

export class ScoreFollowSession {
  mode: ScoreFollowMode = "following";
  private manualScrollIntentUntil = 0;

  noteManualScrollIntent(now: number): void {
    this.manualScrollIntentUntil = now + MANUAL_SCROLL_INTENT_WINDOW_MS;
  }

  shouldSuspendForScroll(now: number, pointerDragged: boolean): boolean {
    return this.mode === "following" &&
      (pointerDragged || now <= this.manualScrollIntentUntil);
  }

  suspend(): void {
    this.mode = "manual";
    this.manualScrollIntentUntil = 0;
  }

  restore(): void {
    this.mode = "following";
    this.manualScrollIntentUntil = 0;
  }
}

/** Integrate the remaining expanded MIDI timeline, including tempo changes. */
export function playbackMillisecondsUntil(
  bar: { start: number; end: number; tempoChanges?: readonly { tick: number; tempo: number }[] },
  tick: number, end: number, tempo: number, speed: number,
): number | null {
  if (![bar.start, bar.end, tick, end, tempo, speed].every(Number.isFinite) ||
    tempo <= 0 || speed <= 0 || tick < bar.start || tick >= end || end !== bar.end) return null;
  let cursor = tick, bpm = tempo, milliseconds = 0, previous = bar.start;
  for (const change of bar.tempoChanges ?? []) {
    // Collection-local or incomplete coordinates cannot establish a deadline.
    if (!Number.isFinite(change.tick) || !Number.isFinite(change.tempo) || change.tempo <= 0 ||
      change.tick < previous || change.tick > end) return null;
    previous = change.tick;
    if (change.tick <= tick) continue;
    milliseconds += (change.tick - cursor) / 960 * 60000 / bpm;
    cursor = change.tick; bpm = change.tempo;
  }
  return (milliseconds + (end - cursor) / 960 * 60000 / bpm) / speed;
}

/** One owner for immediate positioning and deadline-bound system transitions. */
export class ScoreFollowScroll {
  static readonly windowMs = 120;
  static readonly settleMs = 24;
  private frame: number | null = null;
  private target: number | null = null;
  private readonly view: Window | null | undefined;

  private readonly viewport?: HTMLElement;

  constructor(viewport?: HTMLElement) {
    this.viewport = viewport;
    this.view = viewport?.ownerDocument?.defaultView;
  }

  cancel(): void {
    if (this.frame !== null) this.view?.cancelAnimationFrame(this.frame);
    this.frame = null; this.target = null;
  }

  finish(): void {
    const target = this.target;
    this.cancel();
    if (target !== null && this.viewport) this.viewport.scrollTop = target;
  }

  move(target: number, deadline?: number): void {
    this.cancel();
    const viewport = this.viewport, view = this.view;
    if (!viewport || !Number.isFinite(target)) return;
    const maximum = viewport.scrollHeight - viewport.clientHeight;
    const destination = Math.max(0, Number.isFinite(maximum) ? Math.min(maximum, target) : target);
    const began = view?.performance.now() ?? 0;
    const duration = deadline === undefined ? 0 : deadline - began;
    const immediate = () => !view || view.document.hidden || view.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (duration > ScoreFollowScroll.windowMs) return;
    if (!Number.isFinite(duration) || duration <= 0 || immediate()) {
      viewport.scrollTop = destination; return;
    }
    const from = viewport.scrollTop;
    this.target = destination;
    const step = () => {
      const progress = Math.min(1, Math.max(0, (view!.performance.now() - began) / duration));
      if (progress === 1 || immediate()) { this.finish(); return; }
      viewport.scrollTop = from + (destination - from) * (1 - (1 - progress) ** 3);
      this.frame = view!.requestAnimationFrame(step);
    };
    this.frame = view!.requestAnimationFrame(step);
  }
}
