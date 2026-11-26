import { AlphaTabApi, LayoutMode, NotationElement, PlayerMode, StaveProfile, type rendering } from '@coderline/alphatab';
import { useCallback, useEffect, useEffectEvent, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useMessages } from '../../i18n';
import { MeasureRangeSlider } from '../playback/measure-range-slider';
import type { MelodyScore } from './melody';
import './question-range-editor.css';

type Props = {
  document: MelodyScore;
  first: number;
  last: number;
  disabled: boolean;
  formatMeasure(visit: number): string;
  onRangeChange(first: number, last: number): void;
};

type Drag = { pointerId: number; draft?: number[]; cancelled?: boolean };

export function QuestionRangeEditor({ document, first, last, disabled, formatMeasure, onRangeChange }: Props) {
  const t = useMessages('practice');
  const id = useId();
  const [draft, setDraft] = useState<number[] | null>(null);
  const [endpoint, setEndpoint] = useState(0);
  const drag = useRef<Drag | null>(null);
  const range = draft ?? [first, last];
  const cancel = useCallback(() => {
    if (!drag.current) return;
    drag.current.cancelled = true;
    setDraft(null);
  }, []);
  const commit = useEffectEvent((value: number[]) => onRangeChange(value[0], value[1]));
  useEffect(() => {
    const finish = (event: PointerEvent) => {
      const active = drag.current;
      if (active?.pointerId !== event.pointerId) return;
      drag.current = null;
      if (event.type === 'pointerup' && !active.cancelled && active.draft) commit(active.draft);
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

  return <section className="challenge-range-editor" aria-labelledby={id}>
    <h2 id={id}>{t('sight.measureRange')}</h2>
    <p className="challenge-range-summary" role="status">{range[0] === range[1] ? formatMeasure(range[0])
      : t('measureRange', { start: formatMeasure(range[0]), end: formatMeasure(range[1]) })}</p>
    {document.visits.length > 1 && <div
      onPointerDownCapture={event => {
        if (disabled || !event.isPrimary || event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey) return;
        drag.current = { pointerId: event.pointerId };
      }}
      onKeyDownCapture={event => {
        if (event.key === 'Escape' && drag.current) { event.preventDefault(); event.stopPropagation(); cancel(); }
      }}>
      <MeasureRangeSlider label={t('sight.measureRange')} endpoints={[t('sight.first'), t('sight.last')]}
        max={document.visits.length - 1} value={range} disabled={disabled} formatMeasure={formatMeasure}
        onFocusEndpoint={setEndpoint} onChange={value => {
          const active = drag.current;
          if (active?.cancelled) return;
          setEndpoint(value[0] !== (active?.draft?.[0] ?? first) ? 0 : 1);
          if (active) { active.draft = value; setDraft(value); }
          else onRangeChange(value[0], value[1]);
        }} />
    </div>}
    <QuestionRangeScore document={document} first={range[0]} last={range[1]} active={range[endpoint]} />
    <div className="challenge-range">
      <div><label htmlFor={`${id}-first`}>{t('sight.first')}</label>
        <select id={`${id}-first`} name="first" value={first} disabled={disabled} onChange={event => {
          const next = Number(event.target.value);
          setEndpoint(0); onRangeChange(next, Math.max(next, last));
        }}>
          {document.visits.map((_, index) => <option key={index} value={index}>{formatMeasure(index)}</option>)}
        </select></div>
      <div><label htmlFor={`${id}-last`}>{t('sight.last')}</label>
        <select id={`${id}-last`} name="last" value={last} disabled={disabled} onChange={event => {
          setEndpoint(1); onRangeChange(first, Number(event.target.value));
        }}>
          {document.visits.map((_, index) => index >= first && <option key={index} value={index}>{formatMeasure(index)}</option>)}
        </select></div>
    </div>
  </section>;
}

function QuestionRangeScore({ document, first, last, active }: {
  document: MelodyScore; first: number; last: number; active: number;
}) {
  const t = useMessages('practice');
  const viewport = useRef<HTMLDivElement>(null), notation = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<rendering.BoundsLookup | null>(null);
  const { score, bars } = document;
  // Repeats share printed geometry, while the form still selects distinct playback visits.
  const selected = useMemo(() => new Set(bars.slice(first, last + 1).map(bar => bar.masterBar.index)), [bars, first, last]);
  const activeBar = bars[active]?.masterBar.index;

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
    const bounds = activeBar === undefined ? undefined : layout?.findMasterBarByIndex(activeBar)?.realBounds;
    if (!host || !bounds) return;
    const { scrollTop, scrollLeft, clientHeight, clientWidth } = host;
    if (bounds.y < scrollTop || bounds.y + bounds.h > scrollTop + clientHeight) {
      host.scrollTop = bounds.y - Math.max(0, (clientHeight - bounds.h) / 2);
    }
    if (bounds.x < scrollLeft || bounds.x + bounds.w > scrollLeft + clientWidth) host.scrollLeft = bounds.x;
  }, [layout, activeBar]);

  return <div ref={viewport} className="challenge-range-notation" role="region" tabIndex={0} aria-label={t('sight.notation')}>
    <div className="challenge-range-sheet" aria-hidden="true">
      <div ref={notation} />
      {layout?.staffSystems.flatMap(system => system.bars.map(bar => {
        if (!selected.has(bar.index)) return null;
        const { x, y, w, h } = bar.realBounds;
        return <span key={bar.index} className="challenge-range-highlight" data-bar={bar.index}
          data-active={bar.index === activeBar || undefined} style={{ left: x, top: y, width: w, height: h }} />;
      }))}
    </div>
  </div>;
}
