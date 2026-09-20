import { AlignLeft, AlignCenter, AlignRight, Minus, Plus } from "lucide-react";
import { useState } from "react";
import { inkSvgPaths } from "./ink-geometry";
import { Button, Label, Slider, SliderOutput, SliderThumb, SliderTrack } from "react-aria-components";
import type { AnnotationTool } from "./annotation-overlay";
import type { ToolStyle } from "./tool-style";
export function StyleFields({ tool, value, onChange, onCommit, preview = true }: {
  tool: AnnotationTool; value: ToolStyle; onChange(value: ToolStyle): void;
  onCommit?(value: ToolStyle): void; preview?: boolean;
}) {
  const choose = (next: ToolStyle) => { onChange(next); onCommit?.(next); };
  return <div className="annotation-style-fields" data-tool={tool}>
    {tool === "text" ? <><TextSizeField value={value.fontScale} onChange={fontScale => onChange({ ...value, fontScale })} onCommit={onCommit ? fontScale => onCommit({ ...value, fontScale }) : undefined} /><TextAlignmentButton value={value.textAlign} onChange={textAlign => choose({ ...value, textAlign })} /></> : <StyleSlider label={tool === "highlighter" ? "荧光笔宽度" : "线条粗细"} value={value.strokeWidth * 1000} min={1} max={tool === "highlighter" ? 60 : 20} onChange={strokeWidth => onChange({ ...value, strokeWidth: strokeWidth / 1000 })} onChangeEnd={onCommit ? strokeWidth => onCommit({ ...value, strokeWidth: strokeWidth / 1000 }) : undefined} />}
    {tool === "highlighter" && <StyleSlider label="不透明度" value={Math.round(value.opacity * 100)} min={5} max={100} suffix="%" onChange={opacity => onChange({ ...value, opacity: opacity / 100 })} onChangeEnd={onCommit ? opacity => onCommit({ ...value, opacity: opacity / 100 }) : undefined} />}
    {tool === "highlighter" && <div className="annotation-pressure-options" role="group" aria-label="荧光笔笔头">{(["round", "chisel"] as const).map(nib => <Button key={nib} aria-pressed={value.nib === nib} onPress={() => choose({ ...value, nib })}>{nib === "round" ? "圆头" : "扁头"}</Button>)}</div>}
    {tool === "ink" && <div className="annotation-pressure-options" role="group" aria-label="笔迹模式">{(["uniform", "pressure"] as const).map(mode => <Button key={mode} aria-pressed={value.pressureMode === mode} onPress={() => choose({ ...value, pressureMode: mode })}>{mode === "uniform" ? "等宽" : "压感"}</Button>)}</div>}
    {preview && <svg className="annotation-style-sample" viewBox="0 0 240 52" aria-label="样式预览">
      {tool === "text" ? <text x={value.textAlign === "left" ? 12 : value.textAlign === "right" ? 228 : 120} textAnchor={value.textAlign === "left" ? "start" : value.textAlign === "right" ? "end" : "middle"} y="32" fontSize={value.fontScale * 700} fill="currentColor">渐弱，留意指挥</text> : tool === "highlighter" ? <g transform="scale(.24 .052)">{inkSvgPaths({ kind: "ink", brush: "highlighter", nib: value.nib, pressureMode: "uniform", strokeWidth: value.strokeWidth * 2, pageNumber: 1, points: Array.from({ length: 16 }, (_, i) => ({ x: .1 + i * .053, y: .5 + Math.sin(i / 3) * .12 })) }, 240 / 52).map((path, index) => <path key={index} d={path} fill="currentColor" opacity={value.opacity} fillRule="evenodd" />)}</g> : <path d="M16 30 Q60 8 108 28 T224 22" fill="none" stroke="currentColor" strokeWidth={value.strokeWidth * 700} opacity={1} strokeLinecap="round" />}
    </svg>}
  </div>;
}
function StyleSlider({ label, value, min, max, suffix = "", onChange, onChangeEnd }: { label: string; value: number; min: number; max: number; suffix?: string; onChange(value: number): void; onChangeEnd?(value: number): void }) {
  return <Slider value={value} minValue={min} maxValue={max} step={1} onChange={value => onChange(value as number)} onChangeEnd={value => onChangeEnd?.(value as number)} className="annotation-style-slider">
    <Label>{label}</Label><SliderOutput>{({ state }) => `${Math.round(state.values[0]!)}${suffix}`}</SliderOutput>
    <SliderTrack>{({ state }) => <><div className="annotation-style-fill" style={{ width: `${state.getThumbPercent(0) * 100}%` }} /><SliderThumb /></>}</SliderTrack>
  </Slider>;
}

export function TextSizeField(props: TextSizeControlProps) {
  return <div className="annotation-text-size-field"><span className="annotation-style-label">字号</span><TextSizeControl {...props} /></div>;
}
interface TextSizeControlProps {
  value: number; onChange(value: number): void; onCommit?(value: number): void; disabled?: boolean;
}
export function TextSizeControl({ value, onChange, onCommit, disabled }: TextSizeControlProps) {
  const choose = (next: number) => { onChange(next); onCommit?.(next); };
  return <div className="annotation-composer-size" role="group" aria-label="文字字号">
    <button type="button" aria-label="减小字号" disabled={disabled || value <= .012} onClick={() => choose(Math.max(.012, value - .001))}><Minus size={17} /></button>
    <TextSizeInput className="annotation-font-scale__value" disabled={disabled} value={value} onChange={onChange} onCommit={onCommit} />
    <button type="button" aria-label="增大字号" disabled={disabled || value >= .08} onClick={() => choose(Math.min(.08, value + .001))}><Plus size={17} /></button>
  </div>;
}
export function TextAlignmentButton({ value, onChange, disabled }: {
  value: "left" | "center" | "right"; onChange(value: "left" | "center" | "right"): void; disabled?: boolean;
}) {
  return <button type="button" className="annotation-alignment-button"
    aria-label={`文字对齐：${{ left: "左对齐", center: "居中", right: "右对齐" }[value]}`}
    disabled={disabled} onClick={() => onChange(value === "left" ? "center" : value === "center" ? "right" : "left")}>
    {value === "left" ? <AlignLeft size={19} /> : value === "right" ? <AlignRight size={19} /> : <AlignCenter size={19} />}
  </button>;
}

export function TextSizeInput({ value, onChange, onCommit, disabled, className }: { value: number; onChange(value: number): void; onCommit?(value: number): void; disabled?: boolean; className?: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  return <input aria-label="字号数值" type="number" min={12} max={80} step={1} disabled={disabled} className={className} data-visible
    value={draft ?? Math.round(value * 1000)}
    onFocus={() => setDraft(String(Math.round(value * 1000)))}
    onChange={event => {
      setDraft(event.target.value);
      const next = event.target.valueAsNumber;
      if (Number.isFinite(next) && next >= 12 && next <= 80) onChange(Math.round(next) / 1000);
    }}
    onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } }}
    onBlur={() => {
      const next = draft?.trim() ? Number(draft) : NaN;
      if (Number.isFinite(next)) {
        const size = Math.min(80, Math.max(12, Math.round(next))) / 1000;
        onChange(size); onCommit?.(size);
      }
      setDraft(null);
    }} />;
}
