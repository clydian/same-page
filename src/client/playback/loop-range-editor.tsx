import { useMessages } from "../../i18n";
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from 'react-aria-components';
import { MeasureRangeSlider } from './measure-range-slider';
import { useMeasureLabel } from "./measure-label";
import { PracticeSetting } from './practice-setting';
import type { PlayerSession, PlayerState } from '@same-page/player';

type Props = { rememberedRange?: number[] | null; onRememberRange?(values: number[]): void; session: PlayerSession | null; state: PlayerState; ready: boolean; onPreview(): void; onPreviewingChange(value: boolean): void };

export function LoopRangeEditor({ rememberedRange, onRememberRange, session, state, ready, onPreview, onPreviewingChange }: Props) {
  const t = useMessages("practice");
  const [draft, setDraft] = useState<number[] | null>(null);
  const pending = useRef<number[] | null>(null);
  const cancelled = useRef(false);
  const pointerActive = useRef(false);
  const localRange = useRef<number[] | null>(null);
  const remember = (values: number[]) => { localRange.current = [...values]; onRememberRange?.([...values]); };
  const [endpoint, setEndpoint] = useState(0);
  const range = draft ?? (state.loop ? [state.loop.start, state.loop.end] : [0, 0]);
  const formatMeasure = useMeasureLabel();
  const label = (index: number) => formatMeasure(state.measures[index], t("preparing"));
  const endpointLabel = endpoint === 0 ? t("startA") : t("endB");
  const cancel = useCallback(() => { cancelled.current = true; pending.current = null; setDraft(null); session?.previewMeasure(null); onPreviewingChange(false); }, [session, onPreviewingChange]);
  const apply = (values: number[]) => {
    pending.current = null; remember(values);
    session?.loop(values[0], values[1]); setDraft(null); onPreviewingChange(false);
  };
  const commit = () => { if (cancelled.current) return; if (pending.current) apply(pending.current); else { session?.previewMeasure(null); onPreviewingChange(false); } };
  useEffect(() => {
    const releasePointer = () => { pointerActive.current = false; };
    window.addEventListener('pointerup', releasePointer);
    window.addEventListener('pointercancel', releasePointer);
    window.addEventListener('blur', cancel);
    return () => { cancelled.current = true; pending.current = null; window.removeEventListener('pointerup', releasePointer); window.removeEventListener('pointercancel', releasePointer); window.removeEventListener('blur', cancel); session?.previewMeasure(null); onPreviewingChange(false); };
  }, [cancel, session, onPreviewingChange]);
  const change = (values: number[]) => {
    if (cancelled.current) return;
    const index = values[0] !== range[0] ? 0 : values[1] !== range[1] ? 1 : endpoint;
    setEndpoint(index); pending.current = values; setDraft(values); onPreview(); session?.previewMeasure(values[index], { start: values[0], end: values[1] });
  };
  return <section className="practice-loop" aria-label={t("loop")}>
    <PracticeSetting title={t("loop")} help={t("loopHelp")} selected={Boolean(state.loop)} disabled={!ready || !state.measures.length} onChange={enabled => {
      if (!enabled) { if (state.loop) remember([state.loop.start, state.loop.end]); cancel(); session?.loop(null); }
      else apply(rememberedRange ?? localRange.current ?? [0, state.measures.length - 1]);
    }} />
    {state.loop && <div className="practice-loop-content practice-setting-content">
      <div className="practice-loop-range"
          onPointerDownCapture={event => { cancelled.current = false; pointerActive.current = true; const thumb = (event.target as Element).closest('[data-loop-endpoint]'); const active = thumb ? Number(thumb.getAttribute('data-loop-endpoint')) : endpoint; setEndpoint(active); onPreview(); session?.previewMeasure(range[active], { start: range[0], end: range[1] }); onPreviewingChange(true); }} onPointerUpCapture={commit} onPointerCancelCapture={cancel}
          onKeyDownCapture={event => { if (event.key === 'Escape') { event.stopPropagation(); cancel(); } else if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','PageUp','PageDown'].includes(event.key)) { if (!pointerActive.current) cancelled.current = false; if (!cancelled.current) onPreviewingChange(true); } }} onKeyUpCapture={commit}>
        <p className="practice-loop-preview" role="status">{draft ? t("adjustingEndpoint", { endpoint: endpointLabel, measure: label(range[endpoint]) }) : t("loopingFromTo", { start: label(state.loop.start), end: label(state.loop.end) })}</p>
        <MeasureRangeSlider label={t("loopRange")} endpoints={[t("loopStart"), t("loopEnd")]} disabled={!ready}
          max={Math.max(0, state.measures.length - 1)} value={range} formatMeasure={label}
          onFocusEndpoint={setEndpoint} onChange={change} onChangeEnd={commit} />
      </div>
      <div className="practice-loop-endpoints">
        {[0, 1].map(index => <Button key={index} className="practice-endpoint" aria-label={index === 0 ? t("startA") : t("endB")} aria-pressed={endpoint === index} onPress={() => setEndpoint(index)}><span>{index === 0 ? t("startA") : t("endB")}</span><strong>{label(range[index])}</strong></Button>)}
      </div>
      <div className="practice-loop-stepper" role="group" aria-label={t("adjustByMeasure")}><span>{t("fineAdjustEndpoint", { endpoint: endpointLabel })}</span>
        {[-1, 1].map(delta => <Button key={delta} className="practice-action" aria-label={t(delta < 0 ? "adjustEndpointPrevious" : "adjustEndpointNext", { endpoint: endpoint === 0 ? t("loopStart") : t("loopEnd") })} isDisabled={!ready || range[endpoint] + delta < (endpoint === 0 ? 0 : range[0]) || range[endpoint] + delta > (endpoint === 0 ? range[1] : state.measures.length - 1)} onPress={() => { const values = range.map((value, index) => index === endpoint ? value + delta : value); onPreview(); session?.previewMeasure(values[endpoint], { start: values[0], end: values[1] }); apply(values); }}>{delta < 0 ? '−' : '+'}</Button>)}
      </div>
    </div>}
  </section>;
}
