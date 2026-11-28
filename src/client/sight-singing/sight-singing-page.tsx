import { FeedbackMessage } from "../components/feedback-message";
import { useFeedbackMessage } from "../components/use-feedback-message";
import { useLiveQuery } from 'dexie-react-hooks';
import { ChevronDown, ChevronRight, Pencil, Settings, Trophy, UsersRound, X } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button, DialogTrigger, Heading, MenuItem, MenuTrigger, Modal, ModalOverlay, Popover } from 'react-aria-components';
import { Link, useParams } from 'react-router-dom';
import { useAppLocale, useMessages } from '../../i18n';
import { attachmentAccept, attachmentFormat, attachmentNameSchema } from '../../shared/attachments';
import { scoreDisplayName } from '../../shared/score-display-name';
import type { ScoreSummary } from '../../shared/scores';
import { publishedQuestionResponseSchema, publishedQuestionsSchema, SIGHT_SINGING_QUESTION_NAME_MAX_LENGTH, SIGHT_SINGING_SCORE_MAX_BYTES,
  type PublishedQuestion, type QuestionBeats, type QuestionPublication } from '../../shared/sight-singing';
import { diagnosticFetch, parseDiagnosticResponse } from '../diagnostics/diagnostics';
import { presentationSessionId, useApplicationIdentity, type ApplicationIdentity } from '../auth/application-identity';
import { readAvailableOfflineSession } from '../auth/offline-session';
import { loginHref } from '../auth/login-return';
import { FloatingAddButton } from '../components/floating-add-button';
import { LoadingStatus } from '../components/loading-status';
import { TaskHeader } from '../components/task-header';
import { useNetworkStatus } from '../platform/use-network-status';
import { useLibraryAttachments } from '../score-library/attachments/use-library-attachments';
import { driveCacheOwnerKey, type DriveCacheOwnerKey } from '../score-library/drive-library-cache';
import { useDriveLibraryResource } from '../score-library/use-drive-library';
import { Dialog, Menu } from '../navigation/overlays';
import { captureNavigationIdentity, type DriveReadIdentity } from '../settings/navigation-events';
import { invalidateReadResources } from '../settings/read-resource';
import { useReadResource } from '../settings/use-read-resource';
import { captureSettingsLifetime, useSettingsLifetime } from '../settings/use-settings-lifetime';
import { ConfirmDialog } from '../settings/confirm-dialog';
import { ChallengePracticeSettings } from './challenge-practice-settings';
import { ChallengeRun, type ChallengeResult, type VoiceOption } from './challenge-run';
import { useSightSingingScoreFormat } from './format-score';
import { buildMelody } from './melody';
import { QuestionRangeEditor } from './question-range-editor';
import { readQuestions, type SightSingingQuestion } from './questions';
import { ScoreBadges } from './score-badge';
import { sightSingingAccess } from './access';
import { publishSightSingingResult, readSightSingingLeaderboard, readSightSingingResults, withdrawSightSingingResult,
  type SightSingingResultFilters } from './result-publication';
import type { PublishedSightSingingResult, SightSingingLeaderboard, SightSingingResultSubmission } from '../../shared/sight-singing-results';
import { isSettingsReadDenied } from '../settings/settings-request';
import { capturePublishedCatalog, readPublishedQuestionCopies, recordPublishedQuestionChange } from './published-question-cache';
import { isSightSingingMemberDenied, publishedPath, readSightSinging } from './read';
import { useChallengeMix } from './use-challenge-mix';
import { useMelodySource, type MelodySource } from './use-melody-source';
import './sight-singing.css';
import './sight-singing-workspace.css';

export default function SightSingingPage() {
  const { choirId = '' } = useParams();
  const identity = useApplicationIdentity();
  const owner = driveCacheOwnerKey(identity.localUserId, choirId);
  return <SightSingingAccess key={JSON.stringify([owner, choirId])} owner={owner} choirId={choirId} identity={identity} />;
}

function SightSingingAccess({ owner, choirId, identity }: {
  owner: DriveCacheOwnerKey; choirId: string; identity: ApplicationIdentity;
}) {
  const online = useNetworkStatus();
  const [previousSession, setPreviousSession] = useState(identity.authenticatedSessionId);
  const userId = identity.localUserId;
  const remembered = useLiveQuery(() => userId ? readAvailableOfflineSession(userId).catch(() => null) : null, [userId]);
  const presentation = presentationSessionId(identity, previousSession);
  if (previousSession !== presentation) setPreviousSession(presentation);
  const sessionId = presentation ?? (identity.onlineState === 'checking' || identity.onlineState === 'unreachable' ? remembered?.sessionId : null);
  const authenticated = Boolean(identity.authenticatedSessionId);
  const { library, snapshot: { access, reading, refreshMessage } } =
    useDriveLibraryResource(owner, choirId, authenticated, Boolean(sessionId), sessionId);
  const { member, signedOut, driveDenied } = sightSingingAccess(access, reading.authority, identity);
  const denied = signedOut || driveDenied;
  useEffect(() => {
    if (!denied || !userId || !sessionId) return;
    const signal = new AbortController().signal;
    void capturePublishedCatalog({ userId, choirId, sessionId }, signal).then(remember => remember([])).catch(() => undefined);
  }, [choirId, denied, sessionId, userId]);
  const [admittedSession, setAdmittedSession] = useState<string | null>(null);
  const rememberedMember = sessionId === remembered?.sessionId && access.kind === 'opened'
    && access.local && access.rememberedMembership && !access.choir.isPreviewEntry;
  const nextAdmission = denied || !sessionId ? null : member || rememberedMember || admittedSession === sessionId ? sessionId : null;
  if (admittedSession !== nextAdmission) setAdmittedSession(nextAdmission);
  const retryConnection = () => {
    if (!navigator.onLine) return;
    void (authenticated ? library.refresh() : identity.session.refetch()).catch(() => undefined);
  };
  if (nextAdmission && userId && access.kind === 'opened') return <QuestionLibrary key={nextAdmission}
    owner={owner} choirId={choirId} userId={userId} sessionId={nextAdmission} driveName={access.choir.name}
    canReadCloud={online && member} retryConnection={retryConnection} sessionExpiresAt={remembered?.expiresAt}
    canPublishOfficial={(access.local ? access.rememberedCapabilities : access.result.permissions.capabilities)?.operations.operations.includes('editDriveInfo') ?? false}
    scores={access.result.scores} />;

  return <ChallengeEntry choirId={choirId} denied={driveDenied} signedOut={signedOut && (online || reading.authority === 'signed-out')}
    loading={online && !denied && (identity.onlineState === 'checking' || authenticated && !refreshMessage && (reading.request === 'pending' || access.kind === 'loading'))}
    retry={retryConnection} />;
}

