import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
export type Timeline = { value: number; max: number; step?: number; disabled: boolean; label(value: number): string; seek(value: number): void };
export function PlaybackTimeline({ timeline }: { timeline: Timeline }) {
  const [draft, setDraft] = useState<number | null>(null);
  const bubble = useRef<HTMLOutputElement>(null);
  const [halfWidth, setHalfWidth] = useState(72);
  const label = timeline.label(draft ?? timeline.value);
  useLayoutEffect(() => { if (bubble.current) setHalfWidth(bubble.current.getBoundingClientRect().width / 2 + 8); }, [label, draft]);
  const pending = useRef<number | null>(null);
  const interaction = useRef<'pointer'|'keyboard'|null>(null);
  const latest = useRef(timeline);
  useEffect(() => { latest.current = timeline; }, [timeline]);
  const preview = (value: number) => { pending.current = value; setDraft(value); };
  const cancel = useCallback(() => { pending.current = null; interaction.current = null; setDraft(null); }, []);
  const commit = useCallback(() => {
    const value = pending.current;
    cancel();
    if (value !== null && !latest.current.disabled) latest.current.seek(value);
  }, [cancel]);
  useEffect(() => {
    // A native range can release outside its bounds; commit exactly once there too.
    const release = () => { if (interaction.current === 'pointer') commit(); };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('blur', cancel);
    return () => {
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('blur', cancel);
    };
  }, [cancel, commit]);
  const percent = timeline.max > 0 ? (draft ?? timeline.value) / timeline.max * 100 : 0;
  return <div className="practice-timeline-track">
    {draft !== null && <output ref={bubble} className="practice-timeline-preview" style={{ left: `clamp(${halfWidth}px, calc(${percent}% + ${10 - percent * .2}px), calc(100% - ${halfWidth}px))` }}>{label}</output>}
    <input className="practice-timeline" aria-label="播放进度" aria-valuetext={label}
      type="range" min="0" max={timeline.max} step={timeline.step ?? 1} disabled={timeline.disabled} value={draft ?? timeline.value}
      onPointerDown={() => { interaction.current = 'pointer'; preview(timeline.value); }}
      onKeyDown={event => { if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','PageUp','PageDown'].includes(event.key)) interaction.current = 'keyboard'; if (event.key === 'Escape') cancel(); }}
      onChange={event => { const value = Number(event.target.value); if (interaction.current === null) timeline.seek(value); else preview(value); }}
      onPointerUp={commit} onKeyUp={() => { if (interaction.current === 'keyboard') commit(); }} onBlur={commit} onPointerCancel={cancel} />
  </div>;
}
