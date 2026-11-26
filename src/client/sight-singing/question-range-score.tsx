import { AlphaTabApi, LayoutMode, NotationElement, PlayerMode, StaveProfile, type rendering } from '@coderline/alphatab';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useMessages } from '../../i18n';
import type { QuestionBeats } from '../../shared/sight-singing';
import { visitWindow, type MelodyScore } from './melody';

type TickWindow = ReturnType<typeof visitWindow>;

function measureEdge(bar: rendering.MasterBarBounds, tick: number, duration: number) {
  const { x, w } = bar.realBounds;
  if (tick <= 0) return x;
  if (tick >= duration) return x + w;
  let before = { tick: -1, x }, after = { tick: duration, x: x + w };
  for (const staff of bar.bars) for (const { beat, realBounds, onNotesX } of staff.beats) {
    const at = beat.playbackStart;
    // Use the printed note position for a cut within a sustained note. The
    // barline may be well to the left of its onset, especially after a clef.
    if (at >= 0 && at < tick && (at > before.tick || at === before.tick && onNotesX > before.x)) before = { tick: at, x: onNotesX };
    if (at >= tick && (at < after.tick || at === after.tick && realBounds.x < after.x)) after = { tick: at, x: realBounds.x };
  }
  if (after.tick === tick) return after.x;
  if (before.tick < 0) before.tick = 0;
  return before.x + (after.x - before.x) * (tick - before.tick) / (after.tick - before.tick);
}

function measureRect(bar: rendering.MasterBarBounds, window: TickWindow, duration: number) {
  const left = measureEdge(bar, window.from, duration);
  return { left, top: bar.realBounds.y, width: Math.max(1, measureEdge(bar, window.until, duration) - left), height: bar.realBounds.h };
}

export function QuestionRangeScore({ document, first, last, active, beats }: {
  document: MelodyScore; first: number; last: number; active: number; beats: QuestionBeats;
}) {
  const t = useMessages('practice');
  const viewport = useRef<HTMLDivElement>(null), notation = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<rendering.BoundsLookup | null>(null);
  const { score, bars } = document;
  // Merge the selected visits only for drawing their shared printed measure.
  const selected = useMemo(() => {
    const windows = new Map<number, { duration: number; ranges: TickWindow[] }>();
    for (let visit = first; visit <= last; visit++) {
      const bar = bars[visit];
      if (!bar) continue;
      const index = bar.masterBar.index;
      const item = windows.get(index) ?? { duration: bar.end - bar.start, ranges: [] };
      item.ranges.push(visitWindow(bar, visit === first ? beats.firstBeat : null, visit === last ? beats.lastBeat : null));
      windows.set(index, item);
    }
    for (const item of windows.values()) {
      const merged: TickWindow[] = [];
      for (const window of item.ranges.sort((a, b) => a.from - b.from)) {
        const previous = merged.at(-1);
        if (previous && previous.until >= window.from) previous.until = Math.max(previous.until, window.until);
        else merged.push(window);
      }
      item.ranges = merged;
    }
    return windows;
  }, [bars, first, last, beats.firstBeat, beats.lastBeat]);
  const activeVisit = bars[active], activeBar = activeVisit?.masterBar.index;
  const activeMeasure = activeBar === undefined ? null : layout?.findMasterBarByIndex(activeBar);
  const activeWindow = activeVisit ? visitWindow(activeVisit, active === first ? beats.firstBeat : null, active === last ? beats.lastBeat : null) : null;
  const activeRect = activeMeasure && activeWindow ? measureRect(activeMeasure, activeWindow, activeVisit.end - activeVisit.start) : null;
  const { left, top, width, height } = activeRect ?? {};

  useEffect(() => {
    if (!notation.current) return;
    const api = new AlphaTabApi(notation.current, {
      core: { fontDirectory: '/font/', engine: 'svg' },
      display: { scale: .8, layoutMode: LayoutMode.Page, staveProfile: StaveProfile.Score, justifyLastSystem: true },
      player: { playerMode: PlayerMode.Disabled, enableUserInteraction: false },
    });
    api.settings.notation.elements.set(NotationElement.ScoreTitle, false);
    api.settings.notation.elements.set(NotationElement.ScoreSubTitle, false);
    api.updateSettings();
    const update = () => setLayout(api.boundsLookup ?? null);
    api.postRenderFinished.on(update);
    api.renderScore(score, score.tracks.map(track => track.index));
    return () => { api.postRenderFinished.off(update); api.destroy(); };
  }, [score]);

  useLayoutEffect(() => {
    const host = viewport.current;
    if (!host || left === undefined || top === undefined || width === undefined || height === undefined) return;
    const { scrollTop, scrollLeft, clientHeight, clientWidth } = host;
    if (top < scrollTop || top + height > scrollTop + clientHeight) {
      host.scrollTop = top - Math.max(0, (clientHeight - height) / 2);
    }
    if (left < scrollLeft || left + width > scrollLeft + clientWidth) host.scrollLeft = left;
  }, [left, top, width, height]);

  return <div ref={viewport} className="challenge-range-notation" role="region" tabIndex={0} aria-label={t('sight.notation')}>
    <div className="challenge-range-sheet" aria-hidden="true">
      <div ref={notation} />
      {layout && [...selected].flatMap(([index, { ranges, duration }]) => {
        const bar = layout.findMasterBarByIndex(index);
        return bar ? ranges.map(window => <span key={`${index}:${window.from}`} className="challenge-range-highlight"
          data-bar={index} style={measureRect(bar, window, duration)} />) : [];
      })}
      {activeRect && <span className="challenge-range-active" data-active data-bar={activeBar} style={activeRect} />}
    </div>
  </div>;
}
