import { useRef, useState } from 'react';
export type Timeline = { value: number; max: number; step?: number; disabled: boolean; label(value: number): string; seek(value: number): void };
export function PlaybackTimeline({ timeline }: { timeline: Timeline }) {
  const [draft, setDraft] = useState<number | null>(null);
  const interaction = useRef<'pointer'|'keyboard'|null>(null);
  const commit = () => { if (draft !== null) { timeline.seek(draft); setDraft(null); } interaction.current = null; };
  return <input className="practice-timeline" aria-label="播放进度" aria-valuetext={timeline.label(draft ?? timeline.value)} title={timeline.label(draft ?? timeline.value)}
    type="range" min="0" max={timeline.max} step={timeline.step ?? 1} disabled={timeline.disabled} value={draft ?? timeline.value}
    onPointerDown={() => { interaction.current = 'pointer'; }} onKeyDown={() => { interaction.current = 'keyboard'; }}
    onChange={event => { const value = Number(event.target.value); if (interaction.current === null) timeline.seek(value); else setDraft(value); }} onPointerUp={commit} onKeyUp={commit} onBlur={commit} onPointerCancel={() => { interaction.current = null; setDraft(null); }} />;
}
