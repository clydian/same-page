import { useState } from 'react';
export type Timeline = { value: number; max: number; step?: number; disabled: boolean; label(value: number): string; seek(value: number): void };
export function PlaybackTimeline({ timeline }: { timeline: Timeline }) {
  const [draft, setDraft] = useState<number | null>(null);
  const commit = () => { if (draft !== null) { timeline.seek(draft); setDraft(null); } };
  return <input className="practice-timeline" aria-label="播放进度" aria-valuetext={timeline.label(draft ?? timeline.value)} title={timeline.label(draft ?? timeline.value)}
    type="range" min="0" max={timeline.max} step={timeline.step ?? 1} disabled={timeline.disabled} value={draft ?? timeline.value}
    onChange={event => setDraft(Number(event.target.value))} onPointerUp={commit} onKeyUp={commit} onBlur={commit} onPointerCancel={() => setDraft(null)} />;
}
