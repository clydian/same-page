import { Play } from 'lucide-react';
import { useMessages } from '../../i18n';
import { pitchName } from './pitch-feedback';
import type { PracticeTake } from './practice-history';

const signed = (cents: number | null) => cents === null ? '—' : cents > 0 ? `+${cents}` : String(cents);

export function FeedbackTable({ notes, active, onPlay }: { notes: PracticeTake['notes']; active?: number; onPlay?: (index: number) => void }) {
  const t = useMessages('practice');
  return <div className="challenge-results" tabIndex={0} role="region" aria-label={t('sight.noteFeedback')}>
    <table><thead><tr>
      <th scope="col">{t('sight.measure')}</th><th scope="col">{t('sight.expected')}</th><th scope="col">{t('sight.feedback')}</th>
      <th scope="col">{t('sight.sung')}</th><th scope="col">{t('sight.pitchError')}</th><th scope="col">{t('sight.intervalError')}</th>
    </tr></thead><tbody>{notes.map((row, index) => {
      const pitch = (row.target === null ? row.targets : [row.target]).map(pitchName).join(' / ');
      return <tr key={index} data-active={index === active}>
        <td>{row.measure}</td>
        <td>{onPlay ? <button className="challenge-note-replay" type="button" onClick={() => onPlay(index)}
          aria-label={t('sight.replayFromNote', { index: index + 1, pitch })}><Play size={15} aria-hidden="true" />{pitch}</button> : pitch}</td>
        <td data-result>{t(`sight.${row.status}`)}</td><td>{row.sung === null ? '—' : pitchName(Math.round(row.sung))}</td>
        <td>{signed(row.cents)}</td><td>{signed(row.interval)}</td>
      </tr>;
    })}</tbody></table>
  </div>;
}