function ChallengeEntry({ choirId, denied, signedOut = false, loading = false, retry }: {
  choirId: string; denied: boolean; signedOut?: boolean; loading?: boolean; retry: () => void;
}) {
  const t = useMessages('practice');
  const entry = useMessages('entry');
  const online = useNetworkStatus();
  return <div className="app-page">
    <TaskHeader title={t('sightPractice')} backTo={`/choirs/${choirId}/tools`} />
    <main className="page-shell settings-page challenge-page">
      {loading ? <LoadingStatus>{t('sight.loading')}</LoadingStatus>
        : signedOut ? <p><Link to={loginHref(`/choirs/${choirId}/sight-singing`)}>{entry('identity.loginAgain')}</Link></p>
        : denied ? <p role="status">{t('sight.needMember', { practice: t('sightPractice') })}</p>
          : <p role="status">{entry('identity.unreachable')}{online && <>{' '}
            <button type="button" className="text-button" onClick={retry}>{entry('identity.retryConnection')}</button></>}</p>}
    </main>
  </div>;
}

type DriveContext = { owner: DriveCacheOwnerKey; choirId: string; sessionId: string; userId: string; canPublishOfficial: boolean; scores: ScoreSummary[]; canReadCloud: boolean; sessionExpiresAt?: number; retryConnection: () => void };
type ChallengeReads = Pick<DriveContext, 'owner' | 'choirId' | 'canReadCloud'> & { onMemberDenied?: () => void };

function useChallengeRead<T>({ owner, choirId, canReadCloud, onMemberDenied }: ChallengeReads, key: Pick<DriveReadIdentity, 'subjectId' | 'variant'>,
  load: (signal: AbortSignal) => Promise<T>, enabled = true) {
  return useReadResource<T>({ owner, driveId: choirId, kind: 'sight-singing', ...key }, async signal => {
    try { return await load(signal); }
    catch (error) {
      if (!signal.aborted && isSightSingingMemberDenied(error)) onMemberDenied?.();
      throw error;
    }
  }, undefined, 0, canReadCloud && enabled);
}

type SourceMode = 'saved' | 'library' | 'upload';
const versionTag = (version: number) => `V${version}`;

function questionNameWithRange(name: string, range: string) {
  const title = name.replace(/\s+/g, ' ').trim();
  const suffix = ` ${range.replace(/\s+/g, ' ').trim()}`;
  const available = SIGHT_SINGING_QUESTION_NAME_MAX_LENGTH - suffix.length;
  const prefix = title.slice(0, available >= 2 ? available : SIGHT_SINGING_QUESTION_NAME_MAX_LENGTH)
    .replace(/[\uD800-\uDBFF]$/u, '').trimEnd();
  return available >= 2 ? `${prefix}${suffix}` : prefix;
}

function publisherLabel(publisher: PublishedQuestion['publisher'], t: ReturnType<typeof useMessages<'practice'>>) {
  if (publisher.kind !== 'member') return t('sight.officialPublisher');
  if (publisher.own) return t('sight.selfPublisher');
  return publisher.name ? t('sight.namedPublisher', { name: publisher.name }) : t('sight.memberPublisher');
}

