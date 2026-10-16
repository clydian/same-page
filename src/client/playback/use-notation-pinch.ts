import { useEffect, type RefObject } from 'react';
import type { PlayerState } from '@clydian/chorus-player';

type NotationPlayer = {
  getSnapshot(): Pick<PlayerState, 'status' | 'notationScale'>;
  notationScale(value: number): void;
};
type GestureEvent = Event & { scale: number };
const clampScale = (value: number) => Math.max(.3, Math.min(1.2, value));
const distance = (a: Touch, b: Touch) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);

/** Own pinch only inside XML notation; keep ordinary scrolling native. */
export function useNotationPinch(viewport: RefObject<HTMLDivElement | null>, player: NotationPlayer | null, enabled: boolean) {
  useEffect(() => {
    const element = viewport.current;
    if (!element || !player || !enabled) return;
    let pinch: { ids: number[]; distance: number; scale: number } | null = null;
    let suppressClick = false, blocked = false;
    const paper = element.querySelector<HTMLElement>('.practice-notation-paper');
    let pendingScale: number | null = null;
    const clearPreview = () => {
      paper?.style.removeProperty('transform');
      paper?.style.removeProperty('transform-origin');
    };
    const preview = (scale: number, base: number) => {
      pendingScale = clampScale(scale);
      if (paper) paper.style.transform = `scale(${pendingScale / base})`;
    };
    let gestureScale: number | null = null;
    let wheelScale = 0, wheelTime = -Infinity;
    const ready = () => player.getSnapshot().status === 'ready';
    const resize = (value: number) => {
      const scale = Math.round(clampScale(value) * 10) / 10;
      if (scale !== player.getSnapshot().notationScale) player.notationScale(scale);
    };
    const start = (event: TouchEvent) => {
      if (event.touches.length === 1) { suppressClick = false; blocked = false; }
      if (event.touches.length > 2) { cancel(); blocked = true; }
      if (event.touches.length !== 2 || blocked || !ready()) return;
      const [a, b] = Array.from(event.touches);
      const span = distance(a, b);
      if (!span) return;
      pinch = { ids: [a.identifier, b.identifier], distance: span, scale: player.getSnapshot().notationScale };
      suppressClick = true;
      pendingScale = null;
      if (paper) {
        const bounds = paper.getBoundingClientRect();
        paper.style.transformOrigin = `${(a.clientX + b.clientX) / 2 - bounds.left}px ${(a.clientY + b.clientY) / 2 - bounds.top}px`;
      }
      event.preventDefault();
      event.stopPropagation();
    };
    const move = (event: TouchEvent) => {
      if (!pinch) return;
      event.preventDefault();
      event.stopPropagation();
      const [a, b] = pinch.ids.map(id => Array.from(event.touches).find(touch => touch.identifier === id));
      if (event.touches.length !== 2 || !a || !b) { cancel(); blocked = true; return; }
      // Replacing alphaTab nodes mid-touch would detach the native touch target.
      // Preview on the paper, then reflow once on release.
      preview(pinch.scale * distance(a, b) / pinch.distance, pinch.scale);
    };
    const cancel = () => { pinch = null; pendingScale = null; clearPreview(); };
    const end = () => {
      const scale = pendingScale;
      cancel();
      if (scale !== null) resize(scale);
    };
    const pointerDown = (event: PointerEvent) => { if (event.pointerType !== 'touch') suppressClick = false; };
    const pointerMove = (event: PointerEvent) => {
      if (pinch && event.pointerType === 'touch') event.stopPropagation();
    };
    const click = (event: MouseEvent) => {
      // A pinch must not become alphaTab's click-to-seek on release.
      if (suppressClick && event.detail !== 0) { event.preventDefault(); event.stopImmediatePropagation(); }
    };
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey || !ready()) return;
      event.preventDefault();
      event.stopPropagation();
      if (gestureScale !== null) return;
      if (event.timeStamp - wheelTime > 200) wheelScale = player.getSnapshot().notationScale;
      wheelTime = event.timeStamp;
      wheelScale = clampScale(wheelScale * Math.exp(-event.deltaY * .005));
      resize(wheelScale);
    };
    // Safari trackpads expose gesture events instead of Ctrl+wheel.
    const gestureStart = (event: Event) => {
      if (!ready() || pinch) return;
      event.preventDefault(); gestureScale = player.getSnapshot().notationScale;
      pendingScale = null;
      if (paper) paper.style.transformOrigin = 'center top';
    };
    const gestureChange = (event: Event) => {
      if (gestureScale === null) return;
      event.preventDefault();
      const scale = (event as GestureEvent).scale;
      if (Number.isFinite(scale) && scale > 0) preview(gestureScale * scale, gestureScale);
    };
    const gestureEnd = (event: Event) => {
      if (gestureScale === null) return;
      event.preventDefault();
      gestureScale = null;
      end();
    };
    element.addEventListener('touchstart', start, { passive: false, capture: true });
    element.addEventListener('touchmove', move, { passive: false, capture: true });
    element.addEventListener('touchend', end);
    element.addEventListener('touchcancel', cancel);
    element.addEventListener('pointerdown', pointerDown, true);
    element.addEventListener('pointermove', pointerMove, true);
    element.addEventListener('click', click, true);
    element.addEventListener('wheel', wheel, { passive: false, capture: true });
    element.addEventListener('gesturestart', gestureStart, { passive: false });
    element.addEventListener('gesturechange', gestureChange, { passive: false });
    element.addEventListener('gestureend', gestureEnd, { passive: false });
    return () => {
      element.removeEventListener('touchstart', start, true);
      element.removeEventListener('touchmove', move, true);
      element.removeEventListener('touchend', end);
      element.removeEventListener('touchcancel', cancel);
      element.removeEventListener('pointerdown', pointerDown, true);
      element.removeEventListener('pointermove', pointerMove, true);
      cancel();
      element.removeEventListener('click', click, true);
      element.removeEventListener('wheel', wheel, true);
      element.removeEventListener('gesturestart', gestureStart);
      element.removeEventListener('gesturechange', gestureChange);
      element.removeEventListener('gestureend', gestureEnd);
    };
  }, [viewport, player, enabled]);
}
