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
