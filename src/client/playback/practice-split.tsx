import { useLayoutEffect, useRef, useState } from 'react';
import { useElementSize } from '../reader/use-element-size';

type Direction = 'rows' | 'columns';
const GAP = 12;

function readRatio(ownerKey: string, direction: Direction) {
  try {
    const value = Number(localStorage.getItem(`practice-split:${ownerKey}:${direction}`));
    return value >= 0.2 && value <= 0.8 ? value : 0.5;
  } catch { return 0.5; }
}

// One measured frame supplies both PDF and XML bounds without remounting the player.
export function PracticeSplit({ active, ownerKey }: { active: boolean; ownerKey: string }) {
  const frame = useRef<HTMLDivElement>(null);
  const size = useElementSize(frame);
  const direction: Direction = (size.width >= 1000 && size.width > size.height) || (size.width >= 640 && size.height < 460) ? 'columns' : 'rows';
  const [ratios, setRatios] = useState(() => ({ rows: readRatio(ownerKey, 'rows'), columns: readRatio(ownerKey, 'columns') }));
  const extent = Math.max(1, (direction === 'columns' ? size.width : size.height) - GAP);
  const minimum = Math.min(0.4, (direction === 'columns' ? 240 : 160) / extent);
  const ratio = Math.max(minimum, Math.min(1 - minimum, ratios[direction]));
  const change = (value: number) => {
    const next = Math.max(minimum, Math.min(1 - minimum, value));
    setRatios(previous => ({ ...previous, [direction]: next }));
    try { localStorage.setItem(`practice-split:${ownerKey}:${direction}`, String(next)); } catch { /* The current session still works without storage. */ }
  };
  useLayoutEffect(() => {
    const root = document.documentElement;
    const frame = requestAnimationFrame(() => {
      root.dataset.practiceSplit = direction;
      root.style.setProperty('--practice-first', `${extent * ratio}px`);
    });
    return () => cancelAnimationFrame(frame);
  }, [direction, extent, ratio]);
  useLayoutEffect(() => () => {
    delete document.documentElement.dataset.practiceSplit;
    document.documentElement.style.removeProperty('--practice-first');
  }, []);
  return <div className="practice-split-frame" ref={frame} aria-hidden={!active || undefined}>
    {active && <div
      className="practice-split-handle"
      role="separator"
      tabIndex={0}
      aria-label="调整对照比例（双击恢复均分）"
      aria-orientation={direction === 'columns' ? 'vertical' : 'horizontal'}
      aria-valuemin={Math.round(minimum * 100)}
      aria-valuemax={Math.round((1 - minimum) * 100)}
      aria-valuenow={Math.round(ratio * 100)}
      aria-valuetext={`原始 PDF ${Math.round(ratio * 100)}%，重排谱面 ${100 - Math.round(ratio * 100)}%`}
      onDoubleClick={() => change(0.5)}
      onKeyDown={event => {
        const decrease = direction === 'columns' ? 'ArrowLeft' : 'ArrowUp';
        const increase = direction === 'columns' ? 'ArrowRight' : 'ArrowDown';
        if (![decrease, increase, 'Home', 'End', 'Enter'].includes(event.key)) return;
        event.preventDefault(); event.stopPropagation();
        change(event.key === 'Enter' ? 0.5 : event.key === 'Home' ? minimum : event.key === 'End' ? 1 - minimum : ratio + (event.key === decrease ? -0.05 : 0.05));
      }}
      onPointerDown={event => {
        if (!event.isPrimary || event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.focus({ preventScroll: true });
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={event => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
        const bounds = frame.current?.getBoundingClientRect();
        if (bounds) change(((direction === 'columns' ? event.clientX - bounds.left : event.clientY - bounds.top) - GAP / 2) / extent);
      }}
      onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
    ><span /></div>}
  </div>;
}
