import { Sparkles } from 'lucide-react';
import { useMessages } from '../../i18n';

export function AllNotesMatched({ size = 16 }: { size?: number }) {
  const t = useMessages('practice');
  return <span className="challenge-perfect" role="img" aria-label={t('sight.allNotesMatched')}>
    <Sparkles size={size} aria-hidden="true" />
  </span>;
}
