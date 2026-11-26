import { useLayoutEffect, useRef } from 'react';
import { Slider, SliderThumb, SliderTrack } from 'react-aria-components';
import './measure-range-slider.css';

const markers = ['A', 'B'];

type Props = {
  label: string;
  endpoints: readonly [string, string];
  value: number[];
  max: number;
  disabled?: boolean;
  formatMeasure(index: number): string;
  onFocusEndpoint(index: number): void;
  onChange(value: number[]): void;
  onChangeEnd?(value: number[]): void;
};

export function MeasureRangeSlider({ label, endpoints, value, max, disabled, formatMeasure, onFocusEndpoint, onChange, onChangeEnd }: Props) {
  return <Slider aria-label={label} isDisabled={disabled} minValue={0} maxValue={max} step={1} value={value}
    onChange={onChange} onChangeEnd={onChangeEnd} className="practice-range-slider">
    <SliderTrack className="practice-range-track">
      {({ state }) => <>
        <div className="practice-range-fill" style={{ left: `${state.getThumbPercent(0) * 100}%`,
          right: `${100 - state.getThumbPercent(1) * 100}%` }} />
        {endpoints.map((name, index) => <RangeThumb key={index} index={index} name={name}
          valueText={formatMeasure(value[index])} coincident={value[0] === value[1]} onFocus={() => onFocusEndpoint(index)} />)}
      </>}
    </SliderTrack>
  </Slider>;
}

function RangeThumb({ index, name, valueText, coincident, onFocus }: {
  index: number; name: string; valueText: string; coincident: boolean; onFocus(): void;
}) {
  const input = useRef<HTMLInputElement>(null);
  // React Aria defaults to numeric value text, but a visit can carry a printed label and repeat pass.
  useLayoutEffect(() => { input.current?.setAttribute('aria-valuetext', valueText); });
  return <SliderThumb data-loop-endpoint={index} index={index} inputRef={input} aria-label={name}
    className="practice-range-thumb" onFocus={onFocus} style={{ marginLeft: coincident ? index === 0 ? -18 : 18 : 0 }}>
    <span aria-hidden="true">{markers[index]}</span>
  </SliderThumb>;
}
