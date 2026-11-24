import { useLiveQuery } from 'dexie-react-hooks';
import { ChevronRight, Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useAppLocale, useMessages } from '../../i18n';
import { attachmentAccept, attachmentFormat, attachmentNameSchema } from '../../shared/attachments';
import type { ScoreSummary } from '../../shared/scores';
import { publishedQuestionResponseSchema, publishedQuestionsSchema, SIGHT_SINGING_SCORE_MAX_BYTES,
  type PublishedQuestion, type QuestionPublication } from '../../shared/sight-singing';
import { diagnosticFetch, parseDiagnosticResponse } from '../diagnostics/diagnostics';
import { useApplicationIdentity } from '../auth/application-identity';
import { LoadingStatus } from '../components/loading-status';
import { TaskHeader } from '../components/task-header';
import { useNetworkStatus } from '../platform/use-network-status';
import { useLibraryAttachments } from '../score-library/attachments/use-library-attachments';
import { driveCacheOwnerKey, type DriveCacheOwnerKey } from '../score-library/drive-library-cache';
import { useDriveLibraryResource } from '../score-library/use-drive-library';
import { captureNavigationIdentity } from '../settings/navigation-events';
import { ConfirmDialog } from '../settings/confirm-dialog';
import { ChallengeRun, type ResultSave, type ScoredTake, type VoiceOption } from './challenge-run';
import { buildMelody } from './melody';
import { readQuestions, type SightSingingQuestion } from './questions';
import { compactPracticeHistory, markTakeWithdrawn, saveTake } from './practice-history';
import { publishSightSingingResult, readSightSingingLeaderboard, readSightSingingResults, withdrawSightSingingResult } from './result-publication';
import { currentSingingScoringRule, legacySingingScoringRule, previousSingingScoringRule, sightSingingScoringRuleSchema,
  type PublishedSightSingingResult, type SightSingingLeaderboard, type SightSingingScoringRule, type SightSingingVersionFilter } from '../../shared/sight-singing-results';
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
  const [board, setBoard] = useState<{ edition: SightSingingVersionFilter; voice: string; reload: number; results: SightSingingLeaderboard['results'] | null }>();
  const [selection, setSelection] = useState<{ question?: PublishedQuestion; legacy?: SightSingingQuestion } | null>(null);
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
      setBoard({ edition, voice, reload, results: payload.results });
    }).catch(() => {
      if (!controller.signal.aborted) setBoard({ edition, voice, reload, results: null });
    });
    return () => controller.abort();
  }, [props.choirId, edition, voice, reload]);
  const ranked = board?.edition === edition && board.voice === voice && board.reload === reload ? board.results : undefined;
  if (selection) return <QuestionWorkspace {...props} {...selection}
    onBack={() => { setSelection(null); setReload(value => value + 1); }} />;
  const legacyQuestions = questions?.filter(question => !published?.some(item => item.id === question.id));
  return <div className="app-page">
    <TaskHeader title={t('sight.title')} subtitle={driveName} backTo={`/choirs/${props.choirId}`} />
    <main className="page-shell settings-page challenge-page">
      <div className="challenge-library-header"><h2>{t('sight.questions')}</h2>
        <button className="primary-button" type="button" onClick={() => setSelection({})}><Plus size={18} aria-hidden="true" />{t('sight.create')}</button>
      </div>
      <section className="challenge-library-section" aria-label={t('sight.publishedQuestions')}>
        <div className="challenge-result-filters">
          <label className="challenge-version-filter">
            <span className="visually-hidden">{t('sight.resultVersionFilter')}</span>
            <select value={edition} onChange={event => setEdition(event.target.value === 'latest' ? 'latest' : 'all')}>
              <option value="all">{t('sight.allVersions')}</option>
              <option value="latest">{t('sight.latestVersion')}</option>
            </select>
          </label>
          <VoiceFilter voice={voice} voices={parts} onChange={setVoice} />
        </div>
        {ranked === null && <p role="alert">{t('sight.publishedResultsError')} <button className="text-button" type="button"
          onClick={() => setReload(value => value + 1)}>{t('sight.retryLoad')}</button></p>}
        {published === undefined ? <LoadingStatus>{t('sight.loading')}</LoadingStatus>
          : published === null ? <p role="alert">{t('sight.publishedError')} <button type="button" className="text-button" onClick={() => { setPublished(undefined); setReload(value => value + 1); }}>{t('sight.retryLoad')}</button></p>
          : <QuestionList questions={published} scores={ranked} open={question => setSelection({ question })} />}
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

