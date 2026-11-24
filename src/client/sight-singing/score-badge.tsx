import { Music2, Sparkles } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button, DialogTrigger, Popover } from 'react-aria-components';
import { useMessages } from '../../i18n';
import { Dialog } from '../navigation/overlays';

function ScoreBadge({ label, className, children }: { label: string; className: string; children: ReactNode }) {
  return <DialogTrigger>
    <Button className={`challenge-score-badge-button ${className}`} aria-label={label}>{children}</Button>
    <Popover placement="top" offset={6} className="challenge-badge-popover">
      <Dialog aria-label={label} className="challenge-badge-explanation">{label}</Dialog>
    </Popover>
  </DialogTrigger>;
}

export function ScoreBadges({ perfect, writtenOctave, size = 16 }: { perfect?: boolean; writtenOctave?: boolean; size?: number }) {
  const t = useMessages('practice');
  if (!perfect) return null;
  return <span className="challenge-score-badges">
    {writtenOctave && <ScoreBadge className="challenge-written-octave" label={t('sight.allNotesInWrittenOctave')}>
      <Music2 size={size} aria-hidden="true" />
    </ScoreBadge>}
    <ScoreBadge className="challenge-perfect" label={t('sight.allNotesMatched')}>
      <Sparkles size={size} aria-hidden="true" />
    </ScoreBadge>
  </span>;
}
