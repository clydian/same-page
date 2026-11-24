import { Trophy } from 'lucide-react';
import { Fragment, useLayoutEffect, useRef, useState } from 'react';
import { Button, Heading, Modal, ModalOverlay } from 'react-aria-components';
import { useMessages } from '../../i18n';
import type { SightSingingStanding } from '../../shared/sight-singing-results';
import { Dialog } from '../navigation/overlays';
import { useSightSingingScoreFormat } from './format-score';

export function ChallengeStanding({ standing, score, published, onClose }: {
  standing: SightSingingStanding; score: number; published: boolean; onClose: () => void;
}) {
  const t = useMessages('practice');
  const formatScore = useSightSingingScoreFormat();
  const { previous, place, tied, participants } = standing;
  const rank = t(tied ? 'sight.rankTied' : 'sight.rankPlace', { place });
  const scope = [t('sight.standingOverall'), t('sight.participants', { count: participants })].join(' · ');
  const improved = published && previous !== undefined && score > previous.score;
  const movedUp = improved && previous.place > place;
  const projected = (previous !== undefined && score < previous.score) || (!published && previous?.score !== score);

  return <ModalOverlay className="modal-overlay" isOpen isDismissable onOpenChange={open => { if (!open) onClose(); }}>
    <Modal className="app-modal challenge-standing-modal">
      <Dialog className="app-dialog challenge-standing">
        <span className="challenge-standing-medal"><Trophy size={24} aria-hidden="true" /></span>
        <Heading slot="title">{t('sight.standingTitle')}</Heading>
        <p className="challenge-standing-scope">{scope}</p>
        {projected && <p className="challenge-standing-scope">{t('sight.standingProjectedRank')}</p>}
        <strong className="challenge-standing-rank">{rank}</strong>
        <p className="challenge-standing-score">{t('sight.intonationScore', { score: formatScore(score) })}</p>
        {projected && <p className="challenge-standing-note">{previous
          ? t('sight.standingBestKept', { place: previous.place, score: formatScore(previous.score) })
          : t('sight.standingUnlisted')}</p>}
        {improved && <p className="challenge-standing-note" data-improved="true">{movedUp
          ? t('sight.standingMovedUp', { count: previous.place - place }) : t('sight.standingPersonalBest')}</p>}
        {standing.nearby?.length ? <StandingNeighbors standing={standing} score={score} movedUp={movedUp} /> : null}
        <Button className="primary-button" onPress={onClose}>{t('sight.standingViewScore')}</Button>
      </Dialog>
    </Modal>
  </ModalOverlay>;
}

function StandingNeighbors({ standing, score, movedUp }: { standing: SightSingingStanding; score: number; movedUp: boolean }) {
  const t = useMessages('practice');
  const formatScore = useSightSingingScoreFormat();
  const list = useRef<HTMLOListElement>(null), from = useRef<HTMLLIElement>(null), target = useRef<HTMLLIElement>(null);
  const [travelling, setTravelling] = useState(() => movedUp && !matchMedia('(prefers-reduced-motion: reduce)').matches);
  const current = { id: 'current', position: standing.place - .5, place: standing.place, tied: standing.tied, score, name: t('sight.standingYou') };
  const rows = (standing.nearby ?? []).filter(row => travelling || row.position >= standing.place - 2 && row.position <= standing.place + 1)
    .map(row => ({ ...row, name: row.displayName, place: row.place + Number(row.score < score), tied: row.tied || row.score === score }));
  const previous = standing.previous;
  const entries = [...rows, current, ...(travelling && previous ? [{
    ...previous, id: 'previous', position: previous.place - .5, tied: false, name: t('sight.standingPreviousRank'),
  }] : [])].sort((a, b) => a.position - b.position);

  useLayoutEffect(() => {
    const panel = list.current, destination = target.current, start = from.current;
    if (!panel || !destination) return;
    const centered = (row: HTMLElement) => Math.max(0, Math.min(panel.scrollHeight - panel.clientHeight,
      row.offsetTop + (row.offsetHeight - panel.clientHeight) / 2));
    if (!travelling || !start) { panel.scrollTop = centered(destination); return; }
    panel.scrollTop = centered(start);
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      setTravelling(false);
    };
    const motion = window.setTimeout(() => {
      const top = centered(destination);
      if (Math.abs(panel.scrollTop - top) < 1) { finish(); return; }
      const completion: unknown = panel.scrollTo({ top, behavior: 'smooth' });
      if (completion instanceof Promise) void completion.then(finish, finish);
      else panel.addEventListener('scrollend', finish, { once: true });
    }, 180);
    const fallback = window.setTimeout(finish, 1000);
    return () => {
      finished = true;
      window.clearTimeout(motion); window.clearTimeout(fallback);
      panel.removeEventListener('scrollend', finish);
    };
  }, [travelling]);

  return <ol ref={list} className="challenge-standing-nearby" role="list" aria-label={t('sight.standingNearby')}
    data-travelling={travelling || undefined} aria-hidden={travelling || undefined} tabIndex={!travelling && entries.length > 3 ? 0 : undefined}>
    {entries.map((row, index) => <Fragment key={row.id}>
      {travelling && index > 0 && row.position - entries[index - 1].position > 1.5 && <li className="challenge-standing-gap" aria-hidden="true" />}
      <li ref={row.id === 'current' ? target : row.id === 'previous' ? from : undefined} data-standing-row={row.id === 'current' || row.id === 'previous' ? row.id : undefined}>
        <span className="challenge-rank" data-place={row.place}>
          <span aria-hidden="true">{row.place}</span><span className="visually-hidden">{t(row.tied ? 'sight.rankTied' : 'sight.rankPlace', { place: row.place })}</span>
        </span>
        <span className="challenge-standing-name">{row.name}</span>
        <strong>{t('sight.takeScore', { score: formatScore(row.score) })}</strong>
      </li>
    </Fragment>)}
  </ol>;
}
