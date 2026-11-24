import { useLiveQuery } from 'dexie-react-hooks';
import { ChevronDown, ChevronRight, ListFilter, Pencil, Settings, Trophy, UsersRound, X } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button, DialogTrigger, Heading, MenuItem, MenuTrigger, Modal, ModalOverlay, Popover, Switch } from 'react-aria-components';
import { useParams } from 'react-router-dom';
import { useAppLocale, useMessages } from '../../i18n';
import { attachmentAccept, attachmentFormat, attachmentNameSchema } from '../../shared/attachments';
import type { ScoreSummary } from '../../shared/scores';
import { publishedQuestionResponseSchema, publishedQuestionsSchema, SIGHT_SINGING_SCORE_MAX_BYTES,
  type PublishedQuestion, type QuestionPublication } from '../../shared/sight-singing';
import { diagnosticFetch, parseDiagnosticResponse } from '../diagnostics/diagnostics';
import { useApplicationIdentity } from '../auth/application-identity';
import { FloatingAddButton } from '../components/floating-add-button';
import { LoadingStatus } from '../components/loading-status';
import { TaskHeader } from '../components/task-header';
import { useNetworkStatus } from '../platform/use-network-status';
import { useLibraryAttachments } from '../score-library/attachments/use-library-attachments';
import { driveCacheOwnerKey, type DriveCacheOwnerKey } from '../score-library/drive-library-cache';
import { useDriveLibraryResource } from '../score-library/use-drive-library';
import { Dialog, Menu } from '../navigation/overlays';
import { captureNavigationIdentity } from '../settings/navigation-events';
import { ConfirmDialog } from '../settings/confirm-dialog';
import { ChallengeRun, type ResultSave, type ScoredTake, type VoiceOption } from './challenge-run';
import { useSightSingingScoreFormat } from './format-score';
import { buildMelody } from './melody';
import { readQuestions, type SightSingingQuestion } from './questions';
import { ScoreBadges } from './score-badge';
import { compactPracticeHistory, markTakeWithdrawn, saveTake } from './practice-history';
import { publishSightSingingResult, readSightSingingLeaderboard, readSightSingingResults, withdrawSightSingingResult } from './result-publication';
import type { PublishedSightSingingResult, SightSingingLeaderboard, SightSingingVersionFilter } from '../../shared/sight-singing-results';
import { publishedPath, sightSingingProtocol, useMelodySource, type MelodySource } from './use-melody-source';
import './sight-singing.css';
import './sight-singing-workspace.css';

export default function SightSingingPage() {
  const { choirId = '' } = useParams();
  const identity = useApplicationIdentity();
  const owner = driveCacheOwnerKey(identity.authenticatedUserId, choirId);
  const sessionId = identity.authenticatedSessionId;
  const t = useMessages('practice');
  const online = useNetworkStatus();
  const { snapshot: { access } } = useDriveLibraryResource(owner, choirId, Boolean(sessionId), Boolean(sessionId), sessionId);
  const userId = identity.authenticatedUserId;
  const allowed = online && Boolean(sessionId && userId) && access.kind === 'opened' && access.isMember && !access.local && !access.choir.isPreviewEntry;
  if (allowed && sessionId && userId) return <QuestionLibrary key={JSON.stringify([owner, choirId, sessionId])}
    owner={owner} choirId={choirId} driveName={access.choir.name} sessionId={sessionId} userId={userId}
    canPublishOfficial={access.result.permissions.capabilities.operations.operations.includes('editDriveInfo')} scores={access.result.scores} />;
  return <div className="app-page">
    <TaskHeader title={t('sight.title')} backTo={`/choirs/${choirId}`} />
    <main className="page-shell settings-page challenge-page">
      {online && (identity.restoring || sessionId && access.kind === 'loading') ? <LoadingStatus>{t('sight.loading')}</LoadingStatus>
        : <p role="status">{t('sight.needMember')}</p>}
    </main>
  </div>;
}

