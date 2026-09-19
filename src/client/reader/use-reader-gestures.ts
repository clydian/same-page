import {
  type PointerEvent as ReactPointerEvent,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
} from "react";

import { useReaderDismiss } from "./use-reader-dismiss";
import { FIT_ZOOM_TOLERANCE } from "./reader-zoom";
import { useReaderTaps } from "./use-reader-taps";
import { useReaderZoom, type ReaderZoomGeometry, type ReaderZoomGesture } from "./use-reader-zoom";
import type { PageTurnGesture } from "./use-paged-reader";

type GesturePointer = Pick<ReactPointerEvent<HTMLElement>, "pointerId" | "pointerType" | "clientX" | "clientY" | "timeStamp" | "currentTarget"> & { source?: "touch-event"; target?: EventTarget | null };

interface Point {
  x: number;
  y: number;
}

export function useReaderGestures({
  containerRef,
  contentRef,
  previewBoundaryRef,
  disabled,
  twoFingerOnly = false,
  zoom,
  onZoomChange,
  onTap,
  onDismiss,
  onEdgeTap,
  pageTurn,
  pageTurnExtent,
  nativeTouchScroll = false,
  zoomGeometry,
  gestureRevision,
  tapEnabled = true,
  tapScope,
  tapRevision,
  onNavigationStart,
  isObjectGestureActive,
}: {
  containerRef: RefObject<HTMLElement | null>;
  contentRef: RefObject<HTMLElement | null>;
  previewBoundaryRef?: RefObject<HTMLElement | null>;
  disabled: boolean;
  twoFingerOnly?: boolean;
  zoom: number;
  onZoomChange(value: number): void;
  onTap(): void;
  onDismiss?(): void;
  onEdgeTap?(direction: "previous" | "next"): void;
  pageTurn?: PageTurnGesture;
  pageTurnExtent?: number;
  nativeTouchScroll?: boolean;
  onNavigationStart?(): void;
  isObjectGestureActive?(): boolean;
  gestureRevision?: string;
  tapEnabled?: boolean;
  tapScope?: unknown;
  tapRevision?: string;
  zoomGeometry?: ReaderZoomGeometry;
}) {
  const interruptNotes = useEffectEvent(() => onNavigationStart?.());
  const zoomHandoff = useReaderZoom({ containerRef, contentRef, previewBoundaryRef, zoom, onZoomChange,
    geometry: zoomGeometry, continuous: nativeTouchScroll, scope: tapScope, revision: gestureRevision,
    mode: twoFingerOnly, disabled, navigation: pageTurn });
  const cancelZoom = zoomHandoff.cancel;
  const dismiss = useReaderDismiss({ containerRef, contentRef, onDismiss,
    enabled: !disabled && !twoFingerOnly && tapEnabled && zoom <= 1 + FIT_ZOOM_TOLERANCE });
  const cancelDismiss = dismiss.cancel;
  const objectPointers = useRef(new Set<string>());
  const points = useRef(new Map<string, Point>());
  const primary = useRef<{
    id: string;
    x: number;
    y: number;
  } | null>(null);
  const pinch = useRef<{ distance: number; gesture: ReaderZoomGesture } | null>(null);
  const pinched = useRef(false);
  const navigation = useRef<{ origin: Point; left: number; right: number; scrollLeft: number; scrollTop: number; extent: number } | null>(null);
  const scaled = useRef(false);
  const drained = useRef(false);
  const nativeAxis = useRef<"pending" | "horizontal" | "vertical">("pending");
  const pairFrame = useRef<number | null>(null);
  const pairTime = useRef(0);
  const taps = useReaderTaps({
    disabled: disabled || twoFingerOnly || !tapEnabled, scope: tapScope, revision: tapRevision,
    onSingle: (point) => {
      const bounds = containerRef.current?.getBoundingClientRect();
      if (bounds && bounds.width > 0 && onEdgeTap) {
        const x = point.x - bounds.left;
        if (x < bounds.width / 3) { onEdgeTap("previous"); return; }
        if (x >= bounds.width * 2 / 3) { onEdgeTap("next"); return; }
      }
      onTap();
    },
    onDouble: zoomHandoff.doubleTap,
  });
  const beginNavigation = (center: Point, time: number) => {
    const container = containerRef.current;
    const content = contentRef.current;
    if (!container || !content) return;
    const paper = content.getBoundingClientRect();
    const viewport = container.getBoundingClientRect();
    const extent = pageTurnExtent ?? viewport.width;
    navigation.current = { origin: center, left: Math.max(0, viewport.left - paper.left),
      right: Math.max(0, paper.right - viewport.right), scrollLeft: container.scrollLeft,
      scrollTop: container.scrollTop, extent };
    pageTurn?.begin({ sessionId: 0, x: 0, y: 0, time, extent });
  };
  const moveNavigation = (center: Point, time: number, nativeVertical = false) => {
    const session = navigation.current;
    const container = containerRef.current;
    if (!session || !container) return;
    const dx = center.x - session.origin.x;
    const dy = center.y - session.origin.y;
    const pan = clamp(dx, -session.right, session.left);
    container.scrollLeft = session.scrollLeft - pan;
    if (!nativeVertical) container.scrollTop = session.scrollTop - dy;
    zoomGeometry?.constrain();
    const remaining = dx - pan;
    // Rebase while inside the paper: neither pan distance nor its velocity
    // enters the pager, including after reversing a partial page turn.
    if (remaining === 0) {
      pageTurn?.cancel(0, true);
      pageTurn?.begin({ sessionId: 0, x: 0, y: 0, time, extent: session.extent });
    } else {
      pageTurn?.move({ sessionId: 0, x: remaining, y: Math.abs(dx) > Math.abs(dy) ? 0 : dy, time, extent: session.extent });
    }
  };

  const cancelPairFrame = useCallback(() => {
    if (pairFrame.current === null) return;
    cancelAnimationFrame(pairFrame.current);
    pairFrame.current = null;
  }, []);

  useLayoutEffect(() => () => { cancelPairFrame(); }, [cancelPairFrame]);

  useLayoutEffect(() => {
    // The drained sequence will swallow its release; retire the child
    // placement too so the next touch can start a new note.
    if (twoFingerOnly && points.current.size > 0) interruptNotes();
    cancelZoom();
    cancelDismiss();
    cancelPairFrame();
    navigation.current = null;
    pinch.current = null;
    drained.current = points.current.size > 0;
  }, [pageTurn, disabled, twoFingerOnly, tapScope, gestureRevision, cancelPairFrame, cancelZoom, cancelDismiss]);

  const drainSequence = () => {
    cancelZoom();
    cancelDismiss();
    cancelPairFrame();
    navigation.current = null;
    pinch.current = null;
    drained.current = points.current.size > 0;
  };

  const pointerDown = (event: GesturePointer) => {
    if (disabled || (twoFingerOnly && event.pointerType !== "touch")) return;
    if (event.target instanceof Element && !event.target.closest(".annotation-overlay") && event.target.closest("button, a, input, textarea, select, [role=button], [role=slider]")) { taps.cancel(); return; }
    if (!twoFingerOnly && !(nativeTouchScroll && event.pointerType === "touch")) {
      try { event.currentTarget.setPointerCapture?.(event.pointerId); } catch { /* The browser may already have retired this pointer. */ }
    }
    points.current.set(contactKey(event), { x: event.clientX, y: event.clientY });
    if (drained.current) return;
    if (points.current.size === 1) {
      if (!nativeTouchScroll || (containerRef.current?.scrollTop ?? 0) <= 1) dismiss.start({ x: event.clientX, y: event.clientY });
      taps.down({ x: event.clientX, y: event.clientY });
      primary.current = {
        id: contactKey(event),
        x: event.clientX,
        y: event.clientY,
      };
      pinched.current = false;
      scaled.current = false;
      nativeAxis.current = "pending";
      if (!twoFingerOnly) beginNavigation({ x: event.clientX, y: event.clientY }, event.timeStamp);
      return;
    }
    taps.cancel();
    dismiss.cancel();
    if (points.current.size > 2) {
      pageTurn?.cancel(0, true);
      drainSequence();
      return;
    }
    if (points.current.size !== 2) return;
    if (nativeAxis.current === "vertical") { drainSequence(); return; }
    if (!twoFingerOnly && pageTurn && !pageTurn.cancel(0, true)) { drainSequence(); return; }
    const content = contentRef.current;
    if (!content) return;
    if (twoFingerOnly) onNavigationStart?.();
    const [first, second] = [...points.current.values()];
    const center = midpoint(first, second);
    const gesture = zoomHandoff.begin(center);
    if (!gesture) return;
    pinch.current = { distance: distance(first, second), gesture };
    beginNavigation(center, event.timeStamp);
    pinched.current = true;
  };

  const samplePair = (time: number) => {
    if (drained.current || points.current.size !== 2 || !pinch.current) return;
    const [first, second] = [...points.current.values()];
    const center = midpoint(first, second);
    if (pageTurn && !scaled.current && Math.abs(distance(first, second) / pinch.current.distance - 1) <= 0.08) {
      moveNavigation(center, time);
      return;
    }
    scaled.current = true;
    pageTurn?.cancel(0, true);
    pinch.current.gesture.update(center, distance(first, second) / pinch.current.distance);
  };

  const flushPair = () => {
    if (pairFrame.current !== null) cancelAnimationFrame(pairFrame.current);
    pairFrame.current = null;
    samplePair(pairTime.current);
  };
  const pointerMove = (event: GesturePointer) => {
    if (disabled || !points.current.has(contactKey(event)) || drained.current) return;
    taps.move({ x: event.clientX, y: event.clientY });
    points.current.set(contactKey(event), { x: event.clientX, y: event.clientY });
    if (points.current.size === 2 && pinch.current) {
      pairTime.current = event.timeStamp;
      if (pairFrame.current === null) pairFrame.current = requestAnimationFrame(() => {
        pairFrame.current = null;
        samplePair(pairTime.current);
      });
      return;
    }
    if (!pinched.current && points.current.size === 1 && dismiss.move({ x: event.clientX, y: event.clientY })) {
      taps.cancel(); pageTurn?.cancel(0, true); return;
    }
    if (twoFingerOnly || pinched.current || nativeAxis.current === "vertical") return;
    moveNavigation({ x: event.clientX, y: event.clientY }, event.timeStamp,
      nativeTouchScroll && event.pointerType === "touch");
  };

  const resetGesture = () => {
    primary.current = null;
    pinch.current = null;
    pinched.current = false;
    navigation.current = null;
    drained.current = false;
    nativeAxis.current = "pending";
  };

  const finishPinch = () => {
    cancelPairFrame();
    pinch.current?.gesture.finish();
    resetGesture();
  };

  const finishPointer = (event: GesturePointer) => {
    if (disabled || !points.current.has(contactKey(event))) return;
    const start = primary.current;
    const wasPinched = pinched.current;
    if (wasPinched && points.current.size === 2 && pairFrame.current !== null) flushPair();
    points.current.delete(contactKey(event));
    if (drained.current) {
      if (points.current.size === 0) resetGesture();
      return;
    }
    if (wasPinched) {
      if (points.current.size === 1 && pageTurn && !scaled.current) {
        pageTurn.end({ sessionId: 0, x: 0, y: 0, time: event.timeStamp, extent: pageTurnExtent ?? 1 });
        cancelZoom();
        drained.current = true;
      } else if (points.current.size === 0) finishPinch();
      return;
    }
    if (twoFingerOnly || !start || start.id !== contactKey(event)) return;
    primary.current = null;
    if (dismiss.finish()) { taps.cancel(); pageTurn?.cancel(0, true); return; }
    if (pageTurn?.end({ sessionId: 0, x: 0, y: 0, time: event.timeStamp, extent: pageTurnExtent ?? 1 })) {
      taps.cancel();
      return;
    }
    taps.up({ x: event.clientX, y: event.clientY });
  };

  const cancelPointer = (event: GesturePointer) => {
    taps.cancel();
    if (!points.current.has(contactKey(event))) return;
    dismiss.cancel();
    points.current.delete(contactKey(event));
    pageTurn?.cancel(0);
    if (pairFrame.current !== null) cancelAnimationFrame(pairFrame.current);
    pairFrame.current = null;
    if (pinched.current) {
      cancelZoom();
      drained.current = points.current.size > 0;
      cancelPairFrame();

      if (points.current.size === 0) resetGesture();
    } else if (points.current.size === 0) {
      primary.current = null;
    }
  };

  // Native scrolling owns single-touch movement and momentum. Only a pinch
  // cancels the default touch action; both input paths share the zoom state.
  const handleTouch = useEffectEvent((event: TouchEvent) => {
    if (disabled) return;
    if (event.type === "touchmove" && event.touches.length === 1 && primary.current && dismiss.move({ x: event.touches[0].clientX, y: event.touches[0].clientY })) {
      if (event.cancelable) event.preventDefault();
    } else if (event.type === "touchmove" && event.touches.length === 1 && primary.current && nativeAxis.current === "pending") {
      const touch = event.touches[0];
      const dx = Math.abs(touch.clientX - primary.current.x);
      const dy = Math.abs(touch.clientY - primary.current.y);
      if (Math.max(dx, dy) >= 8) nativeAxis.current = dx > dy ? "horizontal" : "vertical";
    }
    if (nativeAxis.current !== "vertical" && (event.touches.length >= 2 || pinched.current || nativeAxis.current === "horizontal") && event.cancelable) event.preventDefault();
    const target = containerRef.current;
    if (!target) return;
    for (const touch of Array.from(event.changedTouches)) {
      const sample: GesturePointer = {
        source: "touch-event", pointerId: touch.identifier, pointerType: "touch",
        clientX: touch.clientX, clientY: touch.clientY,
        timeStamp: event.timeStamp, currentTarget: target, target: touch.target,
      };
      if (event.type === "touchstart") pointerDown(sample);
      else if (event.type === "touchmove") pointerMove(sample);
      else if (event.type === "touchend") finishPointer(sample);
      else cancelPointer(sample);
    }
  });
  useEffect(() => {
    const target = containerRef.current;
    if (!nativeTouchScroll || !target) return;
    const listener = (event: TouchEvent) => handleTouch(event);
    const types = ["touchstart", "touchmove", "touchend", "touchcancel"] as const;
    for (const type of types) target.addEventListener(type, listener, { passive: false });
    return () => { for (const type of types) target.removeEventListener(type, listener); };
  }, [containerRef, nativeTouchScroll]);

  const capture = (event: ReactPointerEvent<HTMLElement>, handle: (event: GesturePointer) => void) => {
    if (!twoFingerOnly || event.pointerType !== "touch" || !event.currentTarget.contains(event.target as Node)) return;
    // The child claims an object on its first pointerdown (after capture).
    // Keep that ownership through all releases, even if a cancellation clears
    // the child's transform before the other fingers leave the screen.
    const objectActive = isObjectGestureActive?.() ?? false;
    if (objectPointers.current.size > 0 || objectActive) {
      pageTurn?.cancel(0, true);
      cancelPairFrame(); cancelZoom();
      for (const id of points.current.keys()) objectPointers.current.add(id);
      points.current.clear();
      primary.current = null;
      if (event.type === "pointerup" || event.type === "pointercancel") objectPointers.current.delete(contactKey(event));
      else objectPointers.current.add(contactKey(event));
      // A cancelled child no longer owns these events. Drain the sequence
      // without letting a remaining/new finger start a fresh note.
      if (!objectActive) {
        event.preventDefault();
        event.stopPropagation();
      }
      return;
    }
    const suppress = drained.current || pinched.current || points.current.size >= 2;
    handle(event);
    if (suppress || pinched.current) {
      event.preventDefault();
      event.stopPropagation();
    }
  };
  return {
    onDoubleClick: (event: ReactMouseEvent<HTMLElement>) => { if (!twoFingerOnly) event.preventDefault(); },
    onPointerDownCapture: (event: ReactPointerEvent<HTMLElement>) => capture(event, pointerDown),
    onPointerMoveCapture: (event: ReactPointerEvent<HTMLElement>) => capture(event, pointerMove),
    onPointerUpCapture: (event: ReactPointerEvent<HTMLElement>) => capture(event, finishPointer),
    onPointerCancelCapture: (event: ReactPointerEvent<HTMLElement>) => capture(event, cancelPointer),
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => { if (!twoFingerOnly && !(nativeTouchScroll && event.pointerType === "touch")) pointerDown(event); },
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => { if (!twoFingerOnly && !(nativeTouchScroll && event.pointerType === "touch")) pointerMove(event); },
    onPointerUp: (event: ReactPointerEvent<HTMLElement>) => { if (!twoFingerOnly && !(nativeTouchScroll && event.pointerType === "touch")) finishPointer(event); },
    onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => { if (!twoFingerOnly && !(nativeTouchScroll && event.pointerType === "touch")) cancelPointer(event); },
  };
}

function midpoint(first: Point, second: Point) {
  return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
}

function distance(first: Point, second: Point) {
  return Math.max(1, Math.hypot(second.x - first.x, second.y - first.y));
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

// Touch identifiers and PointerEvent ids are unique only within their own API.
function contactKey(event: GesturePointer): string {
  return `${event.source ?? "pointer-event"}:${event.pointerId}`;
}