function QuestionLibrary({ driveName, ...props }: DriveContext & { driveName: string }) {
  const t = useMessages('practice');
  const entry = useMessages('entry');
  const libraryMessages = useMessages('library');
  const online = useNetworkStatus();
  const scope = { userId: props.userId, choirId: props.choirId, sessionId: props.sessionId };
  const [localRevision, refreshLocal] = useState(0);
  const local = useLiveQuery(() => readPublishedQuestionCopies(scope).catch(() => null), [scope.userId, scope.choirId, scope.sessionId, localRevision]);
  const [expired, setExpired] = useState(false);
  const expiresAt = local?.expiresAt ?? props.sessionExpiresAt;
  useEffect(() => {
    if (!expiresAt) return;
    let timer: ReturnType<typeof setTimeout>;
    const check = () => {
      clearTimeout(timer);
      const remaining = expiresAt - Date.now();
      setExpired(remaining <= 0);
      if (remaining > 0) timer = setTimeout(check, Math.min(remaining, 2_147_483_647));
    };
    check();
    window.addEventListener('focus', check);
    return () => { clearTimeout(timer); window.removeEventListener('focus', check); };
  }, [expiresAt]);
  const copies = expired ? undefined : local?.copies;
  // The stored copy was committed after auditing the installed player assets.
  // A cold open independently rechecks the current shell before using it.
  const available = navigator.serviceWorker?.controller ? copies : undefined;
  const questions = useLiveQuery(() => readQuestions(props.owner, props.choirId).catch(() => null), [props.owner, props.choirId]);
  const published = useChallengeRead(props, { variant: 'questions' }, async signal => {
    const remember = await capturePublishedCatalog(scope, signal).catch(() => null);
    try {
      const data = await readSightSinging(publishedPath(props.choirId), publishedQuestionsSchema, signal, { 'x-same-page-owner-user-id': scope.userId });
      await remember?.(data.questions).catch(() => undefined);
      return data;
    } catch (error) {
      if (isSettingsReadDenied(error)) await remember?.([]).catch(() => undefined);
      throw error;
    }
  });
  const denied = published.authority === 'signed-out' || published.authority === 'revoked';
  const memberDenied = () => {
    published.clear();
    const signal = new AbortController().signal;
    void capturePublishedCatalog(scope, signal).then(remember => remember([])).catch(() => undefined);
  };
  const reads = { ...props, onMemberDenied: memberDenied };
  const board = useChallengeRead(reads, { variant: 'leaderboard' }, signal => readSightSingingLeaderboard(props.choirId, signal), !denied);
  const [selection, setSelection] = useState<{ question?: PublishedQuestion; legacy?: SightSingingQuestion; fromCache?: boolean } | null>(null);
  const [pitchTraceEnabled, setPitchTraceEnabled] = useState(false);
  const mix = useChallengeMix(props.userId);
  const [resultGeneration, setResultGeneration] = useState(0);
  const resultsChanged = (questionId: string) => {
    // Fence pre-write reads for the aggregate and every filter on this question.
    // The registry keeps the last displayed data and existing read authority.
    invalidateReadResources(key => key.owner === props.owner && key.driveId === props.choirId && key.kind === 'sight-singing'
      && (key.variant === 'leaderboard' || key.subjectId === questionId));
    setResultGeneration(value => value + 1);
  };
  // Keep the write alive across a return to the question library, but not
  // across a change of identity or loss of drive access.
  const resultLifetimes = useRef(new Set<AbortController>());
  const resultFeedback = useFeedbackMessage();
  const canPublishResult = props.canReadCloud && !denied;
  useEffect(() => {
    const pending = resultLifetimes.current;
    return () => { for (const controller of pending) controller.abort(); };
  }, [canPublishResult, props.choirId, props.userId]);
  const recordResult = (questionId: string, attempt: SightSingingResultSubmission) => {
    if (!canPublishResult || !navigator.onLine) { resultFeedback.setMessage(t("sight.resultSave.failed"), { duration: 8000 }); return; }
    resultFeedback.dismiss();
    const controller = new AbortController(), current = captureNavigationIdentity();
    resultLifetimes.current.add(controller);
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]);
    void publishSightSingingResult(props.choirId, questionId, props.userId, attempt, signal)
      .then(() => { if (!signal.aborted && current()) resultsChanged(questionId); })
      .catch(error => {
        if (controller.signal.aborted || !current()) return;
        if (isSightSingingMemberDenied(error)) memberDenied();
        else resultFeedback.setMessage(t("sight.resultSave.failed"), { duration: 8000 });
      })
      .finally(() => resultLifetimes.current.delete(controller));
  };
  const resultNotice = <FeedbackMessage feedback={resultFeedback} />;
  const refresh = () => {
    if (!props.canReadCloud) { props.retryConnection(); return; }
    void published.refresh().catch(() => undefined);
    void board.refresh().catch(() => undefined);
  };
  const { refresh: refreshQuestions } = published;
  const { refresh: refreshBoard } = board;
  useEffect(() => {
    if (resultGeneration && props.canReadCloud && !denied) void refreshBoard().catch(() => undefined);
  }, [resultGeneration, props.canReadCloud, denied, refreshBoard]);
  useEffect(() => {
    if (!props.canReadCloud) return;
    const verify = () => {
      if (document.visibilityState !== 'visible') return;
      void refreshQuestions().catch(() => undefined);
      if (!denied) void refreshBoard().catch(() => undefined);
    };
    window.addEventListener('focus', verify);
    document.addEventListener('visibilitychange', verify);
    return () => {
      window.removeEventListener('focus', verify);
      document.removeEventListener('visibilitychange', verify);
    };
  }, [props.canReadCloud, denied, refreshQuestions, refreshBoard]);
  if (denied) {
    if (selection) setSelection(null);
    return <ChallengeEntry choirId={props.choirId} denied signedOut={published.authority === 'signed-out'} retry={refresh} />;
  }
  if (expired && !props.canReadCloud) return <ChallengeEntry choirId={props.choirId} denied={false} retry={refresh} />;
  const catalog = published.data?.questions;
  const selectedQuestion = selection?.question && catalog?.find(question => question.id === selection.question?.id);
  const removed = selection?.question && ((catalog && selectedQuestion?.version !== selection.question.version)
    || (selection.fromCache && local !== undefined && !copies?.some(copy => copy.question.id === selection.question?.id
      && copy.question.version === selection.question.version) && (!props.canReadCloud || !selectedQuestion)));
  if (removed) setSelection(null);
  const activeQuestion = selectedQuestion ?? selection?.question;
  if (selection && !removed) return <QuestionWorkspace {...reads} legacy={selection.legacy}
    question={activeQuestion} pitchTraceEnabled={pitchTraceEnabled} setPitchTraceEnabled={setPitchTraceEnabled}
    audioMix={mix} canEditQuestion={selectedQuestion?.canEdit}
    offlineReady={available?.some(({ question }) => question.id === activeQuestion?.id && question.version === activeQuestion.version)}
    resultGeneration={resultGeneration} onResultsChanged={resultsChanged} onResult={recordResult} resultNotice={resultNotice}
    onCopySaved={() => refreshLocal(revision => revision + 1)}
    revalidateAccess={refresh} onQuestionChange={async (id, question, signal) => {
      await recordPublishedQuestionChange(scope, id, question, signal).catch(() => undefined);
      if (signal.aborted) return;
      if (catalog) published.update({ questions: [...catalog.filter(item => item.id !== id), ...(question ? [question] : [])] });
      if (!question && selection.question?.id === id) setSelection(null);
      if (question && (selection.question?.id !== question.id || selection.question.version !== question.version)) setSelection({ question });
      invalidateReadResources(key => key.owner === props.owner && key.driveId === props.choirId && key.variant === 'questions');
      refresh();
    }} onBack={() => { setSelection(null); refresh(); }} />;
  const cachedQuestions = available?.map(copy => copy.question).sort((a, b) => a.title.localeCompare(b.title));
  const shown = online && catalog ? catalog : cachedQuestions?.length ? cachedQuestions : undefined;
  const legacyQuestions = questions?.filter(question => !catalog?.some(item => item.id === question.id));
  const listPending = props.canReadCloud && !catalog && !published.error && !shown?.length;
  const boardPending = props.canReadCloud && !board.data && !board.error;
  const readMessage = !online || !props.canReadCloud ? entry('identity.unreachable')
    : !shown && !listPending ? t('sight.publishedError')
      : catalog && !board.data && !boardPending ? t('sight.publishedResultsError')
        : shown && (published.error || board.error) ? entry('identity.unreachable') : null;
  return <div className="app-page challenge-library">
    <TaskHeader title={t('sightPractice')} subtitle={driveName} backTo={`/choirs/${props.choirId}/tools`} />
    <main className="page-shell settings-page challenge-page">
      {resultNotice}
      <section className="challenge-library-section" aria-label={t('sight.publishedQuestions')}>
        {readMessage && <p role="status">{readMessage}{online && <>{' '}
          <button type="button" className="text-button" onClick={refresh}>{t('sight.retryLoad')}</button></>}</p>}
        {listPending && <LoadingStatus>{t('sight.loading')}</LoadingStatus>}
        {shown && (shown.length > 0 || online && catalog) && <QuestionList questions={shown}
          available={new Set(available?.map(copy => `${copy.question.id}:${copy.question.version}`))}
          offlineLabel={libraryMessages('localStorageAvailableOffline')}
          leaderboard={props.canReadCloud ? board.data ?? (boardPending ? undefined : null) : null}
          reads={reads} open={question => setSelection({ question, fromCache: !catalog || !online })} />}
      </section>
      {questions === null ? <p role="alert">{t('sight.storageError')}</p> : props.canReadCloud && Boolean(legacyQuestions?.length) &&
        <details className="challenge-legacy-questions">
          <summary>{t('sight.legacyQuestions')}</summary>
          <p>{t('sight.legacyPublishHint')}</p>
          <ul className="challenge-list">{legacyQuestions?.map(legacy => <li key={legacy.id}>
            <button type="button" className="challenge-question" onClick={() => setSelection({ legacy })}>
              <Pencil size={17} aria-hidden="true" /><span>{legacy.title}</span><ChevronRight size={18} aria-hidden="true" />
            </button>
          </li>)}</ul>
        </details>}
    </main>
    {props.canReadCloud && <FloatingAddButton label={t('sight.create')} onPress={() => setSelection({})} />}
  </div>;
}

function VoiceFilter({ voice, voices, onChange }: { voice: string; voices: string[]; onChange: (voice: string) => void }) {
  const t = useMessages('practice');
  return <label className="challenge-version-filter">
    <span className="visually-hidden">{t('sight.voiceFilter')}</span>
    <select value={voice} onChange={event => onChange(event.target.value)}>
      <option value="">{t('sight.allVoices')}</option>
      {Array.from(new Set(voice ? [...voices, voice] : voices)).map(name => <option key={name}>{name}</option>)}
    </select>
  </label>;
}

