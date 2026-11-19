import { useState } from 'react';
import { Label, Slider, SliderOutput, SliderThumb, SliderTrack } from 'react-aria-components';
import { useMessages } from '../../i18n';

export function LyricSizeControl({ value, disabled, onChange }: { value: number; disabled: boolean; onChange(value: number): void }) {
  const t = useMessages('practice');
  const [draft, setDraft] = useState<number | null>(null);
  return <Slider className="practice-lyric-slider" minValue={12} maxValue={18} step={.5} value={draft ?? value} isDisabled={disabled}
    onChange={setDraft} onChangeEnd={next => { setDraft(null); onChange(next); }}>
    <div className="practice-control-label"><Label>{t('lyricSize')}</Label><SliderOutput className="practice-control-value" /></div>
    <SliderTrack className="practice-lyric-track">
      {({ state }) => <>
        <div className="practice-lyric-fill" style={{ width: `${state.getThumbPercent(0) * 100}%` }} />
        <SliderThumb className="practice-lyric-thumb" />
      </>}
    </SliderTrack>
  </Slider>;
}
