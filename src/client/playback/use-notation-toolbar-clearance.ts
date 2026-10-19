import { useEffect, type RefObject } from 'react';
import type { PlayerSession } from '@clydian/chorus-player';

/** Host chrome must not cover the followed system. Manual browsing remains free. */
export function useNotationToolbarClearance(viewport: RefObject<HTMLElement | null>, session: PlayerSession | null, enabled: boolean) {
  useEffect(() => {
    const scroll = viewport.current;
    if (!scroll || !session || !enabled) return;
    let frame = 0;
    const place = () => {
      frame = 0;
      if (session.getSnapshot().following === false) return;
      const toolbar = scroll.closest('.practice-notation')?.querySelector<HTMLElement>('.practice-notation-tools') ?? document.querySelector<HTMLElement>('.practice-header[data-floating]');
      const cursor = scroll.querySelector<HTMLElement>('.at-cursor-bar');
      if (!toolbar || !cursor) return;
      const tools = toolbar.getBoundingClientRect(), bar = cursor.getBoundingClientRect(), area = scroll.getBoundingClientRect();
      if (bar.width === 0 || bar.height === 0) return;
      const overlapsTools = bar.right > tools.left && bar.left < tools.right && tools.bottom > area.top;
      const clearance = Math.max(area.top + 12, overlapsTools ? tools.bottom + 12 : area.top + 12);
      const bottom = area.bottom - 8;
      // Oversized systems cannot fit vertically: align their first staff so it
      // remains readable. Otherwise move only when chrome/edges obscure them.
      if (clearance < bottom - 44 && (bar.top < clearance || bar.bottom > bottom)) {
        scroll.scrollTop = Math.max(0, scroll.scrollTop + bar.top - clearance);
      }
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(place); };
    const release = session.subscribe(schedule);
    const observer = new ResizeObserver(schedule);
    observer.observe(scroll);
    const toolbar = scroll.closest('.practice-notation')?.querySelector<HTMLElement>('.practice-notation-tools') ?? document.querySelector<HTMLElement>('.practice-header[data-floating]');
    if (toolbar) observer.observe(toolbar);
    // alphaTab may move its cursor after publishing the player snapshot. Watch
    // that one DOM node so a late seek/reflow cannot leave the active system
    // behind chrome or outside the viewport. Beat cursor animation is ignored.
    const cursorObserver = new MutationObserver(schedule);
    let watchedCursor: HTMLElement | null = null;
    const watchCursor = () => {
      const cursor = scroll.querySelector<HTMLElement>('.at-cursor-bar');
      if (cursor !== watchedCursor) {
        cursorObserver.disconnect(); watchedCursor = cursor;
        if (cursor) cursorObserver.observe(cursor, { attributes: true, attributeFilter: ['style'] });
      }
    };
    const structureObserver = new MutationObserver(() => { watchCursor(); schedule(); });
    structureObserver.observe(scroll, { childList: true, subtree: true });
    watchCursor();
    const paper = scroll.querySelector<HTMLElement>('.practice-notation-paper');
    if (paper) observer.observe(paper);
    scroll.addEventListener('scroll', schedule, { passive: true });
    schedule();
    return () => { release(); observer.disconnect(); cursorObserver.disconnect(); structureObserver.disconnect(); scroll.removeEventListener('scroll', schedule); cancelAnimationFrame(frame); };
  }, [viewport, session, enabled]);
}