function rankScores<T extends { score: number }>(rows: T[]) {
  let place = 0;
  return rows.map((row, index) => {
    const previousTied = rows[index - 1]?.score === row.score;
    if (!previousTied) place = index + 1;
    return { row, place, tied: previousTied || rows[index + 1]?.score === row.score };
  });
}

function RankBadge({ place, tied }: { place: number; tied: boolean }) {
  const t = useMessages('practice');
  return <span className="challenge-rank" data-place={place}>
    <span aria-hidden="true">{place}</span>
    <span className="visually-hidden">{t(tied ? 'sight.rankTied' : 'sight.rankPlace', { place })}</span>
  </span>;
}

function QuestionList({ questions, leaderboard, reads, open, available, offlineLabel }: {
  questions: PublishedQuestion[]; leaderboard?: SightSingingLeaderboard | null; reads: ChallengeReads;
  open: (question: PublishedQuestion) => void; available: Set<string>; offlineLabel: string;
}) {
  const t = useMessages('practice');
  const byQuestion = new Map<string, SightSingingLeaderboard['results']>();
  for (const score of leaderboard?.results ?? []) {
    const top = byQuestion.get(score.questionId) ?? [];
    top.push(score);
    byQuestion.set(score.questionId, top);
  }
  const counts = leaderboard?.participants && new Map(leaderboard.participants.map(item => [item.questionId, item.count]));
  return questions.length ? <ul className="challenge-card-grid" role="list" aria-busy={leaderboard === undefined}>
    {questions.map(question => <QuestionCard key={question.id} question={question} top={byQuestion.get(question.id)}
      reads={reads} count={counts ? counts.get(question.id) ?? 0 : undefined}
      ready={Boolean(leaderboard)} offlineLabel={available.has(`${question.id}:${question.version}`) ? offlineLabel : undefined} open={() => open(question)} />)}
  </ul> : <p className="challenge-empty">{t('sight.noPublished')}</p>;
}

function QuestionCard({ question, top, count, reads, ready, open, offlineLabel }: {
  question: PublishedQuestion; top?: SightSingingLeaderboard['results']; count?: number; ready: boolean; open: () => void; offlineLabel?: string;
  reads: ChallengeReads;
}) {
  const t = useMessages('practice');
  const rankingId = useId();
  const [expanded, setExpanded] = useState(false);
  const showDetailsButton = expanded || Boolean(top?.length);
  const showVersions = question.version > 1;
  return <li className="challenge-card">
    <button type="button" className="challenge-card-open" onClick={open}>
      <span><strong>{question.title}</strong><small>{publisherLabel(question.publisher, t)}{showVersions && ` · ${versionTag(question.version)}`}{offlineLabel && ` · ${offlineLabel}`}</small></span>
      <ChevronRight size={17} aria-hidden="true" />
    </button>
    <div className="challenge-card-podium">
      {(count !== undefined || showDetailsButton) && <div className="challenge-card-summary">
        {count !== undefined && <span className="challenge-card-participants"><UsersRound size={14} aria-hidden="true" />
          {t('sight.participants', { count })}</span>}
        {showDetailsButton && <button type="button" className="challenge-card-detail-button" aria-label={t('sight.rankDetails')}
          aria-controls={rankingId} aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
          <ChevronDown size={17} aria-hidden="true" />
        </button>}
      </div>}
      <div id={rankingId}>
        {expanded ? <ExpandedQuestionRanks reads={reads} question={question} />
          : <QuestionRanks rows={top} ready={ready} />}
      </div>
    </div>
  </li>;
}

function ExpandedQuestionRanks({ reads, question }: { reads: ChallengeReads; question: PublishedQuestion }) {
  const t = useMessages('practice');
  const details = useChallengeRead(reads, { subjectId: question.id, variant: 'card' }, signal =>
    readSightSingingResults(reads.choirId, question.id, {}, signal));
  if (details.data) return <QuestionRanks rows={details.data.results} ready expanded showVersions={question.version > 1} />;
  if (reads.canReadCloud && !details.error) return <LoadingStatus>{t('sight.loading')}</LoadingStatus>;
  return <p className="challenge-card-empty" role="status">{t('sight.publishedResultsError')}{' '}
    <button className="text-button" type="button" onClick={() => void details.refresh().catch(() => undefined)}>{t('sight.retryLoad')}</button>
  </p>;
}

function QuestionRanks({ rows, ready, expanded, showVersions }: {
  rows?: SightSingingLeaderboard['results']; ready: boolean; expanded?: boolean; showVersions?: boolean;
}) {
  const t = useMessages('practice');
  const formatScore = useSightSingingScoreFormat();
  return rows?.length ? <ol className="challenge-card-ranks" role="list" aria-label={t(expanded ? 'sight.bestResults' : 'sight.topThree')}>
    {rankScores(rows).map(({ row, place, tied }) => <li key={row.id}>
      <RankBadge place={place} tied={tied} />
      <div className="challenge-card-result">
        <div className="challenge-card-result-main"><span>{row.displayName}</span>
          <strong className="challenge-marked-score">
            <ScoreBadges badge={row.badge} perfect={row.perfect} writtenOctave={row.writtenOctave} />
            {t('sight.takeScore', { score: formatScore(row.score) })}
          </strong>
        </div>
        {expanded && <small>{row.voiceName}{showVersions && ` · ${versionTag(row.version)}`}
          {` · ${row.speed.toFixed(2)}×`}</small>}
      </div>
    </li>)}
  </ol> : <p className="challenge-card-empty">{ready ? t('sight.noCardScores') : '—'}</p>;
}

function PracticePanel({ title, icon, compact, children }: {
  title: string; icon: ReactNode; compact?: boolean; children: ReactNode;
}) {
  const t = useMessages('practice');
  return <DialogTrigger>
    <Button className="icon-button" aria-label={title}>{icon}</Button>
    <ModalOverlay className="modal-overlay" isDismissable>
      <Modal className={`app-modal${compact ? ' app-modal--compact' : ''}`}>
        <Dialog className="app-dialog challenge-panel">{({ close }) => <>
          <div className="dialog-heading">
            <Heading slot="title">{title}</Heading>
            <Button className="icon-button" aria-label={t('close')} onPress={close}><X size={20} aria-hidden="true" /></Button>
          </div>
          {children}
        </>}</Dialog>
      </Modal>
    </ModalOverlay>
  </DialogTrigger>;
}

