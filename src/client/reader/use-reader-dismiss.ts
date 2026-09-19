import { type RefObject, useCallback, useEffect, useRef } from "react";

interface Point { x: number; y: number }

// A downward drag owns only a single reading contact at the top of a fitted
// page. Once rejected, it cannot take over an ongoing pan or native scroll.
export function useReaderDismiss({ containerRef, contentRef, enabled, onDismiss }: {
  containerRef: RefObject<HTMLElement | null>;
  contentRef: RefObject<HTMLElement | null>;
  enabled: boolean;
  onDismiss?: () => void;
}) {
  const gesture = useRef<{ origin: Point; distance: number; claimed: boolean; previousTranslate: string } | null>(null);
  const cancel = useCallback(() => {
    const pending = gesture.current;
    if (pending && contentRef.current) contentRef.current.style.translate = pending.previousTranslate;
    containerRef.current?.removeAttribute("data-dismiss-label");
    gesture.current = null;
  }, [containerRef, contentRef]);
  const available = enabled && Boolean(onDismiss);
  useEffect(() => cancel, [cancel, available]);
  const threshold = () => Math.min(120, Math.max(80, (containerRef.current?.clientHeight ?? 0) * .18));
  return {
    cancel,
    start(point: Point) {
      cancel();
      if (enabled && onDismiss) gesture.current = { origin: point, distance: 0, claimed: false, previousTranslate: contentRef.current?.style.translate ?? "" };
    },
    move(point: Point) {
      const pending = gesture.current;
      if (!pending) return false;
      const dx = point.x - pending.origin.x;
      const dy = point.y - pending.origin.y;
      if (!pending.claimed) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) < 8) return false;
        if (dy <= 0 || dy < Math.abs(dx) * 1.25) { cancel(); return false; }
        pending.claimed = true;
      }
      pending.distance = Math.max(0, dy);
      if (contentRef.current) contentRef.current.style.translate = `0 ${Math.min(180, pending.distance * .65)}px`;
      containerRef.current?.setAttribute("data-dismiss-label", pending.distance >= threshold() ? "松开关闭乐谱" : "下滑关闭乐谱");
      return true;
    },
    finish() {
      const pending = gesture.current;
      const claimed = pending?.claimed ?? false;
      const close = claimed && pending!.distance >= threshold() && enabled;
      cancel();
      if (close) onDismiss?.();
      return claimed;
    },
  };
}
