import { useCallback, useLayoutEffect, useRef } from "react";
import type { ReaderPoint } from "./reader-zoom";

const DOUBLE_TAP_MS = 250;
const DOUBLE_TAP_DISTANCE = 24;
const TAP_MOVEMENT = 10;
const MAX_PRESS_MS = 500;

// One recognizer owns the delay. In particular, the second down pauses the
// first tap before the second up can cross the single-tap deadline.
export function useReaderTaps({ disabled, scope, revision, onSingle, onDouble }: {
  disabled: boolean;
  scope?: unknown;
  revision?: string;
  onSingle(point: ReaderPoint): void;
  onDouble(point: ReaderPoint): void;
}) {
  const pending = useRef<{ point: ReaderPoint; released: number; timer: ReturnType<typeof setTimeout> } | null>(null);
  const press = useRef<{ point: ReaderPoint; started: number; second: boolean } | null>(null);
  const callbacks = useRef({ onSingle, onDouble });
  useLayoutEffect(() => { callbacks.current = { onSingle, onDouble }; }, [onSingle, onDouble]);
  const cancel = useCallback(() => {
    if (pending.current) clearTimeout(pending.current.timer);
    pending.current = null;
    press.current = null;
  }, []);
  useLayoutEffect(() => { cancel(); return cancel; }, [cancel, disabled, scope, revision]);
  return {
    cancel,
    down(point: ReaderPoint) {
      if (disabled) return;
      const previous = pending.current;
      const second = !!previous && Date.now() - previous.released <= DOUBLE_TAP_MS &&
        Math.hypot(point.x - previous.point.x, point.y - previous.point.y) <= DOUBLE_TAP_DISTANCE;
      if (previous) {
        clearTimeout(previous.timer);
        pending.current = null;
        // A distant second contact starts a new sequence; don't navigate under
        // a finger using an old page's delayed intent.
      }
      press.current = { point, started: Date.now(), second };
    },
    move(point: ReaderPoint) {
      const active = press.current;
      if (active && Math.hypot(point.x - active.point.x, point.y - active.point.y) >= TAP_MOVEMENT) cancel();
    },
    up(point: ReaderPoint) {
      const active = press.current;
      press.current = null;
      if (!active || disabled || Date.now() - active.started > MAX_PRESS_MS ||
        Math.hypot(point.x - active.point.x, point.y - active.point.y) >= TAP_MOVEMENT) return;
      if (active.second) { callbacks.current.onDouble(point); return; }
      const timer = setTimeout(() => {
        const tap = pending.current;
        pending.current = null;
        if (tap) callbacks.current.onSingle(tap.point);
      }, DOUBLE_TAP_MS);
      pending.current = { point, released: Date.now(), timer };
    },
  };
}