function PublishedResultRow({ row, place, tied, showVersions, onRemove }: {
  row: PublishedSightSingingResult; place: number; tied: boolean; showVersions: boolean; onRemove: () => void;
}) {
  const t = useMessages('practice');
  const formatScore = useSightSingingScoreFormat();
  const [open, setOpen] = useState(false);
  const person = <>
    <RankBadge place={place} tied={tied} />
    <span><strong>{row.displayName}</strong><small>{row.voiceName}{showVersions && ` · ${versionTag(row.version)}`}
      {` · ${row.speed.toFixed(2)}×`}</small></span>
  </>;
  return <li data-own={row.own || undefined} onContextMenu={row.own ? event => {
    if (!(event.target instanceof Element) || !event.currentTarget.contains(event.target) || event.target.closest('.challenge-score-badge-button')) return;
    event.preventDefault();
    if (event.button === 2) setOpen(true);
  } : undefined}>
    {row.own ? <MenuTrigger trigger="longPress" isOpen={open} onOpenChange={setOpen}>
      <Button className="challenge-ranked-person challenge-score-menu-trigger" onPress={event => {
        if (event.pointerType === 'keyboard' || event.pointerType === 'virtual') setOpen(true);
      }}>{person}</Button>
      <Popover className="file-menu-popover challenge-score-menu" placement="bottom start">
        <Menu aria-label={t('sight.withdrawAction')} autoFocus="first" onAction={onRemove}>
          <MenuItem id="withdraw" className="challenge-withdraw-item">{t('sight.withdrawAction')}</MenuItem>
        </Menu>
      </Popover>
    </MenuTrigger> : <div className="challenge-ranked-person">{person}</div>}
    <strong className="challenge-marked-score">
      <ScoreBadges badge={row.badge} perfect={row.perfect} writtenOctave={row.writtenOctave} />
      {t('sight.takeScore', { score: formatScore(row.score) })}
    </strong>
  </li>;
}

function PublishedResults({ reads, questionId, version, generation, userId, onResultsChanged }: {
  reads: ChallengeReads; questionId: string; version: number; generation: number; userId: string;
  onResultsChanged: (questionId: string) => void;
}) {
  const { choirId, canReadCloud } = reads;
  const t = useMessages('practice');
  const showVersions = version > 1;
  const speedFilterId = useId();
  const [filters, setFilters] = useState<SightSingingResultFilters>({});
  const [voices, setVoices] = useState<string[]>([]);
  const [removing, setRemoving] = useState<PublishedSightSingingResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [withdrawFailed, setWithdrawFailed] = useState(false);
  const lifetime = useSettingsLifetime();
  const results = useChallengeRead(reads, { subjectId: questionId, variant: JSON.stringify(filters) }, signal =>
    readSightSingingResults(choirId, questionId, filters, signal));
  const rows = results.data?.results;
  const { refresh } = results;
  const refreshResults = () => { void refresh().catch(() => undefined); };
  useEffect(() => {
    if (canReadCloud) void refresh().catch(() => undefined);
  }, [canReadCloud, refresh, generation]);
  if (results.data?.voices && results.data.voices !== voices) setVoices(results.data.voices);
  const removeLabel = (edition: number) => showVersions ? t('sight.withdrawResult', { version: versionTag(edition) }) : t('sight.withdrawAction');
  const withdraw = async () => {
    if (!removing || busy || !results.canMutate) return;
    const current = captureNavigationIdentity();
    const mounted = captureSettingsLifetime(lifetime);
    setBusy(true); setWithdrawFailed(false);
    try {
      await withdrawSightSingingResult(choirId, questionId, userId, removing.id, removing.version);
      if (mounted() && current()) onResultsChanged(questionId);
    } catch (error) {
      if (mounted() && current()) {
        if (isSightSingingMemberDenied(error)) reads.onMemberDenied?.();
        setWithdrawFailed(true);
      }
    } finally {
      if (mounted()) setBusy(false);
    }
  };
  return <div className="challenge-published-results">
      <div className="challenge-result-filters">
        {showVersions && <label className="challenge-version-filter">
          <span className="visually-hidden">{t('sight.resultVersionFilter')}</span>
          <select value={filters.version ?? ''} onChange={event => {
            const latest = event.target.value !== '';
            setFilters(current => ({ ...current, version: latest ? version : undefined }));
          }}>
            <option value="">{t('sight.allVersions')}</option>
            <option value={version}>{t('sight.latestVersion')}</option>
          </select>
        </label>}
        <VoiceFilter voice={filters.voice ?? ''} voices={voices} onChange={voice => setFilters(current => ({ ...current, voice }))} />
        <label className="challenge-version-filter" htmlFor={speedFilterId}>
          <span className="visually-hidden">{t('sight.resultSpeedFilter')}</span>
          <select id={speedFilterId} value={filters.speed ?? ''} onChange={event => {
            const standard = event.target.value === '1';
            setFilters(current => ({ ...current, speed: standard ? 1 : undefined }));
          }}>
            <option value="">{t('sight.allSpeeds')}</option>
            <option value="1">1.00×</option>
          </select>
        </label>
      </div>
      {withdrawFailed && <p role="alert">{t('sight.withdrawFailed')}</p>}
      {!rows && canReadCloud && !results.error ? <LoadingStatus>{t('sight.loading')}</LoadingStatus>
        : !rows ? <p role="status">{t('sight.publishedResultsError')} <button type="button" className="text-button" onClick={refreshResults}>{t('sight.retryLoad')}</button></p>
        : rows.length === 0 ? <p className="challenge-empty">{t('sight.publishedResultsEmpty')}</p>
          : <ul className="challenge-list challenge-score-list">{rankScores(rows).map(({ row, place, tied }) =>
            <PublishedResultRow key={row.id} row={row} place={place} tied={tied} showVersions={showVersions} onRemove={() => { if (results.canMutate) setRemoving(row); }} />
          )}</ul>}
      <ConfirmDialog busy={busy} onClose={() => setRemoving(null)} confirmation={removing && {
        title: removeLabel(removing.version), message: t('sight.withdrawDescription'),
        action: t('sight.withdrawAction'), destructive: true, onConfirm: withdraw,
      }} />
  </div>;
}

