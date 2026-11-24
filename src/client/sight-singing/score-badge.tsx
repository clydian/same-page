import { Music2, Sparkles } from 'lucide-react';
import { useMessages } from '../../i18n';

export function ScoreBadges({ perfect, writtenOctave, size = 16 }: { perfect?: boolean; writtenOctave?: boolean; size?: number }) {
  const t = useMessages('practice');
  if (!perfect) return null;
  return <span className="challenge-score-badges">
    <span className="challenge-perfect" role="img" aria-label={t('sight.allNotesMatched')}>
      <Sparkles size={size} aria-hidden="true" />
    </span>
    {writtenOctave && <span className="challenge-written-octave" role="img" aria-label={t('sight.allNotesInWrittenOctave')}>
      <Music2 size={size} aria-hidden="true" />
    </span>}
  </span>;
}
