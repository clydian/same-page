import { useLayoutEffect, type RefObject } from 'react';

// React Aria writes maxHeight while delivering its overlay ResizeObserver.
// Keep the viewport limit independent of content growth; only this host-owned
// constraint changes, outside observer delivery. Aria still owns positioning.
export function usePracticePopoverHeight(popover: RefObject<HTMLElement | null>, trigger: RefObject<HTMLElement | null>, open: boolean, boundary: HTMLElement | null) {
  useLayoutEffect(() => {
    const overlay = popover.current, anchor = trigger.current;
    if (!open || !overlay || !anchor || !boundary) return;
    let frame = 0;
    const viewport = window.visualViewport;
    const measure = () => {
      frame = 0;
      // Intersect the visual viewport (browser chrome/keyboard/zoom) with the
      // CSS safe area. Aria and our independent size limit use the same bounds.
      const top = viewport?.offsetTop ?? 0, left = viewport?.offsetLeft ?? 0;
      const bottom = top + (viewport?.height ?? window.innerHeight);
      const right = left + (viewport?.width ?? window.innerWidth);
      for (const [edge, value] of Object.entries({ top, left, bottom: Math.max(0, window.innerHeight - bottom), right: Math.max(0, window.innerWidth - right) })) {
        const property = `--practice-viewport-${edge}`, next = `${value}px`;
        if (boundary.style.getPropertyValue(property) !== next) boundary.style.setProperty(property, next);
      }
      const safe = boundary.getBoundingClientRect();
      const rect = anchor.getBoundingClientRect();
      // Match Popover's 12px container padding and 10px trigger offset.
      const availableHeight = Math.max(rect.top - safe.top - 22, safe.bottom - rect.bottom - 22);
      const height = `${Math.max(0, Math.min(safe.height - 24, availableHeight))}px`;
      if (overlay.style.getPropertyValue('--practice-popover-height') !== height) {
        overlay.style.setProperty('--practice-popover-height', height);
      }
      const width = `${Math.max(0, safe.width - 24)}px`;
      if (overlay.style.getPropertyValue('--practice-popover-width') !== width) overlay.style.setProperty('--practice-popover-width', width);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    measure();
    const observer = new ResizeObserver(schedule);
    observer.observe(anchor);
    observer.observe(document.documentElement);
    observer.observe(boundary);
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    viewport?.addEventListener('resize', schedule);
    viewport?.addEventListener('scroll', schedule);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
      viewport?.removeEventListener('resize', schedule);
      viewport?.removeEventListener('scroll', schedule);
      overlay.style.removeProperty('--practice-popover-height');
      overlay.style.removeProperty('--practice-popover-width');
    };
  }, [popover, trigger, open, boundary]);
}
