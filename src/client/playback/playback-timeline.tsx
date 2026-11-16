import { FeedbackMessage } from '../components/feedback-message';
import { useFeedbackMessage } from '../components/use-feedback-message';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
export type Timeline = { value: number; min?: number; max: number; step?: number; disabled: boolean; label(value: number): string; seek(value: number): void; preview?(value: number | null): void };
export function PlaybackTimeline({ timeline }: { timeline: Timeline }) {
  const [draft, setDraft] = useState<number | null>(null);
  const feedback = useFeedbackMessage();
  const { setMessage, dismiss } = feedback;
  const bubble = useRef<HTMLOutputElement>(null);
  const [halfWidth, setHalfWidth] = useState(72);
  const label = timeline.label(draft ?? timeline.value);
  useLayoutEffect(() => { if (bubble.current) setHalfWidth(bubble.current.getBoundingClientRect().width / 2 + 8); }, [label, draft]);
  const pending = useRef<number | null>(null);
  const interaction = useRef<'pointer'|'keyboard'|'cancelled'|null>(null);
  const pointer = useRef<{ id: number; y: number } | null>(null);
  const latest = useRef(timeline);
  useEffect(() => { latest.current = timeline; }, [timeline]);
  const preview = (value: number) => { pending.current = value; setDraft(value); latest.current.preview?.(value); };
  const cancel = useCallback(() => { if (interaction.current === null || interaction.current === 'cancelled') return; pending.current = null; interaction.current = 'cancelled'; setDraft(null); setMessage('已取消跳转，播放位置未改变', { duration: 5000 }); latest.current.preview?.(null); }, [setMessage]);
  const commit = useCallback(() => {
    const value = pending.current;
    pending.current = null; interaction.current = null; setDraft(null);
    if (value !== null && !latest.current.disabled) latest.current.seek(value);
    else latest.current.preview?.(null);
  }, []);
  useEffect(() => {
    // A native range can release outside its bounds; commit exactly once there too.
    const release = (event: PointerEvent) => {
      if (pointer.current && event.pointerId !== pointer.current.id) return;
      move(event);
      pointer.current = null;
      if (interaction.current === 'pointer') commit();
    };
    const move = (event: PointerEvent) => {
      if (pointer.current && event.pointerId === pointer.current.id && Math.abs(event.clientY - pointer.current.y) > 72 && interaction.current === 'pointer') cancel();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', release);
    const abort = () => { cancel(); pointer.current = null; };
    window.addEventListener('pointercancel', abort);
    window.addEventListener('blur', abort);
    return () => {
      latest.current.preview?.(null);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', abort);
      window.removeEventListener('blur', abort);
    };
  }, [cancel, commit]);
  const min = timeline.min ?? 0;
  const percent = timeline.max > min ? ((draft ?? timeline.value) - min) / (timeline.max - min) * 100 : 0;
  return <><div className="practice-timeline-track" style={{ '--practice-progress': `${percent}%` } as CSSProperties}>
    {draft !== null && <output ref={bubble} className="practice-timeline-preview" style={{ left: `clamp(${halfWidth}px, calc(${percent}% + ${10 - percent * .2}px), calc(100% - ${halfWidth}px))` }}>{label}</output>}
    <input className="practice-timeline" aria-label="播放进度" aria-valuetext={label}
      type="range" min={min} max={timeline.max} step={timeline.step ?? 1} disabled={timeline.disabled} value={draft ?? timeline.value}
      onPointerDown={event => { if (pointer.current && interaction.current !== 'cancelled') return; pointer.current = { id: event.pointerId, y: event.clientY }; dismiss(); interaction.current = 'pointer'; preview(timeline.value); }}
      onKeyDown={event => { if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','PageUp','PageDown'].includes(event.key) && !pointer.current) interaction.current = 'keyboard'; if (event.key === 'Escape') cancel(); }}
      onChange={event => { const value = Number(event.target.value); if (interaction.current === null) timeline.seek(value); else if (interaction.current !== 'cancelled') preview(value); }}
      onKeyUp={() => { if (interaction.current === 'keyboard') commit(); }} onBlur={() => { if (interaction.current === 'keyboard') commit(); }} />
  </div><FeedbackMessage feedback={feedback} closeLabel="关闭跳转提示" /></>;
}