function QuestionList({ questions, scores, open }: {
  questions: PublishedQuestion[]; scores?: SightSingingLeaderboard['results'] | null; open: (question: PublishedQuestion) => void;
}) {
  const t = useMessages('practice');
  const byQuestion = new Map<string, SightSingingLeaderboard['results']>();
  for (const score of scores ?? []) {
    const top = byQuestion.get(score.questionId) ?? [];
    top.push(score);
    byQuestion.set(score.questionId, top);
  }
  return questions.length ? <ul className="challenge-card-grid" role="list" aria-busy={scores === undefined}>
    {questions.map(question => {
      const top = byQuestion.get(question.id);
      return <li className="challenge-card" key={question.id}>
        <button type="button" className="challenge-card-open" onClick={() => open(question)}>
          <span><strong>{question.title}</strong><small>{publisherLabel(question.publisher, t)} · {versionTag(question.version)}</small></span>
          <ChevronRight size={17} aria-hidden="true" />
        </button>
        {top?.length ? <ol className="challenge-card-ranks" aria-label={t('sight.topThree')}>
          {top.map(row => <li key={row.id}>
            <div><span>{row.displayName}</span><strong>{t('sight.takeScore', { score: row.score })}</strong></div>
            <small>{row.voiceName} · {versionTag(row.version)}</small>
          </li>)}
        </ol> : <p className="challenge-card-empty">{question.publisher?.kind === 'member'
          ? t('sight.localCardScores') : scores ? t('sight.noCardScores') : '—'}</p>}
      </li>;
    })}
  </ul> : <p className="challenge-empty">{t('sight.noPublished')}</p>;
}

