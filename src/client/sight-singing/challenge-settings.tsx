import { Headphones, X } from 'lucide-react';
import { useId, type RefObject } from 'react';
import { useMessages } from '../../i18n';
import type { VoiceOption } from './challenge-run';
import { pitchName } from './pitch-feedback';

export function ChallengeSettings({ dialog, selected, voices, selectVoice, drone, setDrone, backing, setBacking, backingUnavailable }: {
  dialog: RefObject<HTMLDialogElement | null>;
  selected: VoiceOption; voices: VoiceOption[]; selectVoice: (id: string) => void;
  drone: boolean; setDrone: (enabled: boolean) => void;
  backing: boolean; setBacking: (enabled: boolean) => void; backingUnavailable: boolean;
}) {
  const t = useMessages('practice');
  const id = useId();
  const others = voices.filter(option => option.voice.id !== selected.voice.id);
  const ensembles = others.length > 0 || backingUnavailable;
  const hasBacking = backing && !backingUnavailable && others.length > 0;
  return <dialog ref={dialog} className="challenge-settings" aria-labelledby={`${id}-title`} closedby="any">
    <header>
      <h2 id={`${id}-title`}>{t('sight.practiceSetup')}</h2>
      <form method="dialog"><button type="submit" className="icon-button" aria-label={t('close')}><X size={20} aria-hidden="true" /></button></form>
    </header>
    <fieldset className="challenge-parts">
      <legend>{t('sight.singVoice')}</legend>
      <div>{voices.map(({ voice, label }) => <label key={voice.id}>
        <input type="radio" name={`${id}-part`} value={voice.id} checked={voice.id === selected.voice.id} onChange={() => selectVoice(voice.id)} />
        <span>{label}</span>
      </label>)}</div>
    </fieldset>
    <div className="challenge-audio-options">
      <label><span>{t('sight.drone', { pitch: pitchName(selected.melody.tonic) })}</span>
        <input type="checkbox" checked={drone} onChange={event => setDrone(event.target.checked)} />
      </label>
      {ensembles && <div>
        <label><span>{t('sight.ensembleBacking')}</span>
          <input type="checkbox" checked={hasBacking} disabled={backingUnavailable} onChange={event => setBacking(event.target.checked)} />
        </label>
        {backingUnavailable && <p>{t('sight.backingUnavailable')}</p>}
        {hasBacking && <p>{others.map(option => option.label).join(' · ')}</p>}
      </div>}
    </div>
    {(drone || hasBacking) && <p className="challenge-headphones" role="status"><Headphones size={18} aria-hidden="true" />{t('sight.headphones')}</p>}
  </dialog>;
}