function QuestionWorkspace({ owner, choirId, sessionId, userId, canPublishOfficial, scores, canReadCloud, retryConnection, onMemberDenied, question, legacy, onBack, canEditQuestion, revalidateAccess, onQuestionChange, offlineReady, onCopySaved,
  resultGeneration, onResultsChanged, onResult, resultNotice, pitchTraceEnabled, setPitchTraceEnabled, audioMix }: DriveContext & {
  question?: PublishedQuestion; legacy?: SightSingingQuestion; onBack: () => void; onMemberDenied: () => void;
  canEditQuestion?: boolean; offlineReady?: boolean; onCopySaved: () => void; revalidateAccess: () => void; onQuestionChange: (id: string, question: PublishedQuestion | null, signal: AbortSignal) => Promise<void>;
  resultGeneration: number; onResultsChanged: (questionId: string) => void;
  onResult: (questionId: string, attempt: SightSingingResultSubmission) => void; resultNotice: ReactNode;
  pitchTraceEnabled: boolean; setPitchTraceEnabled: (enabled: boolean) => void;
  audioMix: ReturnType<typeof useChallengeMix>;
}) {
  const t = useMessages('practice');
  const { locale } = useAppLocale();
  const entry = useMessages('entry');
  const libraryMessages = useMessages('library');
  const id = useId();
  const heading = useRef<HTMLSpanElement>(null);
  const [saved, setSaved] = useState(question);
  const draft = question ?? legacy;
  const [publication, setPublication] = useState<QuestionPublication>('member');
  const [sourceMode, setSourceMode] = useState<SourceMode>(draft?.snapshot ? 'saved' : 'library');
  const [upload, setUpload] = useState<{ key: string; file: File } | null>(null);
  const [invalidUpload, setInvalidUpload] = useState(false);
  const [questionId] = useState(() => question?.id ?? crypto.randomUUID());
  const [editing, setEditing] = useState(!question);
  useEffect(() => { heading.current?.focus(); }, [editing]);
  const [titleOverride, setTitleOverride] = useState(draft?.title);
  const [scoreId, setScoreId] = useState(draft?.scoreId ?? '');
  const [fileChoice, setFileChoice] = useState(draft?.attachmentId ? `${draft.attachmentId}:${draft.revision}` : '');
  const [voiceChoice, setVoiceChoice] = useState(legacy?.voice ?? '');
  const [first, setFirst] = useState(draft?.first ?? 0);
  const [lastChoice, setLastChoice] = useState<number | undefined>(draft?.last);
  const [beats, setBeats] = useState<QuestionBeats>({ firstBeat: question?.firstBeat, lastBeat: question?.lastBeat });
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteFailed, setDeleteFailed] = useState(false);
  const [audioBusy, setAudioBusy] = useState(false);
  const [measuring, setMeasuring] = useState(false);
  const [failed, setFailed] = useState(false);
  const saveLifetime = useRef<AbortController | null>(null);
  const deleteLifetime = useRef<AbortController | null>(null);
  const currentResult = useRef<ChallengeResult>(null);
  // An edit can finish after the render that started it has lost cloud access.
  const cloudAvailable = useRef(false);
  useLayoutEffect(() => {
    cloudAvailable.current = canReadCloud;
    return () => { cloudAvailable.current = false; };
  }, [canReadCloud]);
  useEffect(() => () => { saveLifetime.current?.abort(); deleteLifetime.current?.abort(); }, []);
  useEffect(() => {
    if (canReadCloud) return;
    if (saveLifetime.current) {
      saveLifetime.current.abort();
      setSaving(false);
      setFailed(true);
    }
    if (deleteLifetime.current) {
      deleteLifetime.current.abort();
      setDeleting(false);
      setConfirmingDelete(false);
      setDeleteFailed(true);
    }
  }, [canReadCloud]);

  const visibleSource = editing ? sourceMode : 'saved';
  const candidates = useMemo(() => scores.filter(score => (score.musicXmlCount ?? score.attachmentCount ?? 0) > 0), [scores]);
  const score = visibleSource === 'library' ? candidates.find(row => row.id === scoreId) : undefined;
  const attachments = useLibraryAttachments(choirId, score ? [score] : [], Boolean(score) && canReadCloud, sessionId, owner);
  const files = attachments.items.filter(file => file.kind === 'musicxml' && !file.trashExpiresAt)
    .sort((left, right) => Number(right.source === 'generated') - Number(left.source === 'generated'));
  const fileKey = (file: (typeof files)[number]) => `${file.id}:${file.revision}`;
  const attachment = files.find(file => fileKey(file) === fileChoice) ?? (!fileChoice && files.length === 1 ? files[0] : undefined);
  const version = saved?.version ?? 1;
  const savedSource = saved ?? legacy;
  let source: MelodySource | null = null;
  if (visibleSource === 'saved' && savedSource?.snapshot) {
    const snapshot = { choirId, questionId: savedSource.id, version: savedSource.version ?? 1, name: savedSource.snapshot.name };
    source = saved ? { kind: 'cloud', scope: { userId, choirId, sessionId }, question: saved } : { kind: 'local', owner, ...snapshot };
  } else if (visibleSource === 'upload' && upload) source = { kind: 'upload', choirId, locale, ...upload };
  else if (visibleSource === 'library' && score && attachment) source = { kind: 'library', playback: { attachment, score, choirId, ownerKey: owner, sessionId } };
  const loaded = useMelodySource(source, canReadCloud, {
    onMemberDenied, onCopySaved,
    onQuestionMissing: (id, signal) => { void onQuestionChange(id, null, signal); },
  });
  const { bytes: loadedBytes, name: loadedName } = loaded;
  const last = lastChoice ?? (loaded.document?.visits.length ?? 1) - 1;
  const options = useMemo(() => {
    const document = loaded.document;
    return document?.singingVoices.map(voice => ({ voice, melody: buildMelody(document, voice, first, last, beats) })) ?? [];
  }, [loaded.document, first, last, beats]);
  const voices: VoiceOption[] = options.flatMap(({ voice, melody }) => {
    if (typeof melody === 'string') return [];
    const name = voice.name || t('sight.part', { number: voice.track + 1 });
    return [{ voice, melody, label: voice.multiple ? t('sight.voiceDetail', { name, staff: voice.staff + 1, voice: voice.voice + 1 }) : name }];
  });
  const selected = voices.find(option => option.voice.id === voiceChoice) ?? voices[0];
  const visitLabel = (index: number) => {
    const visit = loaded.document?.visits[index];
    return visit?.visit ? t('sight.measureVisit', { measure: visit.number, visit: visit.visit }) : t('sight.measureNumber', { measure: visit?.number ?? index + 1 });
  };
  const resetRange = () => { setVoiceChoice(''); setFirst(0); setLastChoice(undefined); setBeats({}); setFailed(false); };
  const changeSourceMode = (mode: SourceMode) => {
    setSourceMode(mode); resetRange(); setInvalidUpload(false); setUpload(null);
    if (mode === 'saved' && savedSource) {
      setFirst(savedSource.first); setLastChoice(savedSource.last);
      setBeats({ firstBeat: saved?.firstBeat, lastBeat: saved?.lastBeat });
    }
  };
  const changeUpload = (file: File | null) => {
    setUpload(null); setInvalidUpload(false); resetRange();
    if (!file) return;
    if (!attachmentNameSchema.safeParse(file.name).success || attachmentFormat(file.name)?.kind !== 'musicxml'
        || file.size === 0 || file.size > SIGHT_SINGING_SCORE_MAX_BYTES) { setInvalidUpload(true); return; }
    setUpload({ key: crypto.randomUUID(), file });
  };
  const range = first === last ? visitLabel(first) : t('measureRange', { start: visitLabel(first), end: visitLabel(last) });
  const visits = loaded.document?.visits;
  const firstVisit = visits?.[first], lastVisit = visits?.[last];
  const uploadedName = source?.kind === 'upload' && loadedName
    ? loaded.document?.score.title.trim() || loaded.document?.score.subTitle.trim()
      || loadedName.replace(/\.(?:musicxml|mxl|xml)$/i, '').trim() || loadedName : '';
  const scoreName = score ? scoreDisplayName(score.fileName) : uploadedName;
  const nameRange = visits && firstVisit && lastVisit
    ? first === 0 && last === visits.length - 1 && beats.firstBeat == null && beats.lastBeat == null ? t('sight.wholePiece')
      : first === last || firstVisit.visit || lastVisit.visit ? range
      : t('sight.questionMeasureRange', { first: firstVisit.number, last: lastVisit.number })
    : '';
  const title = titleOverride ?? (scoreName && nameRange ? questionNameWithRange(scoreName, nameRange) : '');
  const editable = canEditQuestion ?? saved?.canEdit ?? canPublishOfficial;
  const save = async () => {
    if (!canReadCloud || !title.trim() || !source || !loadedBytes || !loadedName || !selected || saveLifetime.current || deleteLifetime.current || (saved && !editable)) return;
    const controller = new AbortController();
    saveLifetime.current = controller;
    const current = captureNavigationIdentity();
    setSaving(true); setFailed(false);
    try {
      const headers: Record<string, string> = { 'x-same-page-owner-user-id': userId };
      const payload = { title: title.trim(), first, last, expectedVersion: saved?.version ?? null,
        ...(beats.firstBeat != null || saved?.firstBeat != null ? { firstBeat: beats.firstBeat ?? null } : {}),
        ...(beats.lastBeat != null || saved?.lastBeat != null ? { lastBeat: beats.lastBeat ?? null } : {}),
        ...(saved?.snapshot && { expectedEditToken: saved.snapshot.editToken }),
        ...(!saved && { publication: canPublishOfficial ? publication : 'member' }) };
      let body: BodyInit;
      if (source.kind === 'library' || source.kind === 'cloud') {
        const fields = source.kind === 'cloud' ? { reuseSnapshot: true } : {
          scoreId: source.playback.score.id, attachmentId: source.playback.attachment.id, revision: source.playback.attachment.revision,
        };
        headers['content-type'] = 'application/json';
        body = JSON.stringify({ ...payload, ...fields });
      } else {
        const form = new FormData();
        form.set('fields', JSON.stringify(payload));
        form.set('file', new Blob([loadedBytes]), loadedName);
        body = form;
      }
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]);
      const response = await diagnosticFetch(`${publishedPath(choirId)}/${questionId}`, { method: 'PUT', signal, headers, body });
      signal.throwIfAborted();
      if (current()) {
        if (response.status === 401) onMemberDenied();
        if (response.status === 403) revalidateAccess(); // An edit denial can be narrower than membership.
      }
      if (!response.ok) throw new Error('publish_question_failed');
      const { question: next } = await parseDiagnosticResponse(response, publishedQuestionResponseSchema);
      if (!controller.signal.aborted && current()) await onQuestionChange(next.id, next, controller.signal);
      if (!controller.signal.aborted && current()) {
        setTitleOverride(next.title); setFirst(next.first); setLastChoice(next.last);
        setBeats({ firstBeat: next.firstBeat, lastBeat: next.lastBeat });
        setScoreId(next.scoreId ?? ''); setFileChoice(next.attachmentId ? `${next.attachmentId}:${next.revision}` : '');
        setSaved(next); setSourceMode('saved'); setUpload(null); setEditing(false);
      }
    } catch { if (!controller.signal.aborted) setFailed(true); }
    finally { saveLifetime.current = null; if (!controller.signal.aborted) setSaving(false); }
  };
  const remove = async () => {
    const editToken = saved?.snapshot.editToken;
    if (!saved || !editToken || !editable || !canReadCloud || saveLifetime.current || deleteLifetime.current) return;
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]);
    const current = captureNavigationIdentity();
    deleteLifetime.current = controller;
    setDeleting(true); setDeleteFailed(false);
    try {
      const response = await diagnosticFetch(`${publishedPath(choirId)}/${encodeURIComponent(saved.id)}`, {
        method: 'DELETE', signal, headers: { 'content-type': 'application/json', 'x-same-page-owner-user-id': userId },
        body: JSON.stringify({ editToken }),
      });
      signal.throwIfAborted();
      if (!current()) return;
      if (response.status === 401) { onMemberDenied(); return; }
      if (response.status === 403 || response.status === 409) revalidateAccess();
      if (!response.ok) throw new Error('delete_question_failed');
      await onQuestionChange(saved.id, null, controller.signal);
      if (!controller.signal.aborted && current()) {
        onResultsChanged(saved.id);
        onBack();
      }
    } catch {
      if (!controller.signal.aborted && current()) setDeleteFailed(true);
    } finally {
      deleteLifetime.current = null;
      if (!controller.signal.aborted && current()) { setDeleting(false); setConfirmingDelete(false); }
    }
  };
  const status = score && attachments.statusFor(score.id);
  const needsSource = visibleSource === 'library' && ((!score && Boolean(scoreId)) || (score && status === 'ready' && !attachment && Boolean(fileChoice)));
  const playable = Boolean(loaded.document && selected);
  const issue = !selected && loaded.document ? options[0]?.melody ?? 'noMelody' : null;
  const canEdit = !editing && editable;
  const replace = Boolean(saved && (sourceMode !== 'saved' || first !== saved.first || last !== saved.last ||
    (beats.firstBeat ?? null) !== (saved.firstBeat ?? null) || (beats.lastBeat ?? null) !== (saved.lastBeat ?? null)));
  const badUpload = invalidUpload || (source?.kind === 'upload' && loaded.failed);
  const versionSuffix = version > 1 ? ` · ${versionTag(version)}` : '';
  return <div className="app-page challenge-workspace" data-practice={!editing && playable || undefined}>
    <TaskHeader title={<span ref={heading} tabIndex={-1} id={`${id}-heading`}>{editing ? t(saved ? 'sight.edit' : 'sight.create') : saved?.title}</span>}
      subtitle={editing || !saved ? undefined : `${loaded.document ? `${range} · ` : ''}${publisherLabel(saved.publisher, t)}${versionSuffix}${offlineReady ? ` · ${libraryMessages('localStorageAvailableOffline')}` : ''}`}
      backTo={`/choirs/${choirId}`} onBack={() => { currentResult.current?.finish(); onBack(); }} backLabel={t('sight.backToQuestions')}
      actions={!editing && <div className="challenge-header-actions">
        {canEdit && <button type="button" className="icon-button" aria-label={t('sight.edit')} title={t('sight.edit')}
          onClick={() => { currentResult.current?.finish(); setSourceMode('saved'); setEditing(true); }}><Pencil size={18} aria-hidden="true" /></button>}
        {saved && canReadCloud && <PracticePanel title={t('sight.bestResults')} icon={<Trophy size={19} aria-hidden="true" />}>
          <PublishedResults key={`${saved.id}:${version}`} reads={{ owner, choirId, canReadCloud, onMemberDenied }} userId={userId} questionId={saved.id}
            version={version} generation={resultGeneration} onResultsChanged={onResultsChanged} />
        </PracticePanel>}
        <PracticePanel title={t('settings')} compact icon={<Settings size={20} aria-hidden="true" />}>
          <ChallengePracticeSettings pitchTraceEnabled={pitchTraceEnabled} setPitchTraceEnabled={setPitchTraceEnabled}
            mix={audioMix[0]} setMix={audioMix[1]} audioBusy={audioBusy} measuring={measuring} onMeasure={setMeasuring} />
        </PracticePanel>
      </div>} />
    <main className="page-shell challenge-page">
      {resultNotice}
      {editing && <form className="challenge-form" aria-labelledby={`${id}-heading`} onSubmit={event => {
        event.preventDefault();
        void save();
      }}>
        <label htmlFor={`${id}-source`}>{t('sight.questionSource')}</label>
        <select id={`${id}-source`} name="source" value={sourceMode} disabled={saving} onChange={event => changeSourceMode(event.target.value as SourceMode)}>
          {savedSource?.snapshot && <option value="saved">{t('sight.keepSnapshot')}</option>}
          <option value="library">{t('sight.chooseLibrarySource')}</option>
          <option value="upload">{t('sight.uploadSource')}</option>
        </select>
        {sourceMode === 'saved' && savedSource?.snapshot && <p className="challenge-source-file">
          <span>{t('sight.savedSource')}{versionSuffix}</span><strong>{savedSource.snapshot.name}</strong>
        </p>}
        {sourceMode === 'upload' && <>
          <label htmlFor={`${id}-upload`}>{t('sight.uploadSource')}</label>
          <input id={`${id}-upload`} name="upload" type="file" accept={attachmentAccept('musicxml')} onChange={event => changeUpload(event.target.files?.[0] ?? null)}
            disabled={saving} required aria-invalid={badUpload || undefined} aria-describedby={badUpload ? `${id}-upload-error` : undefined} />
          {badUpload && <p id={`${id}-upload-error`} role="alert" className="challenge-error">{t('sight.invalidSourceFile')}</p>}
        </>}
        {sourceMode === 'library' && <>
          <label htmlFor={`${id}-score`}>{t('sight.score')}</label>
          <select id={`${id}-score`} name="score" value={score?.id ?? ''} disabled={saving} required onChange={event => { setScoreId(event.target.value); setFileChoice(''); resetRange(); }}>
            <option value="">{t('sight.chooseScore')}</option>
            {candidates.map(item => <option key={item.id} value={item.id}>{item.fileName}</option>)}
          </select>
          {!candidates.length && <small>{t('sight.noScores')}</small>}
          {status === 'ready' && <>
            <label htmlFor={`${id}-files`}>{t('musicXmlScore')}</label>
            <select id={`${id}-files`} name="attachment" value={attachment ? fileKey(attachment) : ''} disabled={saving} required onChange={event => { setFileChoice(event.target.value); resetRange(); }}>
              <option value="">{t(files.length ? 'sight.chooseFile' : 'sight.noFiles')}</option>
              {files.map(file => <option key={file.id} value={fileKey(file)}>{file.source === 'generated' ? t('generatedBadge') : file.name}</option>)}
            </select>
          </>}
        </>}
        {loaded.document && loaded.document.visits.length > 0 && <QuestionRangeEditor document={loaded.document}
          first={first} last={last} beats={beats} disabled={saving} formatMeasure={visitLabel}
          onRangeChange={(start, end, nextBeats) => { setFirst(start); setLastChoice(end); setBeats(nextBeats); }} />}
        {!saved && canPublishOfficial && <fieldset className="challenge-publish-role" disabled={saving}>
          <legend>{t('sight.publishIdentity')}</legend>
          <label><input type="radio" name="publication" value="member" checked={publication === 'member'}
            onChange={() => setPublication('member')} />{t('sight.publishAsSelf')}</label>
          <label><input type="radio" name="publication" value="official" checked={publication === 'official'}
            onChange={() => setPublication('official')} />{t('sight.officialPublisher')}</label>
        </fieldset>}
        <label htmlFor={`${id}-name`}>{t('sight.name')}</label>
        <input id={`${id}-name`} name="title" value={title} maxLength={SIGHT_SINGING_QUESTION_NAME_MAX_LENGTH} disabled={saving} required
          onChange={event => {
            const value = event.target.value;
            setTitleOverride(value);
            event.target.setCustomValidity(value && !value.trim() ? t('sight.nameRequired') : '');
          }} />
        <div className="challenge-actions">
          {!canReadCloud && <small role="status">{entry('identity.unreachable')}{' '}
            <button type="button" className="text-button" onClick={retryConnection}>{entry('identity.retryConnection')}</button>
          </small>}
          <button type="submit" className="primary-button" aria-describedby={!saved ? `${id}-publish` : undefined}
            disabled={saving || deleting || !canReadCloud || !playable || (Boolean(saved) && !editable)}>{t(replace ? 'sight.replacePublished' : saved ? 'sight.updatePublished' : 'sight.publish')}</button>
          {saved?.snapshot.editToken && editable && <button type="button" className="secondary-button"
            disabled={saving || deleting || !canReadCloud} onClick={() => { setDeleteFailed(false); setConfirmingDelete(true); }}>
            {t('sight.deleteQuestion')}
          </button>}
        </div>
        <small>{t('sight.sourceFrozen')}</small>
        {!saved && <small id={`${id}-publish`}>{t('sight.publishScope')}</small>}
      </form>}
      {(status === 'loading' || (source && !loaded.failed && !loaded.document)) && <LoadingStatus>{t('sight.loading')}</LoadingStatus>}
      {(status === 'error' || status === 'unavailable') && <p role="alert" className="challenge-error">{t('sight.sourceError')} <button type="button" className="text-button" onClick={canReadCloud ? attachments.retry : retryConnection}>{t('sight.tryLoad')}</button></p>}
      {needsSource && <p role="alert" className="challenge-error">{t('sight.sourceChanged')}</p>}
      {loaded.failed && source?.kind !== 'upload' && <p role="alert" className="challenge-error">{t('sight.sourceError')} <button type="button" className="text-button" onClick={canReadCloud || source?.kind === 'local' ? loaded.retry : retryConnection}>{t('sight.tryLoad')}</button></p>}
      {typeof issue === 'string' && <p role="alert" className="challenge-error">{t(`sight.${issue}`)}</p>}
      {failed && <p role="alert" className="challenge-error">{t('sight.publishError')}</p>}
      {deleteFailed && <p role="alert" className="challenge-error">{t('sight.deleteQuestionFailed')}</p>}
      <ConfirmDialog busy={deleting} onClose={() => setConfirmingDelete(false)} confirmation={confirmingDelete && saved ? {
        title: t('sight.deleteQuestion'), message: t('sight.deleteQuestionConfirm', { title: saved.title }),
        action: t('sight.deleteQuestion'), destructive: true, onConfirm: remove,
      } : null} />
      {!editing && loaded.document && selected && <ChallengeRun ref={currentResult} document={loaded.document} selected={selected} voices={voices}
        selectVoice={setVoiceChoice} questionVersion={version}
        pitchTraceEnabled={pitchTraceEnabled} mix={audioMix[0]} onScored={attempt => { if (saved) onResult(saved.id, attempt); }} onAudioBusy={setAudioBusy}
        measuring={measuring} onMeasure={setMeasuring} onLatency={latency => audioMix[1](current => ({ ...current, latency }))} />}
    </main>
  </div>;
}
