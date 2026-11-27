import { Monitor, Moon, Palette, Settings2, Sun } from 'lucide-react';
import { Button, DialogTrigger, Input, Label, NumberField, Popover, Switch } from 'react-aria-components';
import { useMessages } from '../../i18n';
import { Dialog } from '../navigation/overlays';
import type { PitchMode } from '../sight-singing/live-pitch';
import { PitchModeSelect } from '../sight-singing/pitch-mode-select';
import type { MonitorAppearance } from './pitch-monitor-appearance';

const minBpm = 40, maxBpm = 240;
export function BeatGridSettings({ bpm, showBeats, setBpm, setShowBeats, theme }: {
  theme?: 'dark' | 'light'; bpm: number; showBeats: boolean; setBpm: (value: number) => void; setShowBeats: (value: boolean) => void;
}) {
  const t = useMessages('practice');
  return <DialogTrigger>
    <Button className="pitch-monitor-action pitch-monitor-bpm" data-beats={showBeats || undefined}><span>{bpm} BPM</span></Button>
    <Popover placement="top start" className="pitch-monitor-popover pitch-monitor-theme" data-ui-theme={theme}>
      <Dialog aria-label="BPM" className="pitch-monitor-beat-settings">
        <NumberField className="pitch-monitor-bpm-field" value={bpm} onChange={value => {
          if (Number.isFinite(value)) setBpm(value);
        }} minValue={minBpm} maxValue={maxBpm} step={1}>
          <Label>BPM</Label>
          <Input inputMode="numeric" />
        </NumberField>
        <Switch className="pitch-monitor-beat-switch" isSelected={showBeats}
          onChange={setShowBeats}><span aria-hidden="true" />{t('pitchMonitor.showBeatLines')}</Switch>
      </Dialog>
    </Popover>
  </DialogTrigger>;
}

export function MonitorAppearanceSettings({ value, onChange, theme, pitchMode, pitchModeDisabled, onPitchModeChange }: {
  value: MonitorAppearance; onChange: (value: MonitorAppearance) => void; theme?: 'dark' | 'light';
  pitchMode: PitchMode; pitchModeDisabled: boolean; onPitchModeChange: (mode: PitchMode) => void;
}) {
  const t = useMessages('practice');
  const common = useMessages('common');
  const system = useMessages('system');
  const options = [
    { mode: 'app', label: t('pitchMonitor.followApp'), Icon: Monitor },
    { mode: 'dark', label: system('appearance.dark'), Icon: Moon },
    { mode: 'light', label: system('appearance.light'), Icon: Sun },
    { mode: 'custom', label: t('pitchMonitor.custom'), Icon: Palette },
  ] as const;
  return <DialogTrigger>
    <Button className="pitch-monitor-action pitch-monitor-icon pitch-monitor-appearance-button" aria-label={common('appearance')}>
      <Settings2 size={20} aria-hidden="true" />
    </Button>
    <Popover placement="top end" className="pitch-monitor-popover pitch-monitor-theme" data-ui-theme={theme}>
      <Dialog aria-label={common('appearance')} className="pitch-monitor-appearance">
        <fieldset className="appearance-fieldset">
          <legend>{common('appearance')}</legend>
          <div className="appearance-segments pitch-monitor-appearance-options">
            {options.map(({ mode, label, Icon }) => <label className="appearance-segment" key={mode}>
              <input type="radio" name="pitch-monitor-appearance" checked={value.mode === mode}
                onChange={() => onChange({ ...value, mode })} />
              <span><Icon size={17} aria-hidden="true" />{label}</span>
            </label>)}
          </div>
        </fieldset>
        {value.mode === 'custom' && <div className="pitch-monitor-colors">
          <label>{t('pitchMonitor.backgroundColor')}<input type="color" value={value.background}
            onChange={event => onChange({ ...value, background: event.target.value })} /></label>
          <label>{t('pitchMonitor.traceColor')}<input type="color" value={value.trace}
            onChange={event => onChange({ ...value, trace: event.target.value })} /></label>
        </div>}
        <PitchModeSelect className="pitch-monitor-mode" value={pitchMode}
          disabled={pitchModeDisabled} onChange={onPitchModeChange} />
      </Dialog>
    </Popover>
  </DialogTrigger>;
}
