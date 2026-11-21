import { useEffect, type RefObject } from 'react';
import type { PlayerSession } from '@same-page/player';
import type { PlaybackView } from './playback-store';

/** Publish stable chrome clearance; the player session alone owns scrolling. */
export function useNotationToolbarClearance(viewport: RefObject<HTMLElement | null>, session: Pick<PlayerSession, 'getSnapshot' | 'subscribe'> | null, enabled: boolean, view: PlaybackView = 'xml') {
  useEffect(() => {
    const scroll = viewport.current;
    if (!scroll || !session || !enabled) return;
    let frame = 0;
    const previousPadding = scroll.style.scrollPaddingTop;
    const place = () => {
      frame = 0;
      const area = scroll.getBoundingClientRect();
      const clearance = [...document.querySelectorAll<HTMLElement>('.practice-header[data-floating], .practice-notation-tools')]
        .map(toolbar => toolbar.getBoundingClientRect())
        .filter(tools => tools.width > 0 && tools.height > 0 && tools.right > area.left && tools.left < area.right && tools.bottom > area.top)
        .reduce((top, tools) => Math.max(top, tools.bottom + 12), area.top + 12) - area.top;
      const padding = `${clearance}px`;
      if (scroll.style.scrollPaddingTop === padding) return;
      scroll.style.scrollPaddingTop = padding;
      scroll.dispatchEvent(new Event('samepage:notation-clearance'));
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(place); };
    const observer = new ResizeObserver(schedule);
    observer.observe(scroll);
    document.querySelectorAll('.practice-header[data-floating], .practice-notation-tools').forEach(toolbar => observer.observe(toolbar));
    schedule();
    return () => { scroll.style.scrollPaddingTop = previousPadding; observer.disconnect(); cancelAnimationFrame(frame); };
  }, [viewport, session, enabled, view]);
}
