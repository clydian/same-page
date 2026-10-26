import { useLayoutEffect, type RefObject } from 'react';

// React Aria writes maxHeight while delivering its overlay ResizeObserver.
// Keep the viewport limit independent of content growth; only this host-owned
// constraint changes, outside observer delivery. Aria still owns positioning.
export function usePracticePopoverHeight(popover: RefObject<HTMLElement | null>, trigger: RefObject<HTMLElement | null>, open: boolean) {
  useLayoutEffect(() => {
    const overlay = popover.current, anchor = trigger.current;
    if (!open || !overlay || !anchor) return;
    let frame = 0;
    const viewport = window.visualViewport;
    const measure = () => {
      frame = 0;
      const top = viewport?.offsetTop ?? 0;
      const bottom = top + (viewport?.height ?? window.innerHeight);
      const rect = anchor.getBoundingClientRect();
      // Match Popover's 12px container padding and 10px trigger offset.
      const height = `${Math.max(0, rect.top - top - 22, bottom - rect.bottom - 22)}px`;
      if (overlay.style.getPropertyValue('--practice-popover-height') !== height) {
        overlay.style.setProperty('--practice-popover-height', height);
      }
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    measure();
    const observer = new ResizeObserver(schedule);
    observer.observe(anchor);
    observer.observe(document.documentElement);
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
    };
  }, [popover, trigger, open]);
}
