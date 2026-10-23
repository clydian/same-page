import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { Button, Slider, SliderThumb, SliderTrack } from 'react-aria-components';
import type { PlayerSession, PlayerState } from '@same-page/player';

type Props = { session: PlayerSession | null; state: PlayerState; ready: boolean; onPreview(): void; onPreviewingChange(value: boolean): void };

export function LoopRangeEditor({ session, state, ready, onPreview, onPreviewingChange }: Props) {
  const [editing, setEditing] = useState(false);
  const [range, setRange] = useState([0, 0]);
  const [endpoint, setEndpoint] = useState(0);
  const label = (index: number) => state.measures[index]?.label ?? '准备中';
  const cancel = useCallback(() => { session?.previewMeasure(null); setEditing(false); onPreviewingChange(false); }, [session, onPreviewingChange]);
  useEffect(() => {
    const release = () => onPreviewingChange(false);
    window.addEventListener('pointerup', release);
    window.addEventListener('blur', cancel);
    return () => { window.removeEventListener('pointerup', release); window.removeEventListener('blur', cancel); session?.previewMeasure(null); onPreviewingChange(false); };
  }, [cancel, session, onPreviewingChange]);
  const begin = () => {
    const start = state.loop?.start ?? state.measure;
    setRange([start, state.loop?.end ?? Math.min(state.measures.length - 1, start + 3)]);
    setEndpoint(0); setEditing(true); onPreview(); session?.previewMeasure(start);
  };
  const change = (values: number[]) => {
    const index = values[0] !== range[0] ? 0 : values[1] !== range[1] ? 1 : endpoint;
    setEndpoint(index); setRange(values); session?.previewMeasure(values[index]);
  };
  return <section className="practice-loop" aria-label="片段循环" data-editing={editing || undefined}>
    <div className="practice-loop-heading"><h3>片段循环</h3>{state.loop && !editing && <Button className="practice-action" onPress={() => session?.loop(null)} isDisabled={!ready}>关闭循环</Button>}</div>
    <p className="practice-hint" role="status">{state.loop ? `正在循环：${label(state.loop.start)} 至 ${label(state.loop.end)}` : '未开启循环'}</p>
    {!editing ? <Button className="practice-action" isDisabled={!ready} onPress={begin}>{state.loop ? '调整范围' : '选择循环片段'}</Button> : <>
      <div className="practice-loop-range"
          onPointerDownCapture={() => onPreviewingChange(true)} onPointerUpCapture={() => onPreviewingChange(false)} onPointerCancelCapture={cancel}
          onKeyDownCapture={event => { if (event.key === 'Escape') { event.stopPropagation(); cancel(); } else if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','PageUp','PageDown'].includes(event.key)) onPreviewingChange(true); }}
          onKeyUpCapture={() => onPreviewingChange(false)}>
        <p className="practice-loop-preview" role="status">正在调整{endpoint === 0 ? '起点 A' : '终点 B'} · {label(range[endpoint])}</p>
        <Slider aria-label="循环范围" minValue={0} maxValue={Math.max(0, state.measures.length - 1)} step={1} value={range} onChange={change}
          onChangeEnd={() => onPreviewingChange(false)} className="practice-range-slider">
          <SliderTrack className="practice-range-track">
            {({ state: slider }) => <>
              <div className="practice-range-fill" style={{ left: `${slider.getThumbPercent(0) * 100}%`, right: `${100 - slider.getThumbPercent(1) * 100}%` } as CSSProperties} />
              {[0, 1].map(index => <RangeThumb key={index} index={index} label={label(range[index])} coincident={range[0] === range[1]} onFocus={() => setEndpoint(index)} />)}
            </>}
          </SliderTrack>
        </Slider>
        <div className="practice-loop-labels"><span>A · {label(range[0])}</span><span>B · {label(range[1])}</span></div>
      </div>
      <div className="practice-loop-fine" role="group" aria-label="逐小节微调">
        {[0, 1].map(index => <Button key={index} className="practice-action" aria-pressed={endpoint === index} onPress={() => { setEndpoint(index); session?.previewMeasure(range[index]); }}>{index === 0 ? '起点 A' : '终点 B'}</Button>)}
        {[-1, 1].map(delta => <Button key={delta} className="practice-action" aria-label={`${endpoint === 0 ? '循环起点' : '循环终点'}${delta < 0 ? '前一小节' : '后一小节'}`} isDisabled={range[endpoint] + delta < (endpoint === 0 ? 0 : range[0]) || range[endpoint] + delta > (endpoint === 0 ? range[1] : state.measures.length - 1)} onPress={() => change(range.map((value, index) => index === endpoint ? value + delta : value))}>{delta < 0 ? '−' : '+'}</Button>)}
      </div>
      <p className="practice-hint">拖动时透视看谱；支持逐小节微调，包含终点整小节。</p>
      <div className="practice-fields"><Button className="practice-action" onPress={() => { session?.loop(range[0], range[1]); setEditing(false); onPreviewingChange(false); }}>应用范围</Button><Button className="practice-action" onPress={cancel}>取消调整</Button></div>
    </>}
  </section>;
}

// React Aria formats slider values as numbers; printed measure labels also carry repeat visits.
function RangeThumb({ index, label, coincident, onFocus }: { index: number; label: string; coincident: boolean; onFocus(): void }) {
  const input = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => { input.current?.setAttribute('aria-valuetext', label); });
  return <SliderThumb index={index} inputRef={input} aria-label={index === 0 ? '循环起点' : '循环终点'} className="practice-range-thumb" onFocus={onFocus} style={{ marginLeft: coincident ? index === 0 ? -18 : 18 : 0 }}><span aria-hidden="true">{index === 0 ? 'A' : 'B'}</span></SliderThumb>;
}
