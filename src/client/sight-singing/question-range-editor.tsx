import { useCallback, useEffect, useEffectEvent, useId, useRef, useState } from 'react';
import { useMessages } from '../../i18n';
import type { QuestionBeats } from '../../shared/sight-singing';
import { MeasureRangeSlider } from '../playback/measure-range-slider';
import { beatsInVisit, type MelodyScore } from './melody';
import { QuestionRangeScore } from './question-range-score';
import './question-range-editor.css';

type Props = {
  document: MelodyScore;
  first: number;
  last: number;
  beats: QuestionBeats;
  disabled: boolean;
  formatMeasure(visit: number): string;
  onRangeChange(first: number, last: number, beats: QuestionBeats): void;
};
type Drag = { pointerId: number; endpoint?: number; draft?: number[]; cancelled?: boolean };

export function QuestionRangeEditor({ document, first, last, beats, disabled, formatMeasure, onRangeChange }: Props) {
  const t = useMessages('practice');
  const id = useId();
  const [draft, setDraft] = useState<number[] | null>(null);
  const [endpoint, setEndpoint] = useState(0);
  const drag = useRef<Drag | null>(null);
  const range = draft ?? [first, last];
  const lastVisit = document.bars.length - 1;
  const count = (visit: number) => document.bars[visit] ? Math.max(1, beatsInVisit(document.bars[visit])) : 1;
  const fitBeats = ([start, end]: number[], moved: number): QuestionBeats => {
    let firstBeat = beats.firstBeat == null ? null : Math.min(beats.firstBeat, count(start));
    let lastBeat = beats.lastBeat == null ? null : Math.min(beats.lastBeat, count(end));
    if (start === end && firstBeat != null && lastBeat != null && firstBeat > lastBeat) {
      if (moved === 0) firstBeat = lastBeat;
      else lastBeat = firstBeat;
    }
    return { firstBeat, lastBeat };
  };
  const applyMeasures = (value: number[], moved: number) => onRangeChange(value[0], value[1], fitBeats(value, moved));
  const previewBeats = draft ? fitBeats(draft, endpoint) : beats;
  const cancel = useCallback(() => {
    if (!drag.current) return;
    drag.current.cancelled = true;
    setDraft(null);
  }, []);
  const commit = useEffectEvent(applyMeasures);
  useEffect(() => {
    const finish = (event: PointerEvent) => {
      const active = drag.current;
      if (active?.pointerId !== event.pointerId) return;
      drag.current = null;
      if (event.type === 'pointerup' && !active.cancelled && active.draft && active.endpoint !== undefined) {
        commit(active.draft, active.endpoint);
      }
      setDraft(null);
    };
    window.addEventListener('pointerup', finish, true);
    window.addEventListener('pointercancel', finish, true);
    window.addEventListener('blur', cancel);
    return () => {
      window.removeEventListener('pointerup', finish, true);
      window.removeEventListener('pointercancel', finish, true);
      window.removeEventListener('blur', cancel);
    };
  }, [cancel]);

  const start = formatMeasure(range[0]), end = formatMeasure(range[1]);
  const label = (measure: string, beat?: number | null, includesBeat = false) =>
    beat == null ? measure : `${measure} · ${t(includesBeat ? 'sight.throughBeat' : 'sight.beatNumber', { beat })}`;
  const summary = range[0] === range[1] && previewBeats.firstBeat == null && previewBeats.lastBeat == null ? start
    : t('measureRange', { start: label(start, previewBeats.firstBeat), end: label(end, previewBeats.lastBeat, true) });
  const editStart = endpoint === 0, visit = editStart ? first : last;
  const beat = editStart ? beats.firstBeat ?? 1 : beats.lastBeat ?? count(last);
  const measureLimits = editStart ? [0, last] : [first, lastVisit];
  const beatLimits = [!editStart && first === last ? beats.firstBeat ?? 1 : 1,
    editStart && first === last ? beats.lastBeat ?? count(visit) : count(visit)];
  const stepMeasure = (delta: number) => applyMeasures(editStart ? [first + delta, last] : [first, last + delta], endpoint);
  const stepBeat = (delta: number) => {
    const next = beat + delta;
    onRangeChange(first, last, editStart ? { ...beats, firstBeat: next === 1 ? null : next }
      : { ...beats, lastBeat: next === count(last) ? null : next });
  };
  const steps = [
    { value: visit, limits: measureLimits, text: formatMeasure(visit), previous: t('previousMeasure'), next: t('nextMeasure'), step: stepMeasure },
    { value: beat, limits: beatLimits, text: t(editStart ? 'sight.beatNumber' : 'sight.throughBeat', { beat }),
      previous: t('sight.previousBeat'), next: t('sight.nextBeat'), step: stepBeat },
  ];

  return <section className="challenge-range-editor" aria-labelledby={id}>
    <h2 id={id}>{t('sight.measureRange')}</h2>
    <p className="challenge-range-summary" role="status">{summary}</p>
    {document.visits.length > 1 && <div
      onPointerDownCapture={event => {
        if (disabled || !event.isPrimary || event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey) return;
        const thumb = (event.target as Element).closest('[data-loop-endpoint]');
        const target = thumb ? Number(thumb.getAttribute('data-loop-endpoint')) : undefined;
        drag.current = { pointerId: event.pointerId, endpoint: target };
        if (target !== undefined) setEndpoint(target);
      }}
      onKeyDownCapture={event => {
        if (event.key === 'Escape' && drag.current) { event.preventDefault(); event.stopPropagation(); cancel(); }
      }}>
      <MeasureRangeSlider label={t('sight.measureRange')} endpoints={[t('sight.first'), t('sight.last')]}
        max={lastVisit} value={range} disabled={disabled} separateTargets formatMeasure={formatMeasure}
        onFocusEndpoint={index => {
          const active = drag.current;
          if (active?.cancelled || active?.endpoint !== undefined && active.endpoint !== index) return;
          if (active) active.endpoint = index;
          setEndpoint(index);
        }}
        onChange={value => {
          const active = drag.current;
          if (active?.cancelled) return;
          const previous = active?.draft ?? [first, last];
          const moved = value[0] !== previous[0] ? 0 : value[1] !== previous[1] ? 1 : null;
          if (moved === null || active?.endpoint !== undefined && active.endpoint !== moved) return;
          setEndpoint(moved);
          if (active) { active.endpoint = moved; active.draft = value; setDraft(value); }
          else applyMeasures(value, moved);
        }} />
    </div>}
    <QuestionRangeScore document={document} first={range[0]} last={range[1]} active={range[endpoint]} beats={previewBeats} />
    <details className="challenge-range-advanced">
      <summary>{t('sight.rangeAdvanced')}</summary>
      <div className="challenge-range-tune">
        <div className="challenge-range-endpoints" role="group" aria-label={t('adjustByMeasure')}>
          {[t('startA'), t('endB')].map((name, index) => <button key={name} type="button"
            aria-pressed={endpoint === index} disabled={disabled} onClick={() => setEndpoint(index)}>{name}</button>)}
        </div>
        {steps.map(({ value, limits, text, previous, next, step }) => <div key={previous} className="challenge-range-step">
          <button type="button" aria-label={previous} disabled={disabled || value <= limits[0]} onClick={() => step(-1)}>−</button>
          <output>{text}</output>
          <button type="button" aria-label={next} disabled={disabled || value >= limits[1]} onClick={() => step(1)}>+</button>
        </div>)}
      </div>
    </details>
  </section>;
}
