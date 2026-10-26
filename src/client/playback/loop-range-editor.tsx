import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { Button, Slider, SliderThumb, SliderTrack } from 'react-aria-components';
import { PracticeSetting } from './practice-setting';
import type { PlayerSession, PlayerState } from '@same-page/player';

type Props = { rememberedRange?: number[] | null; onRememberRange?(values: number[]): void; session: PlayerSession | null; state: PlayerState; ready: boolean; onPreview(): void; onPreviewingChange(value: boolean): void };

export function LoopRangeEditor({ rememberedRange, onRememberRange, session, state, ready, onPreview, onPreviewingChange }: Props) {
  const [draft, setDraft] = useState<number[] | null>(null);
  const pending = useRef<number[] | null>(null);
  const localRange = useRef<number[] | null>(null);
  const remember = (values: number[]) => { localRange.current = [...values]; onRememberRange?.([...values]); };
  const [endpoint, setEndpoint] = useState(0);
  const range = draft ?? (state.loop ? [state.loop.start, state.loop.end] : [0, 0]);
  const label = (index: number) => state.measures[index]?.label ?? '准备中';
  const cancel = useCallback(() => { pending.current = null; setDraft(null); session?.previewMeasure(null); onPreviewingChange(false); }, [session, onPreviewingChange]);
  const apply = (values: number[]) => {
    pending.current = null; remember(values);
    session?.loop(values[0], values[1]); setDraft(null); onPreviewingChange(false);
  };
  const commit = () => { if (pending.current) apply(pending.current); else { session?.previewMeasure(null); onPreviewingChange(false); } };
  useEffect(() => {
    window.addEventListener('blur', cancel);
    return () => { window.removeEventListener('blur', cancel); session?.previewMeasure(null); onPreviewingChange(false); };
  }, [cancel, session, onPreviewingChange]);
  const change = (values: number[]) => {
    const index = values[0] !== range[0] ? 0 : values[1] !== range[1] ? 1 : endpoint;
    setEndpoint(index); pending.current = values; setDraft(values); onPreview(); session?.previewMeasure(values[index], { start: values[0], end: values[1] });
  };
  return <section className="practice-loop" aria-label="片段循环">
    <PracticeSetting title="片段循环" help="首次打开默认整曲循环，关闭即停止。拖动 A/B 端点时高亮整个待循环范围，松手后更新范围；包含终点完整小节。关闭后保留本次范围，再次开启可复用。" selected={Boolean(state.loop)} disabled={!ready || !state.measures.length} onChange={enabled => {
      if (!enabled) { if (state.loop) remember([state.loop.start, state.loop.end]); cancel(); session?.loop(null); }
      else apply(rememberedRange ?? localRange.current ?? [0, state.measures.length - 1]);
    }} />
    {state.loop && <div className="practice-loop-content practice-setting-content">
      <div className="practice-loop-range"
          onPointerDownCapture={event => { const thumb = (event.target as Element).closest('[data-loop-endpoint]'); const active = thumb ? Number(thumb.getAttribute('data-loop-endpoint')) : endpoint; setEndpoint(active); onPreview(); session?.previewMeasure(range[active], { start: range[0], end: range[1] }); onPreviewingChange(true); }} onPointerUpCapture={commit} onPointerCancelCapture={cancel}
          onKeyDownCapture={event => { if (event.key === 'Escape') { event.stopPropagation(); cancel(); } else if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','PageUp','PageDown'].includes(event.key)) onPreviewingChange(true); }} onKeyUpCapture={commit}>
        <p className="practice-loop-preview" role="status">{draft ? `正在调整${endpoint === 0 ? '起点 A' : '终点 B'} · ${label(range[endpoint])}` : `正在循环：${label(state.loop.start)} 至 ${label(state.loop.end)}`}</p>
        <Slider aria-label="循环范围" isDisabled={!ready} minValue={0} maxValue={Math.max(0, state.measures.length - 1)} step={1} value={range} onChange={change}
          onChangeEnd={commit} className="practice-range-slider">
          <SliderTrack className="practice-range-track">
            {({ state: slider }) => <>
              <div className="practice-range-fill" style={{ left: `${slider.getThumbPercent(0) * 100}%`, right: `${100 - slider.getThumbPercent(1) * 100}%` } as CSSProperties} />
              {[0, 1].map(index => <RangeThumb key={index} index={index} label={label(range[index])} coincident={range[0] === range[1]} onFocus={() => setEndpoint(index)} />)}
            </>}
          </SliderTrack>
        </Slider>
      </div>
      <div className="practice-loop-endpoints">
        {[0, 1].map(index => <Button key={index} className="practice-endpoint" aria-label={index === 0 ? '起点 A' : '终点 B'} aria-pressed={endpoint === index} onPress={() => setEndpoint(index)}><span>{index === 0 ? '起点 A' : '终点 B'}</span><strong>{label(range[index])}</strong></Button>)}
      </div>
      <div className="practice-loop-stepper" role="group" aria-label="逐小节微调"><span>微调{endpoint === 0 ? '起点 A' : '终点 B'}</span>
        {[-1, 1].map(delta => <Button key={delta} className="practice-action" aria-label={`${endpoint === 0 ? '循环起点' : '循环终点'}${delta < 0 ? '前一小节' : '后一小节'}`} isDisabled={!ready || range[endpoint] + delta < (endpoint === 0 ? 0 : range[0]) || range[endpoint] + delta > (endpoint === 0 ? range[1] : state.measures.length - 1)} onPress={() => { const values = range.map((value, index) => index === endpoint ? value + delta : value); onPreview(); session?.previewMeasure(values[endpoint], { start: values[0], end: values[1] }); apply(values); }}>{delta < 0 ? '−' : '+'}</Button>)}
      </div>
    </div>}
  </section>;
}

// React Aria formats slider values as numbers; printed measure labels also carry repeat visits.
function RangeThumb({ index, label, coincident, onFocus }: { index: number; label: string; coincident: boolean; onFocus(): void }) {
  const input = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => { input.current?.setAttribute('aria-valuetext', label); });
  return <SliderThumb data-loop-endpoint={index} index={index} inputRef={input} aria-label={index === 0 ? '循环起点' : '循环终点'} className="practice-range-thumb" onFocus={onFocus} style={{ marginLeft: coincident ? index === 0 ? -18 : 18 : 0 }}><span aria-hidden="true">{index === 0 ? 'A' : 'B'}</span></SliderThumb>;
}
