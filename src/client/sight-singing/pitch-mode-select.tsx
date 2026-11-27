import { useMessages } from '../../i18n';
import type { PitchMode } from './live-pitch';
import './pitch-mode-select.css';

export function PitchModeSelect({ value, onChange, disabled, className }: {
  value: PitchMode | null; onChange: (mode: PitchMode) => void; disabled?: boolean; className?: string;
}) {
  const t = useMessages('practice');
  return <label className={className ? `pitch-mode-select ${className}` : "pitch-mode-select"}>
    <span>{t('pitchMode.label')}</span>
    <select value={value ?? ''} disabled={disabled} onChange={event => {
      const mode = event.target.value;
      if (mode === 'clear' || mode === 'all') onChange(mode);
    }}>
      {value === null && <option value="" disabled>{t('pitchMode.choose')}</option>}
      <option value="clear">{t('pitchMode.clear')}</option>
      <option value="all">{t('pitchMode.all')}</option>
    </select>
  </label>;
}