type DriveContext = { owner: DriveCacheOwnerKey; choirId: string; sessionId: string; userId: string; canPublishOfficial: boolean; scores: ScoreSummary[] };
type SourceMode = 'saved' | 'library' | 'upload';
const versionTag = (version: number) => `V${version}`;
function publisherLabel(publisher: PublishedQuestion['publisher'], t: ReturnType<typeof useMessages<'practice'>>) {
  if (publisher?.kind !== 'member') return t('sight.officialPublisher');
  if (publisher.own) return t('sight.selfPublisher');
  return publisher.name ? t('sight.namedPublisher', { name: publisher.name }) : t('sight.memberPublisher');
}

function QuestionLibrary({ driveName, ...props }: DriveContext & { driveName: string }) {
  const t = useMessages('practice');
  const questions = useLiveQuery(() => readQuestions(props.owner, props.choirId).catch(() => null), [props.owner, props.choirId]);
  const [published, setPublished] = useState<PublishedQuestion[] | null>();
  const [reload, setReload] = useState(0);
  const [edition, setEdition] = useState<SightSingingVersionFilter>('all');
  const [voice, setVoice] = useState('');
  const [parts, setParts] = useState<string[]>([]);
  const [board, setBoard] = useState<{ edition: SightSingingVersionFilter; voice: string; reload: number; leaderboard: SightSingingLeaderboard | null }>();
  const [selection, setSelection] = useState<{ question?: PublishedQuestion; legacy?: SightSingingQuestion } | null>(null);
  const [pitchTraceEnabled, setPitchTraceEnabled] = useState(false);
  useEffect(() => {
    void compactPracticeHistory(props.owner).catch(() => undefined);
  }, [props.owner]);
  useEffect(() => {
    const controller = new AbortController();
    void diagnosticFetch(publishedPath(props.choirId), { signal: controller.signal, headers: sightSingingProtocol }).then(async response => {
      if (!response.ok) throw new Error('questions_unavailable');
      const payload = await parseDiagnosticResponse(response, publishedQuestionsSchema);
      if (!controller.signal.aborted) setPublished(payload.questions);
    }).catch(() => { if (!controller.signal.aborted) setPublished(null); });
    return () => controller.abort();
  }, [props.choirId, reload]);
  useEffect(() => {
    const controller = new AbortController();
    void readSightSingingLeaderboard(props.choirId, edition, voice, controller.signal).then(payload => {
      if (controller.signal.aborted) return;
      setParts(payload.voices);
      setBoard({ edition, voice, reload, leaderboard: payload });
    }).catch(() => {
      if (!controller.signal.aborted) setBoard({ edition, voice, reload, leaderboard: null });
    });
    return () => controller.abort();
  }, [props.choirId, edition, voice, reload]);
  const ranked = board?.edition === edition && board.voice === voice && board.reload === reload ? board.leaderboard : undefined;
  if (selection) return <QuestionWorkspace {...props} {...selection} pitchTraceEnabled={pitchTraceEnabled} setPitchTraceEnabled={setPitchTraceEnabled}
    onBack={() => { setSelection(null); setReload(value => value + 1); }} />;
  const legacyQuestions = questions?.filter(question => !published?.some(item => item.id === question.id));
  return <div className="app-page challenge-library">
    <TaskHeader title={t('sight.title')} subtitle={driveName} backTo={`/choirs/${props.choirId}`}
      actions={<div className="challenge-header-actions">
        <PracticePanel title={t('sight.rankFilters')} icon={<ListFilter size={21} aria-hidden="true" />}
          active={edition !== 'all' || voice !== ''} compact>
          <div className="challenge-filter-options">
            <label className="challenge-version-filter">
              <span>{t('sight.resultVersionFilter')}</span>
              <select value={edition} onChange={event => setEdition(event.target.value === 'latest' ? 'latest' : 'all')}>
                <option value="all">{t('sight.allVersions')}</option>
                <option value="latest">{t('sight.latestVersion')}</option>
              </select>
            </label>
            <VoiceFilter voice={voice} voices={parts} onChange={setVoice} showLabel />
          </div>
        </PracticePanel>
      </div>} />
    <main className="page-shell settings-page challenge-page">
      <section className="challenge-library-section" aria-label={t('sight.publishedQuestions')}>
        {ranked === null && <p role="alert">{t('sight.publishedResultsError')} <button className="text-button" type="button"
          onClick={() => setReload(value => value + 1)}>{t('sight.retryLoad')}</button></p>}
        {published === undefined ? <LoadingStatus>{t('sight.loading')}</LoadingStatus>
          : published === null ? <p role="alert">{t('sight.publishedError')} <button type="button" className="text-button" onClick={() => { setPublished(undefined); setReload(value => value + 1); }}>{t('sight.retryLoad')}</button></p>
          : <QuestionList questions={published} leaderboard={ranked} participants={board?.leaderboard?.participants}
            choirId={props.choirId} edition={edition} voice={voice} open={question => setSelection({ question })} />}
      </section>
      {questions === null ? <p role="alert">{t('sight.storageError')}</p> : Boolean(legacyQuestions?.length) &&
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
    <FloatingAddButton label={t('sight.create')} onPress={() => setSelection({})} />
  </div>;
}

function VoiceFilter({ voice, voices, onChange, showLabel }: { voice: string; voices: string[]; showLabel?: boolean; onChange: (voice: string) => void }) {
  const t = useMessages('practice');
  return <label className="challenge-version-filter">
    <span className={showLabel ? undefined : 'visually-hidden'}>{t('sight.voiceFilter')}</span>
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

function QuestionList({ questions, leaderboard, participants, choirId, edition, voice, open }: {
  questions: PublishedQuestion[]; leaderboard?: SightSingingLeaderboard | null;
  participants?: SightSingingLeaderboard['participants']; choirId: string; edition: SightSingingVersionFilter; voice: string;
  open: (question: PublishedQuestion) => void;
}) {
  const t = useMessages('practice');
  const byQuestion = new Map<string, SightSingingLeaderboard['results']>();
  for (const score of leaderboard?.results ?? []) {
    const top = byQuestion.get(score.questionId) ?? [];
    top.push(score);
    byQuestion.set(score.questionId, top);
  }
  const counts = participants && new Map(participants.map(item => [item.questionId, item.count]));
  return questions.length ? <ul className="challenge-card-grid" role="list" aria-busy={leaderboard === undefined}>
    {questions.map(question => <QuestionCard key={question.id} question={question} top={byQuestion.get(question.id)}
      choirId={choirId} versionFilter={edition === 'latest' ? question.version : null} voiceFilter={voice}
      count={question.publisher?.kind === 'member' || !counts ? undefined : counts.get(question.id) ?? 0}
      ready={Boolean(leaderboard)} open={() => open(question)} />)}
  </ul> : <p className="challenge-empty">{t('sight.noPublished')}</p>;
}

function QuestionCard({ question, top, count, choirId, versionFilter, voiceFilter, ready, open }: {
  question: PublishedQuestion; top?: SightSingingLeaderboard['results']; count?: number; ready: boolean; open: () => void;
  choirId: string; versionFilter: number | null; voiceFilter: string;
}) {
  const t = useMessages('practice');
  const formatScore = useSightSingingScoreFormat();
  const rankingId = useId();
  const [expanded, setExpanded] = useState(false);
  const [retry, setRetry] = useState(0);
  const [details, setDetails] = useState<{ version: number | null; voice: string; retry: number; rows: PublishedSightSingingResult[] | null }>();
  useEffect(() => {
    if (!expanded) return;
    const controller = new AbortController();
    void readSightSingingResults(choirId, question.id, versionFilter, voiceFilter, controller.signal).then(payload => {
      if (!controller.signal.aborted) setDetails({ version: versionFilter, voice: voiceFilter, retry, rows: payload.results });
    }).catch(() => {
      if (!controller.signal.aborted) setDetails({ version: versionFilter, voice: voiceFilter, retry, rows: null });
    });
    return () => controller.abort();
  }, [expanded, choirId, question.id, versionFilter, voiceFilter, retry]);
  const loaded = details?.version === versionFilter && details.voice === voiceFilter && details.retry === retry ? details.rows : undefined;
  const rows = expanded ? loaded : top;
  const showDetailsButton = expanded || Boolean(top?.length);
  const showVersions = question.version > 1;
  return <li className="challenge-card">
    <button type="button" className="challenge-card-open" onClick={open}>
      <span><strong>{question.title}</strong><small>{publisherLabel(question.publisher, t)}{showVersions && ` · ${versionTag(question.version)}`}</small></span>
      <ChevronRight size={17} aria-hidden="true" />
    </button>
    <div className="challenge-card-podium">
      {(count !== undefined || showDetailsButton) && <div className="challenge-card-summary">
        {count !== undefined && <span className="challenge-card-participants"><UsersRound size={14} aria-hidden="true" />
          {t('sight.participants', { count })}</span>}
        {showDetailsButton && <button type="button" className="challenge-card-detail-button" aria-label={t('sight.rankDetails')}
          aria-controls={rankingId} aria-expanded={expanded} onClick={() => { if (expanded) setDetails(undefined); setExpanded(!expanded); }}>
          <ChevronDown size={17} aria-hidden="true" />
        </button>}
      </div>}
      <div id={rankingId}>
        {rows?.length ? <ol className="challenge-card-ranks" role="list" aria-label={t(expanded ? 'sight.bestResults' : 'sight.topThree')}>
          {rankScores(rows).map(({ row, place, tied }) => <li key={row.id}>
            <RankBadge place={place} tied={tied} />
            <div className="challenge-card-result">
              <div className="challenge-card-result-main"><span>{row.displayName}</span>
                <strong className="challenge-marked-score">
                  <ScoreBadges perfect={row.perfect} writtenOctave={row.writtenOctave} />
                  {t('sight.takeScore', { score: formatScore(row.score) })}
                </strong>
              </div>
              {expanded && <small>{row.voiceName}{showVersions && ` · ${versionTag(row.version)}`}
                {row.speed !== undefined && ` · ${row.speed.toFixed(2)}×`}</small>}
            </div>
          </li>)}
        </ol> : expanded && rows === undefined ? <LoadingStatus>{t('sight.loading')}</LoadingStatus>
          : rows === null ? <p className="challenge-card-empty" role="alert">{t('sight.publishedResultsError')}{' '}
            <button className="text-button" type="button" onClick={() => setRetry(value => value + 1)}>{t('sight.retryLoad')}</button></p>
          : <p className="challenge-card-empty">{question.publisher?.kind === 'member'
            ? t('sight.localCardScores') : expanded || ready ? t('sight.noCardScores') : '—'}</p>}
      </div>
    </div>
  </li>;
}

function PracticePanel({ title, icon, active, compact, children }: {
  title: string; icon: ReactNode; active?: boolean; compact?: boolean; children: ReactNode;
}) {
  const t = useMessages('practice');
  return <DialogTrigger>
    <Button className="icon-button" aria-label={title} data-active={active || undefined}>{icon}</Button>
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
      {row.speed !== undefined && ` · ${row.speed.toFixed(2)}×`}</small></span>
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
      <ScoreBadges perfect={row.perfect} writtenOctave={row.writtenOctave} />
      {t('sight.takeScore', { score: formatScore(row.score) })}
    </strong>
  </li>;
}

function PublishedResults({ choirId, questionId, version, generation, owner, userId }: {
  choirId: string; questionId: string; version: number; generation: number; owner: DriveCacheOwnerKey; userId: string;
}) {
  const t = useMessages('practice');
  const showVersions = version > 1;
  const [filter, setFilter] = useState<number | null>(null);
  const [voice, setVoice] = useState('');
  const [voices, setVoices] = useState<string[]>([]);
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<{ generation: number; retry: number; filter: number | null;
    voice: string; rows: PublishedSightSingingResult[] | null }>();
  const [versions, setVersions] = useState([version]);
  const [removing, setRemoving] = useState<PublishedSightSingingResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [withdrawFailed, setWithdrawFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void readSightSingingResults(choirId, questionId, filter, voice, controller.signal).then(payload => {
      if (controller.signal.aborted) return;
      setState({ generation, retry, filter, voice, rows: payload.results });
      if (payload.versions) setVersions(payload.versions);
      setVoices(payload.voices ?? []);
    }).catch(() => {
      if (!controller.signal.aborted) setState({ generation, retry, filter, voice, rows: null });
    });
    return () => controller.abort();
  }, [choirId, questionId, filter, voice, generation, retry]);
  const rows = state?.generation === generation && state.retry === retry && state.filter === filter && state.voice === voice
    ? state.rows : undefined;
  const removeLabel = (edition: number) => showVersions ? t('sight.withdrawResult', { version: versionTag(edition) }) : t('sight.withdrawAction');
  const withdraw = async () => {
    if (!removing || busy) return;
    setBusy(true); setWithdrawFailed(false);
    try {
      await withdrawSightSingingResult(choirId, questionId, userId, removing.id, removing.version);
      setRetry(value => value + 1);
      await markTakeWithdrawn(owner, choirId, removing.id).catch(() => undefined);
    } catch {
      setWithdrawFailed(true);
    } finally {
      setBusy(false);
    }
  };
  return <div className="challenge-published-results">
      <div className="challenge-result-filters">
        {showVersions && <label className="challenge-version-filter">
          <span className="visually-hidden">{t('sight.resultVersionFilter')}</span>
          <select value={filter ?? ''} onChange={event => setFilter(event.target.value ? Number(event.target.value) : null)}>
            <option value="">{t('sight.allVersions')}</option>
            {versions.map(edition => <option key={edition} value={edition}>{versionTag(edition)}</option>)}
          </select>
        </label>}
        <VoiceFilter voice={voice} voices={voices} onChange={setVoice} />
      </div>
      {withdrawFailed && <p role="alert">{t('sight.withdrawFailed')}</p>}
      {rows === undefined ? <LoadingStatus>{t('sight.loading')}</LoadingStatus>
        : rows === null ? <p role="alert">{t('sight.publishedResultsError')} <button type="button" className="text-button" onClick={() => setRetry(value => value + 1)}>{t('sight.retryLoad')}</button></p>
        : rows.length === 0 ? <p className="challenge-empty">{t('sight.publishedResultsEmpty')}</p>
          : <ul className="challenge-list challenge-score-list">{rankScores(rows).map(({ row, place, tied }) =>
            <PublishedResultRow key={row.id} row={row} place={place} tied={tied} showVersions={showVersions} onRemove={() => setRemoving(row)} />
          )}</ul>}
      <ConfirmDialog busy={busy} onClose={() => setRemoving(null)} confirmation={removing && {
        title: removeLabel(removing.version), message: t('sight.withdrawDescription'),
        action: t('sight.withdrawAction'), destructive: true, onConfirm: withdraw,
      }} />
  </div>;
}

function QuestionWorkspace({ owner, choirId, sessionId, userId, canPublishOfficial, scores, question, legacy, onBack,
  pitchTraceEnabled, setPitchTraceEnabled }: DriveContext & {
  question?: PublishedQuestion; legacy?: SightSingingQuestion; onBack: () => void;
  pitchTraceEnabled: boolean; setPitchTraceEnabled: (enabled: boolean) => void;
}) {
  const t = useMessages('practice');
  const { locale } = useAppLocale();
  const id = useId();
  const heading = useRef<HTMLSpanElement>(null);
  const [saved, setSaved] = useState(question);
  const draft = question ?? legacy;
  const [publication, setPublication] = useState<QuestionPublication>('member');
  const [sourceMode, setSourceMode] = useState<SourceMode>(draft?.snapshot ? 'saved' : 'library');
  const [upload, setUpload] = useState<{ key: string; file: File } | null>(null);
  const [invalidUpload, setInvalidUpload] = useState(false);
  const [resultGeneration, setResultGeneration] = useState(0);
  const [questionId] = useState(() => question?.id ?? crypto.randomUUID());
  const [editing, setEditing] = useState(!question);
  useEffect(() => { heading.current?.focus(); }, [editing]);
  const [title, setTitle] = useState(draft?.title ?? '');
  const [scoreId, setScoreId] = useState(draft?.scoreId ?? '');
  const [fileChoice, setFileChoice] = useState(draft?.attachmentId ? `${draft.attachmentId}:${draft.revision}` : '');
  const [voiceChoice, setVoiceChoice] = useState(legacy?.voice ?? '');
  const [first, setFirst] = useState(draft?.first ?? 0);
  const [lastChoice, setLastChoice] = useState<number | undefined>(draft?.last);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const saveLifetime = useRef<AbortController | null>(null);
  const resultLifetimes = useRef(new Set<AbortController>());
  useEffect(() => {
    const pending = resultLifetimes.current;
    return () => { saveLifetime.current?.abort(); for (const controller of pending) controller.abort(); };
  }, []);

  const visibleSource = editing ? sourceMode : saved?.snapshot ? 'saved' : 'library';
  const candidates = useMemo(() => scores.filter(score => (score.musicXmlCount ?? score.attachmentCount ?? 0) > 0), [scores]);
  const score = visibleSource === 'library' ? candidates.find(row => row.id === scoreId) : undefined;
  const attachments = useLibraryAttachments(choirId, score ? [score] : [], Boolean(score), sessionId, owner);
  const files = attachments.items.filter(file => file.kind === 'musicxml' && !file.trashExpiresAt)
    .sort((left, right) => Number(right.source === 'generated') - Number(left.source === 'generated'));
  const fileKey = (file: (typeof files)[number]) => `${file.id}:${file.revision}`;
  const attachment = files.find(file => fileKey(file) === fileChoice) ?? (!fileChoice && files.length === 1 ? files[0] : undefined);
  const version = saved?.version ?? 1;
  const savedSource = saved ?? legacy;
  let source: MelodySource | null = null;
  if (visibleSource === 'saved' && savedSource?.snapshot) {
    const snapshot = { choirId, questionId: savedSource.id, version: savedSource.version ?? 1, name: savedSource.snapshot.name };
    source = saved ? { kind: 'cloud', ...snapshot } : { kind: 'local', owner, ...snapshot };
  } else if (visibleSource === 'upload' && upload) source = { kind: 'upload', choirId, locale, ...upload };
  else if (visibleSource === 'library' && score && attachment) source = { kind: 'library', playback: { attachment, score, choirId, ownerKey: owner, sessionId } };
  const loaded = useMelodySource(source);
  const { bytes: loadedBytes, name: loadedName } = loaded;
  const last = lastChoice ?? (loaded.document?.visits.length ?? 1) - 1;
  const options = useMemo(() => {
    const document = loaded.document;
    return document?.voices.map(voice => ({ voice, melody: buildMelody(document, voice, first, last) })) ?? [];
  }, [loaded.document, first, last]);
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
  const resetRange = () => { setVoiceChoice(''); setFirst(0); setLastChoice(undefined); setFailed(false); };
  const changeSourceMode = (mode: SourceMode) => {
    setSourceMode(mode); resetRange(); setInvalidUpload(false); setUpload(null);
    if (mode === 'saved' && savedSource) { setFirst(savedSource.first); setLastChoice(savedSource.last); }
  };
  const changeUpload = (file: File | null) => {
    setUpload(null); setInvalidUpload(false); resetRange();
    if (!file) return;
    if (!attachmentNameSchema.safeParse(file.name).success || attachmentFormat(file.name)?.kind !== 'musicxml'
        || file.size === 0 || file.size > SIGHT_SINGING_SCORE_MAX_BYTES) { setInvalidUpload(true); return; }
    setUpload({ key: crypto.randomUUID(), file });
  };
  const range = first === last ? visitLabel(first) : `${visitLabel(first)} – ${visitLabel(last)}`;
  const editable = saved?.canEdit ?? canPublishOfficial;
  const save = async () => {
    if (!title.trim() || !source || !loadedBytes || !loadedName || !selected || saveLifetime.current || (saved && !editable)) return;
    const controller = new AbortController();
    saveLifetime.current = controller;
    const current = captureNavigationIdentity();
    setSaving(true); setFailed(false);
    try {
      const headers: Record<string, string> = { ...sightSingingProtocol, 'x-same-page-owner-user-id': userId };
      const payload = { title: title.trim(), first, last, expectedVersion: saved?.version ?? null,
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
      const response = await diagnosticFetch(`${publishedPath(choirId)}/${questionId}`, { method: 'PUT', signal: controller.signal, headers, body });
      if (!response.ok) throw new Error('publish_question_failed');
      const { question: next } = await parseDiagnosticResponse(response, publishedQuestionResponseSchema);
      if (!controller.signal.aborted && current()) {
        setTitle(next.title); setFirst(next.first); setLastChoice(next.last);
        setScoreId(next.scoreId ?? ''); setFileChoice(next.attachmentId ? `${next.attachmentId}:${next.revision}` : '');
        setSaved(next); setSourceMode(next.snapshot ? 'saved' : 'library'); setUpload(null); setEditing(false);
      }
    } catch { if (!controller.signal.aborted && current()) setFailed(true); }
    finally { saveLifetime.current = null; if (!controller.signal.aborted) setSaving(false); }
  };
  const canPublishResult = Boolean(saved?.snapshot && saved.publisher?.kind !== 'member');
  const recordResult = async (attempt: ScoredTake): Promise<ResultSave> => {
    if (!saved) throw new Error('result_question_missing');
    const controller = new AbortController(), current = captureNavigationIdentity();
    resultLifetimes.current.add(controller);
    const summary = { id: attempt.id, at: Date.now(), title: saved.title, questionId: saved.id, version: attempt.version,
      voiceId: attempt.voiceId, voiceName: attempt.voiceName, speed: attempt.speed, scoringRule: attempt.scoringRule,
      published: false, percent: attempt.score, perfect: attempt.perfect, writtenOctave: attempt.writtenOctave };
    try {
      const localBest = await saveTake(owner, choirId, summary, controller.signal);
      if (!canPublishResult) return localBest ? 'local' : 'previous';
      controller.signal.throwIfAborted();
      if (!current()) throw new Error('result_identity_changed');
      const published = await publishSightSingingResult(choirId, saved.id, userId, attempt, controller.signal);
      if (!controller.signal.aborted && current()) {
        setResultGeneration(value => value + 1);
        if (published && localBest) await saveTake(owner, choirId, { ...summary, published }, controller.signal).catch(() => undefined);
      }
      return published ? 'published' : 'previous';
    } finally {
      resultLifetimes.current.delete(controller);
    }
  };
  const status = score && attachments.statusFor(score.id);
  const needsSource = visibleSource === 'library' && ((!score && Boolean(scoreId)) || (score && status === 'ready' && !attachment && Boolean(fileChoice)));
  const playable = Boolean(loaded.document && selected);
  const issue = !selected && loaded.document ? options[0]?.melody ?? 'noMelody' : null;
  const canEdit = !editing && editable;
  const replace = Boolean(saved?.snapshot && (sourceMode !== 'saved' || first !== saved.first || last !== saved.last));
  const badUpload = invalidUpload || (source?.kind === 'upload' && loaded.failed);
  const backingUnavailable = options.some(({ melody }) => typeof melody === 'string' && melody !== 'noMelody');
  const versionSuffix = version > 1 ? ` · ${versionTag(version)}` : '';
  return <div className="app-page challenge-workspace">
    <TaskHeader title={<span ref={heading} tabIndex={-1} id={`${id}-heading`}>{editing ? t(saved ? 'sight.edit' : 'sight.create') : saved?.title}</span>}
      subtitle={editing || !saved ? undefined : `${loaded.document ? `${range} · ` : ''}${publisherLabel(saved.publisher, t)}${versionSuffix}`}
      backTo={`/choirs/${choirId}`} onBack={onBack} backLabel={t('sight.backToQuestions')}
      actions={!editing && <div className="challenge-header-actions">
        {canEdit && <button type="button" className="icon-button" aria-label={t('sight.edit')} title={t('sight.edit')}
          onClick={() => { setSourceMode(saved?.snapshot ? 'saved' : 'library'); setEditing(true); }}><Pencil size={18} aria-hidden="true" /></button>}
        {canPublishResult && saved && <PracticePanel title={t('sight.bestResults')} icon={<Trophy size={19} aria-hidden="true" />}>
          <PublishedResults key={`${saved.id}:${version}`} choirId={choirId} owner={owner} userId={userId} questionId={saved.id}
            version={version} generation={resultGeneration} />
        </PracticePanel>}
        <PracticePanel title={t('settings')} compact icon={<Settings size={20} aria-hidden="true" />}>
          <Switch className="challenge-settings-switch" isSelected={pitchTraceEnabled} onChange={setPitchTraceEnabled}>
            <span>{t('sight.pitchMonitor')}</span><span className="challenge-settings-switch-track" aria-hidden="true" />
          </Switch>
        </PracticePanel>
      </div>} />
    <main className="page-shell challenge-page">
      {editing && <form className="challenge-form" aria-labelledby={`${id}-heading`} onSubmit={event => {
        event.preventDefault();
        void save();
      }}>
        <label htmlFor={`${id}-name`}>{t('sight.name')}</label>
        <input id={`${id}-name`} name="title" value={title} onChange={event => { setTitle(event.target.value); event.target.setCustomValidity(event.target.value && !event.target.value.trim() ? t('sight.nameRequired') : ''); }} maxLength={80} disabled={saving} required />
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
        {loaded.document && <>
          <div className="challenge-range">
            <div><label htmlFor={`${id}-first`}>{t('sight.first')}</label><select id={`${id}-first`} name="first" value={first} disabled={saving} onChange={event => { const next = Number(event.target.value); setFirst(next); if (next > last) setLastChoice(next); }}>
              {loaded.document.visits.map((_, index) => <option key={index} value={index}>{visitLabel(index)}</option>)}
            </select></div>
            <div><label htmlFor={`${id}-last`}>{t('sight.last')}</label><select id={`${id}-last`} name="last" value={last} disabled={saving} onChange={event => setLastChoice(Number(event.target.value))}>
              {loaded.document.visits.map((_, index) => index >= first && <option key={index} value={index}>{visitLabel(index)}</option>)}
            </select></div>
          </div>
        </>}
        {!saved && canPublishOfficial && <fieldset className="challenge-publish-role" disabled={saving}>
          <legend>{t('sight.publishIdentity')}</legend>
          <label><input type="radio" name="publication" value="member" checked={publication === 'member'}
            onChange={() => setPublication('member')} />{t('sight.publishAsSelf')}</label>
          <label><input type="radio" name="publication" value="official" checked={publication === 'official'}
            onChange={() => setPublication('official')} />{t('sight.officialPublisher')}</label>
        </fieldset>}
        <div className="challenge-actions">
          <button type="submit" className="primary-button" aria-describedby={!saved ? `${id}-publish` : undefined}
            disabled={saving || !playable || (Boolean(saved) && !editable)}>{t(replace ? 'sight.replacePublished' : saved ? 'sight.updatePublished' : 'sight.publish')}</button>
        </div>
        <small>{t('sight.sourceFrozen')}</small>
        {!saved && <small id={`${id}-publish`}>{t('sight.publishScope')}</small>}
      </form>}
      {(status === 'loading' || (source && !loaded.failed && !loaded.document)) && <LoadingStatus>{t('sight.loading')}</LoadingStatus>}
      {status === 'error' && <p role="alert" className="challenge-error">{t('sight.sourceError')} <button type="button" className="text-button" onClick={attachments.retry}>{t('sight.tryLoad')}</button></p>}
      {needsSource && <p role="alert" className="challenge-error">{t('sight.sourceChanged')}</p>}
      {loaded.failed && source?.kind !== 'upload' && <p role="alert" className="challenge-error">{t('sight.sourceError')} <button type="button" className="text-button" onClick={loaded.retry}>{t('sight.tryLoad')}</button></p>}
      {typeof issue === 'string' && <p role="alert" className="challenge-error">{t(`sight.${issue}`)}</p>}
      {failed && <p role="alert" className="challenge-error">{t('sight.publishError')}</p>}
      {!editing && loaded.document && selected && <ChallengeRun document={loaded.document} selected={selected} voices={voices}
        backingUnavailable={backingUnavailable} selectVoice={setVoiceChoice} questionVersion={version}
        canPublishResult={canPublishResult} pitchTraceEnabled={pitchTraceEnabled} onScored={recordResult} />}
    </main>
  </div>;
}
