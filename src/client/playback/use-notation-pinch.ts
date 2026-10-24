import { useEffect, useRef, useState, type RefObject } from 'react';
import type { PlayerState } from '@same-page/player';

type NotationPlayer = {
  getSnapshot(): Pick<PlayerState, 'status'>;
  suspendFollow(): void;
  seekAt(x: number, y: number): void;
};
type Point = { x: number; y: number };
type GestureEvent = Event & { scale: number; clientX?: number; clientY?: number };
const clamp = (value: number) => Math.max(1, Math.min(4, value));
const distance = (a: Touch, b: Touch) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
const midpoint = (a: Touch, b: Touch): Point => ({ x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 });

/** Magnify the existing engraving. Its measured width never changes during a pinch. */
export function useNotationPinch(viewport: RefObject<HTMLDivElement | null>, player: NotationPlayer | null, enabled: boolean) {
  const [zoom, setZoom] = useState(1);
  const reset = useRef<() => void>(() => {});
  useEffect(() => {
    const element = viewport.current;
    const paper = element?.querySelector<HTMLElement>('.practice-notation-paper');
    const extent = paper?.parentElement;
    if (!element || !paper || !extent || !player || !enabled) return;
    let scale = 1, suppressClick = false, blocked = false;
    let tapStart: Point | null = null, tapMoved = false;
    let pinch: { ids: number[]; distance: number; scale: number; local: Point; center: Point; left: number; top: number } | null = null;
    let gesture: { scale: number; local: Point; center: Point } | null = null;
    const center = (): Point => { const r = element.getBoundingClientRect(); return { x: r.left + element.clientWidth / 2, y: r.top + element.clientHeight / 2 }; };
    const localAt = (point: Point): Point => { const r = paper.getBoundingClientRect(); return { x: (point.x - r.left) / scale, y: (point.y - r.top) / scale }; };
    let layoutWidth: number | null = null;
    const availableWidth = () => {
      const style = getComputedStyle(element);
      return Math.max(1, Math.min(1100, element.clientWidth - parseFloat(style.paddingLeft || '0') - parseFloat(style.paddingRight || '0')));
    };
    const size = () => {
      const width = availableWidth();
      layoutWidth = width;
      paper.style.width = `${width}px`;
      extent.style.width = `${width * scale}px`;
      extent.style.height = `${paper.offsetHeight * scale}px`;
    };
    const apply = (value: number, point = center(), local = localAt(point)) => {
      scale = clamp(value);
      paper.style.transform = `scale(${scale})`;
      size();
      const r = paper.getBoundingClientRect();
      element.scrollLeft += r.left + local.x * scale - point.x;
      element.scrollTop += r.top + local.y * scale - point.y;
      setZoom(scale);
    };
    reset.current = () => apply(1);
    const ready = () => player.getSnapshot().status === 'ready';
    const start = (event: TouchEvent) => {
      if (event.touches.length === 1) { suppressClick = false; blocked = false; }
      if (event.touches.length > 2) { cancel(); blocked = true; }
      if (event.touches.length !== 2 || blocked || !ready()) return;
      const [a, b] = Array.from(event.touches), span = distance(a, b);
      if (!span) return;
      const point = midpoint(a, b);
      pinch = { ids: [a.identifier, b.identifier], distance: span, scale, local: localAt(point), center: point, left: element.scrollLeft, top: element.scrollTop };
      suppressClick = true;
      player.suspendFollow();
      event.preventDefault(); event.stopPropagation();
    };
    const move = (event: TouchEvent) => {
      if (!pinch) return;
      event.preventDefault(); event.stopPropagation();
      const [a, b] = pinch.ids.map(id => Array.from(event.touches).find(touch => touch.identifier === id));
      if (event.touches.length !== 2 || !a || !b) { cancel(); blocked = true; return; }
      apply(pinch.scale * distance(a, b) / pinch.distance, midpoint(a, b), pinch.local);
    };
    const cancel = () => {
      if (pinch) {
        apply(pinch.scale, pinch.center, pinch.local);
        element.scrollLeft = pinch.left; element.scrollTop = pinch.top;
      }
      pinch = null;
    };
    const end = () => { pinch = null; };
    const pointerDown = (event: PointerEvent) => {
      if (event.pointerType !== 'touch') suppressClick = false;
      tapStart = { x: event.clientX, y: event.clientY }; tapMoved = false;
    };
    const pointerMove = (event: PointerEvent) => {
      if (tapStart && Math.hypot(event.clientX - tapStart.x, event.clientY - tapStart.y) > 6) tapMoved = true;
      if (pinch && event.pointerType === 'touch') event.stopPropagation();
    };
    // All taps cross the session's loop-aware seek seam, including magnified taps.
    const mouse = (event: MouseEvent) => { if (scale > 1) event.stopPropagation(); };
    const click = (event: MouseEvent) => {
      if (event.detail === 0) return;
      if (suppressClick && event.detail !== 0) { event.preventDefault(); event.stopImmediatePropagation(); return; }
      event.preventDefault(); event.stopImmediatePropagation();
      if (!tapMoved) {
          const engraving = paper.firstElementChild?.getBoundingClientRect() ?? paper.getBoundingClientRect();
          player.seekAt((event.clientX - engraving.left) / scale, (event.clientY - engraving.top) / scale);
      }
    };
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey || !ready()) return;
      event.preventDefault(); event.stopPropagation();
      if (gesture) return;
      player.suspendFollow();
      apply(scale * Math.exp(-event.deltaY * .005), { x: event.clientX, y: event.clientY });
    };
    const gestureStart = (event: Event) => {
      if (!ready() || pinch) return;
      event.preventDefault();
      const input = event as GestureEvent;
      const point = typeof input.clientX === 'number' && typeof input.clientY === 'number' && Number.isFinite(input.clientX) && Number.isFinite(input.clientY)
        ? { x: input.clientX, y: input.clientY } : center();
      gesture = { scale, center: point, local: localAt(point) };
      player.suspendFollow();
    };
    const gestureChange = (event: Event) => {
      if (!gesture) return;
      event.preventDefault();
      const value = (event as GestureEvent).scale;
      if (Number.isFinite(value) && value > 0) apply(gesture.scale * value, gesture.center, gesture.local);
    };
    const gestureEnd = (event: Event) => { if (gesture) { event.preventDefault(); gesture = null; } };
    const observer = new ResizeObserver(() => {
      // Restore logical coordinates before a viewport-width reflow so the
      // engine's manual-browsing anchor remains meaningful after rotation.
      if (layoutWidth !== null && layoutWidth !== availableWidth()) {
        pinch = null; gesture = null; blocked = true;
        if (scale !== 1) apply(1); else size();
      } else size();
    });
    observer.observe(element); observer.observe(paper);
    size();
    element.addEventListener('touchstart', start, { passive: false, capture: true });
    element.addEventListener('touchmove', move, { passive: false, capture: true });
    element.addEventListener('touchend', end);
    element.addEventListener('touchcancel', cancel);
    element.addEventListener('pointerdown', pointerDown, true);
    element.addEventListener('pointermove', pointerMove, true);
    element.addEventListener('mousedown', mouse, true); element.addEventListener('mouseup', mouse, true); element.addEventListener('mousemove', mouse, true);
    element.addEventListener('click', click, true);
    element.addEventListener('wheel', wheel, { passive: false, capture: true });
    element.addEventListener('gesturestart', gestureStart, { passive: false });
    element.addEventListener('gesturechange', gestureChange, { passive: false });
    element.addEventListener('gestureend', gestureEnd, { passive: false });
    return () => {
      observer.disconnect(); reset.current = () => {}; setZoom(1);
      paper.style.removeProperty('width'); paper.style.removeProperty('transform');
      extent.style.removeProperty('width'); extent.style.removeProperty('height');
      element.removeEventListener('touchstart', start, true); element.removeEventListener('touchmove', move, true);
      element.removeEventListener('touchend', end); element.removeEventListener('touchcancel', cancel);
      element.removeEventListener('pointerdown', pointerDown, true); element.removeEventListener('pointermove', pointerMove, true);
      element.removeEventListener('mousedown', mouse, true); element.removeEventListener('mouseup', mouse, true); element.removeEventListener('mousemove', mouse, true);
      element.removeEventListener('click', click, true); element.removeEventListener('wheel', wheel, true);
      element.removeEventListener('gesturestart', gestureStart); element.removeEventListener('gesturechange', gestureChange); element.removeEventListener('gestureend', gestureEnd);
    };
  }, [viewport, player, enabled]);
  return { zoom, reset: () => reset.current() };
}
