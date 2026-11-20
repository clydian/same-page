import { useEffect, type RefObject } from 'react';
import type { PlayerSession } from '@same-page/player';
import type { PlaybackView } from './playback-store';

/** Host chrome must not cover the followed system. Manual browsing remains free. */
export function useNotationToolbarClearance(viewport: RefObject<HTMLElement | null>, session: Pick<PlayerSession, 'getSnapshot' | 'subscribe'> | null, enabled: boolean, view: PlaybackView = 'xml') {
  useEffect(() => {
    const scroll = viewport.current;
    if (!scroll || !session || !enabled) return;
    let frame = 0;
    let measure = session.getSnapshot().measure;
    let waitingForCursor = false;
    const previousPadding = scroll.style.scrollPaddingTop;
    const place = () => {
      frame = 0;
      const state = session.getSnapshot();
      if (state.following === false || state.previewing) return;
      const cursor = scroll.querySelector<HTMLElement>('.at-cursor-bar');
      if (!cursor) return;
      const bar = cursor.getBoundingClientRect(), area = scroll.getBoundingClientRect();
      if (bar.width === 0 || bar.height === 0) return;
      const clearance = [...document.querySelectorAll<HTMLElement>('.practice-header[data-floating], .practice-notation-tools')]
        .map(toolbar => toolbar.getBoundingClientRect())
        .filter(tools => tools.width > 0 && tools.height > 0 && bar.right > tools.left && bar.left < tools.right && tools.bottom > area.top)
        .reduce((top, tools) => Math.max(top, tools.bottom + 12), area.top + 12);
      // Share the actual reading edge with playback follow.
      scroll.style.scrollPaddingTop = `${clearance - area.top}px`;
      const bottom = area.bottom - 8;
      // Oversized systems cannot fit vertically: align their first staff so it
      // remains readable. Otherwise move only when chrome/edges obscure them.
      if (!waitingForCursor && clearance < bottom - 44 && (bar.top < clearance || bar.bottom > bottom)) {
        scroll.scrollTop = Math.max(0, scroll.scrollTop + bar.top - clearance);
      }
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(place); };
    const release = session.subscribe(() => {
      const next = session.getSnapshot().measure;
      // Position state can arrive before alphaTab paints the new bar cursor.
      // Do not undo the system follow using the previous system's rectangle.
      if (next !== measure) { measure = next; waitingForCursor = true; }
      schedule();
    });
    const observer = new ResizeObserver(schedule);
    observer.observe(scroll);
    document.querySelectorAll('.practice-header[data-floating], .practice-notation-tools').forEach(toolbar => observer.observe(toolbar));
    // alphaTab may move its cursor after publishing the player snapshot. Watch
    // that one DOM node so a late seek/reflow cannot leave the active system
    // behind chrome or outside the viewport. Beat cursor animation is ignored.
    const cursorObserver = new MutationObserver(() => { waitingForCursor = false; schedule(); });
    let watchedCursor: HTMLElement | null = null;
    const watchCursor = () => {
      const cursor = scroll.querySelector<HTMLElement>('.at-cursor-bar');
      if (cursor !== watchedCursor) {
        cursorObserver.disconnect(); watchedCursor = cursor;
        waitingForCursor = false;
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
    return () => { scroll.style.scrollPaddingTop = previousPadding; release(); observer.disconnect(); cursorObserver.disconnect(); structureObserver.disconnect(); scroll.removeEventListener('scroll', schedule); cancelAnimationFrame(frame); };
  }, [viewport, session, enabled, view]);
}