function PublishedResults({ choirId, questionId, version, generation, owner, userId }: {
  choirId: string; questionId: string; version: number; generation: number; owner: DriveCacheOwnerKey; userId: string;
}) {
  const t = useMessages('practice');
  const ruleId = useId();
  const [expanded, setExpanded] = useState(false);
  const [filter, setFilter] = useState<number | null>(null);
  const [voice, setVoice] = useState('');
  const [voices, setVoices] = useState<string[]>([]);
  const [scoringRule, setScoringRule] = useState<SightSingingScoringRule>(currentSingingScoringRule);
  const [previousRules, setPreviousRules] = useState<SightSingingScoringRule[]>([]);
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<{ generation: number; retry: number; filter: number | null; scoringRule: SightSingingScoringRule;
    voice: string; rows: PublishedSightSingingResult[] | null }>();
  const [versions, setVersions] = useState([version]);
  const [removing, setRemoving] = useState<PublishedSightSingingResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [withdrawFailed, setWithdrawFailed] = useState(false);
  useEffect(() => {
    if (!expanded) return;
    const controller = new AbortController();
    void readSightSingingResults(choirId, questionId, filter, scoringRule, voice, controller.signal).then(payload => {
      if (controller.signal.aborted) return;
      setState({ generation, retry, filter, scoringRule, voice, rows: payload.results });
      if (payload.versions) setVersions(payload.versions);
      setPreviousRules(payload.previousRules ?? (payload.hasLegacyScores ? [legacySingingScoringRule] : []));
      setVoices(payload.voices ?? []);
    }).catch(() => {
      if (!controller.signal.aborted) setState({ generation, retry, filter, scoringRule, voice, rows: null });
    });
    return () => controller.abort();
  }, [choirId, questionId, filter, scoringRule, voice, expanded, generation, retry]);
  const rows = state?.generation === generation && state.retry === retry && state.filter === filter && state.scoringRule === scoringRule && state.voice === voice
    ? state.rows : undefined;
  const rules = [...new Set<SightSingingScoringRule>([currentSingingScoringRule, ...previousRules, scoringRule])];
  const ruleLabel = (rule: SightSingingScoringRule) => rule === legacySingingScoringRule
    ? t('sight.legacyScoringRule') : t('sight.intonationRule', { cents: rule === previousSingingScoringRule ? 25 : 15 });
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
  return <details className="challenge-published-results" onToggle={event => setExpanded(event.currentTarget.open)}>
    <summary>{t('sight.bestResults')}</summary>
    {expanded && <>
      <div className="challenge-result-filters">
        <label className="challenge-version-filter">
          <span className="visually-hidden">{t('sight.resultVersionFilter')}</span>
          <select value={filter ?? ''} onChange={event => setFilter(event.target.value ? Number(event.target.value) : null)}>
            <option value="">{t('sight.allVersions')}</option>
            {versions.map(edition => <option key={edition} value={edition}>{versionTag(edition)}</option>)}
          </select>
        </label>
        <VoiceFilter voice={voice} voices={voices} onChange={setVoice} />
        {rules.length > 1 && <div className="challenge-version-filter">
          <label htmlFor={ruleId} className="visually-hidden">{t('sight.scoringRuleFilter')}</label>
          <select id={ruleId} value={scoringRule} onChange={event => {
            const selected = sightSingingScoringRuleSchema.safeParse(Number(event.target.value));
            if (selected.success) { setScoringRule(selected.data); setVoice(''); setVoices([]); }
          }}>
            {rules.map(rule => <option key={rule} value={rule}>{ruleLabel(rule)}</option>)}
          </select>
        </div>}
      </div>
      {withdrawFailed && <p role="alert">{t('sight.withdrawFailed')}</p>}
      {rows === undefined ? <LoadingStatus>{t('sight.loading')}</LoadingStatus>
        : rows === null ? <p role="alert">{t('sight.publishedResultsError')} <button type="button" className="text-button" onClick={() => setRetry(value => value + 1)}>{t('sight.retryLoad')}</button></p>
        : rows.length === 0 ? <p className="challenge-empty">{t('sight.publishedResultsEmpty')}</p>
          : <ul className="challenge-list challenge-score-list">{rows.map(row => <li key={row.id}>
            <div><strong>{row.displayName}</strong><small>{row.voiceName} · {versionTag(row.version)}{row.speed !== undefined && ` · ${row.speed.toFixed(2)}×`}</small></div>
            <div className="challenge-ranked-action"><strong>{t('sight.takeScore', { score: row.score })}</strong>
              {row.own && <button type="button" className="text-button" aria-label={t('sight.withdrawResult', { version: versionTag(row.version) })}
                onClick={() => setRemoving(row)}><Trash2 size={16} aria-hidden="true" /></button>}
            </div>
          </li>)}</ul>}
      <ConfirmDialog busy={busy} onClose={() => setRemoving(null)} confirmation={removing && {
        title: t('sight.withdrawResult', { version: versionTag(removing.version) }), message: t('sight.withdrawDescription'),
        action: t('sight.withdrawAction'), destructive: true, onConfirm: withdraw,
      }} />
    </>}
  </details>;
}

function QuestionWorkspace({ owner, choirId, sessionId, userId, canPublishOfficial, scores, question, legacy, onBack }: DriveContext & {
  question?: PublishedQuestion; legacy?: SightSingingQuestion; onBack: () => void;
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
      published: false, percent: attempt.score };
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
  return <div className="app-page challenge-workspace">
    <TaskHeader title={<span ref={heading} tabIndex={-1} id={`${id}-heading`}>{editing ? t(saved ? 'sight.edit' : 'sight.create') : saved?.title}</span>}
      subtitle={editing || !saved ? undefined : loaded.document ? `${range} · ${versionTag(version)} · ${publisherLabel(saved.publisher, t)}`
        : publisherLabel(saved.publisher, t)} backTo={`/choirs/${choirId}`} onBack={onBack} backLabel={t('sight.backToQuestions')}
      actions={canEdit && <button type="button" className="icon-button" aria-label={t('sight.edit')} title={t('sight.edit')} onClick={() => { setSourceMode(saved?.snapshot ? 'saved' : 'library'); setEditing(true); }}><Pencil size={18} aria-hidden="true" /></button>} />
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
          <span>{t('sight.savedSource')} · {versionTag(savedSource.version ?? 1)}</span><strong>{savedSource.snapshot.name}</strong>
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
        backingUnavailable={backingUnavailable} selectVoice={setVoiceChoice} visitLabel={visitLabel} questionVersion={version}
        canPublishResult={canPublishResult} onScored={recordResult} />}
      {!editing && canPublishResult && saved && <PublishedResults key={`${saved.id}:${version}`}
        choirId={choirId} owner={owner} userId={userId} questionId={saved.id} version={version} generation={resultGeneration} />}
    </main>
  </div>;
}
