import { Play } from 'lucide-react';
import { useMessages } from '../../i18n';
import { formatCents, pitchName, type assessNotes } from './pitch-feedback';

export type NoteFeedback = Omit<ReturnType<typeof assessNotes>[number], 'note'> & { measure: string; targets: number[] };

export function FeedbackTable({ notes, active, onPlay }: { notes: NoteFeedback[]; active?: number; onPlay?: (index: number) => void }) {
  const t = useMessages('practice');
  return <div className="challenge-results" tabIndex={0} role="region" aria-label={t('sight.noteFeedback')}>
    <table><thead><tr>
      <th scope="col">{t('sight.measure')}</th><th scope="col">{t('sight.expected')}</th><th scope="col">{t('sight.feedback')}</th>
      <th scope="col">{t('sight.sung')}</th><th scope="col">{t('sight.pitchError')}</th><th scope="col">{t('sight.intervalError')}</th>
    </tr></thead><tbody>{notes.map((row, index) => {
      const pitch = (row.target === null ? row.targets : [row.target]).map(pitchName).join(' / ');
      return <tr key={index} data-active={index === active}>
        <th scope="row">{row.measure}</th>
        <td>{onPlay ? <button className="challenge-note-replay" type="button" onClick={() => onPlay(index)}
          aria-label={t('sight.replayFromNote', { index: index + 1, pitch })}><Play size={15} aria-hidden="true" />{pitch}</button> : pitch}</td>
        <td data-result>{t(`sight.${row.status}`)}</td><td>{row.sung === null ? '—' : pitchName(Math.round(row.sung))}</td>
        <td>{formatCents(row.cents)}</td><td>{formatCents(row.interval)}</td>
      </tr>;
    })}</tbody></table>
  </div>;
}
