import { useId } from 'react';
import { Switch } from 'react-aria-components';
import { useMessages } from '../../i18n';
import { PracticeDisclosure, PracticeVolume } from '../playback/practice-setting';
import type { ChallengeMix } from './use-challenge-mix';
import '../playback/practice-player.css';

export function ChallengePracticeSettings({ pitchTraceEnabled, setPitchTraceEnabled, mix, setMix }: {
  pitchTraceEnabled: boolean; setPitchTraceEnabled: (enabled: boolean) => void;
  mix: ChallengeMix; setMix: (change: (current: ChallengeMix) => ChallengeMix) => void;
}) {
  const t = useMessages('practice');
  const metronomeHelp = useId();
  return <>
    <Switch className="challenge-settings-switch" isSelected={pitchTraceEnabled} onChange={setPitchTraceEnabled}>
      <span>{t('sight.pitchMonitor')}</span><span className="challenge-settings-switch-track" aria-hidden="true" />
    </Switch>
    <div className="challenge-mixer">
      <PracticeDisclosure title={t('sight.mixer')}>
        <PracticeVolume title={t('sight.replayVoice')} value={mix.voice} onChange={voice => setMix(current => ({ ...current, voice }))} />
        <PracticeVolume title={t('sight.ensembleBacking')} value={mix.backing} onChange={backing => setMix(current => ({ ...current, backing }))} />
        <PracticeVolume title={t('sight.sustainedTonic')} value={mix.tonic} onChange={tonic => setMix(current => ({ ...current, tonic }))} />
      </PracticeDisclosure>
    </div>
    <Switch className="challenge-settings-switch" isSelected={mix.metronome} aria-describedby={metronomeHelp}
      onChange={metronome => setMix(current => ({ ...current, metronome }))}>
      <span>{t('metronome')}</span><span className="challenge-settings-switch-track" aria-hidden="true" />
    </Switch>
    <p id={metronomeHelp} className="challenge-settings-hint">{t('sight.metronomeHelp')}</p>
  </>;
}
