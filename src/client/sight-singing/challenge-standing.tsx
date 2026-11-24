import { Trophy } from 'lucide-react';
import { Button, Heading, Modal, ModalOverlay } from 'react-aria-components';
import { useMessages } from '../../i18n';
import type { SightSingingStanding } from '../../shared/sight-singing-results';
import { Dialog } from '../navigation/overlays';
import { useSightSingingScoreFormat } from './format-score';

export function ChallengeStanding({ standing, score, published, part, version, onClose }: {
  standing: SightSingingStanding; score: number; published: boolean; part: string; version: number; onClose: () => void;
}) {
  const t = useMessages('practice');
  const formatScore = useSightSingingScoreFormat();
  const { previous, place, tied, participants } = standing;
  const rank = t(tied ? 'sight.rankTied' : 'sight.rankPlace', { place });
  const scope = [part, version > 1 ? `V${version}` : null, t('sight.participants', { count: participants })].filter(Boolean).join(' · ');
  const improved = published && previous !== undefined && score > previous.score;
  const movedUp = improved && previous.place > place;
  const projected = !published && previous?.score !== score;

  return <ModalOverlay className="modal-overlay" isOpen isDismissable onOpenChange={open => { if (!open) onClose(); }}>
    <Modal className="app-modal challenge-standing-modal">
      <Dialog className="app-dialog challenge-standing">
        <span className="challenge-standing-medal"><Trophy size={24} aria-hidden="true" /></span>
        <Heading slot="title">{t('sight.standingTitle')}</Heading>
        <p className="challenge-standing-scope">{scope}</p>
        {projected && <p className="challenge-standing-scope">{t('sight.standingProjectedRank')}</p>}
        <div className="challenge-standing-rank" data-rise={movedUp || undefined}>
          {movedUp && <span className="challenge-standing-rank-before" aria-hidden="true">{t('sight.rankPlace', { place: previous.place })}</span>}
          <strong className="challenge-standing-rank-now">{rank}</strong>
        </div>
        <p className="challenge-standing-score">{t('sight.intonationScore', { score: formatScore(score) })}</p>
        {projected && <p className="challenge-standing-note">{previous
          ? t('sight.standingBestKept', { place: previous.place, score: formatScore(previous.score) })
          : t('sight.standingUnlisted')}</p>}
        {improved && <p className="challenge-standing-note" data-improved="true">{movedUp
          ? t('sight.standingMovedUp', { count: previous.place - place }) : t('sight.standingPersonalBest')}</p>}
        <Button className="primary-button" onPress={onClose}>{t('sight.standingViewScore')}</Button>
      </Dialog>
    </Modal>
  </ModalOverlay>;
}
