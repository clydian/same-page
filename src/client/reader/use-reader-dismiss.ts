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
  const gesture = useRef<{ origin: Point; distance: number; claimed: boolean; previousTranslate: string; previousScale: string } | null>(null);
  const rebound = useRef<Animation | null>(null);
  const cancel = useCallback((animate = false) => {
    const pending = gesture.current;
    const content = contentRef.current;
    rebound.current?.cancel(); rebound.current = null;
    if (pending && content) {
      const from = { translate: content.style.translate, scale: content.style.scale };
      content.style.translate = pending.previousTranslate;
      content.style.scale = pending.previousScale;
      if (animate && pending.claimed && content.animate && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
        rebound.current = content.animate([from, { translate: pending.previousTranslate || "0px", scale: pending.previousScale || "1" }], { duration: 160, easing: "ease-out" });
      }
    }
    containerRef.current?.removeAttribute("data-dismiss-label");
    gesture.current = null;
  }, [containerRef, contentRef]);
  const available = enabled && Boolean(onDismiss);
  useEffect(() => () => cancel(false), [cancel, available]);
  const threshold = () => Math.min(120, Math.max(80, (containerRef.current?.clientHeight ?? 0) * .18));
  return {
    cancel,
    start(point: Point) {
      cancel(false);
      if (enabled && onDismiss) gesture.current = { origin: point, distance: 0, claimed: false, previousTranslate: contentRef.current?.style.translate ?? "", previousScale: contentRef.current?.style.scale ?? "" };
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
      if (contentRef.current) {
        const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
        contentRef.current.style.translate = reduced ? pending.previousTranslate : `0 ${Math.min(180, pending.distance * .65)}px`;
        contentRef.current.style.scale = reduced ? pending.previousScale : String(1 - Math.min(.08, pending.distance / 2000));
      }
      containerRef.current?.setAttribute("data-dismiss-label", pending.distance >= threshold() ? "松开返回云盘" : "下滑返回云盘");
      return true;
    },
    finish() {
      const pending = gesture.current;
      const claimed = pending?.claimed ?? false;
      const close = claimed && pending!.distance >= threshold() && enabled;
      cancel(!close);
      if (close) onDismiss?.();
      return claimed;
    },
  };
}
