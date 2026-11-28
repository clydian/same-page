import { Button, DialogTrigger, Popover } from 'react-aria-components';
import type { SightSingingExtraBadge } from '../../shared/sight-singing-results';
import { useMessages } from '../../i18n';
import { Dialog } from '../navigation/overlays';
import near from './badge-art/near.svg';
import matched from './badge-art/matched.svg';
import original from './badge-art/original.svg';
import rainbow from './badge-art/rainbow.svg';
import revelation from './badge-art/revelation.svg';

const badges = {
  1: { art: near, name: 'near' },
  2: { art: matched, name: 'matched' },
  3: { art: original, name: 'original' },
  4: { art: rainbow, name: 'rainbow' },
  5: { art: revelation, name: 'revelation' },
} as const;

export function ScoreBadges({ badge, perfect, writtenOctave, size = 16 }: {
  badge?: SightSingingExtraBadge; perfect?: boolean; writtenOctave?: boolean; size?: number;
}) {
  const t = useMessages('practice');
  const level = badge ?? (perfect ? (writtenOctave ? 3 : 2) : null);
  if (!level) return null;
  const { art, name } = badges[level];
  const label = t(`sight.badges.${name}.title`);
  return <span className="challenge-score-badges">
    <DialogTrigger>
      <Button className="challenge-score-badge-button" aria-label={label}>
        <img src={art} width={size} height={size} alt="" />
      </Button>
      <Popover placement="top" offset={6} className="challenge-badge-popover">
        <Dialog aria-label={label} className="challenge-badge-explanation">
          <strong>{label}</strong>
          <span>{t(`sight.badges.${name}.description`)}</span>
        </Dialog>
      </Popover>
    </DialogTrigger>
  </span>;
}
