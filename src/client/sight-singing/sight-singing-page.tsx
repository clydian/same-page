import { useLiveQuery } from 'dexie-react-hooks';
import { ChevronRight, Mic, Pencil, Plus } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useAppLocale, useMessages } from '../../i18n';
import { attachmentAccept, attachmentFormat, attachmentNameSchema } from '../../shared/attachments';
import type { ScoreSummary } from '../../shared/scores';
import { publishedQuestionResponseSchema, publishedQuestionsSchema, SIGHT_SINGING_SCORE_MAX_BYTES, type PublishedQuestion } from '../../shared/sight-singing';
import { diagnosticFetch, parseDiagnosticResponse } from '../diagnostics/diagnostics';
import { useApplicationIdentity } from '../auth/application-identity';
import { LoadingStatus } from '../components/loading-status';
import { TaskHeader } from '../components/task-header';
import { useNetworkStatus } from '../platform/use-network-status';
import { useLibraryAttachments } from '../score-library/attachments/use-library-attachments';
import { driveCacheOwnerKey, type DriveCacheOwnerKey } from '../score-library/drive-library-cache';
import { useDriveLibraryResource } from '../score-library/use-drive-library';
import { captureNavigationIdentity } from '../settings/navigation-events';
import { ChallengeRun, type ResultDecision, type VoiceOption } from './challenge-run';
import { buildMelody } from './melody';
import { freezeLegacyQuestion, readQuestions, saveQuestion, type SightSingingQuestion } from './questions';
import { compactPracticeHistory, readTakes, saveTake, type PracticeTake } from './practice-history';
import { publishSightSingingResult, readSightSingingResults } from './result-publication';
import type { PublishedSightSingingResult } from '../../shared/sight-singing-results';
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
    canPublish={access.result.permissions.capabilities.operations.operations.includes('editDriveInfo')} scores={access.result.scores} />;
  return <div className="app-page">
    <TaskHeader title={t('sight.title')} backTo={`/choirs/${choirId}`} />
    <main className="page-shell settings-page challenge-page">
      {online && (identity.restoring || sessionId && access.kind === 'loading') ? <LoadingStatus>{t('sight.loading')}</LoadingStatus>
        : <p role="status">{t('sight.needMember')}</p>}
    </main>
  </div>;
}

type DriveContext = { owner: DriveCacheOwnerKey; choirId: string; sessionId: string; userId: string; canPublish: boolean; scores: ScoreSummary[] };
type SourceMode = 'saved' | 'library' | 'upload';
const versionTag = (version: number) => `V${version}`;

function QuestionLibrary({ driveName, ...props }: DriveContext & { driveName: string }) {
  const t = useMessages('practice');
  const questions = useLiveQuery(() => readQuestions(props.owner, props.choirId).catch(() => null), [props.owner, props.choirId]);
  const takes = useLiveQuery(() => readTakes(props.owner, props.choirId).catch(() => null), [props.owner, props.choirId]);
  const [published, setPublished] = useState<PublishedQuestion[] | null>();
  const [reload, setReload] = useState(0);
  const [selection, setSelection] = useState<{ question?: SightSingingQuestion; edit: boolean; shared?: boolean } | null>(null);
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
  if (selection) return <QuestionWorkspace {...props} question={selection.question} initiallyEditing={selection.edit} initiallyShared={Boolean(selection.shared)}
    onBack={() => { setSelection(null); setReload(value => value + 1); }} />;
  const privateQuestions = questions?.filter(question => !published?.some(item => item.id === question.id));
  return <div className="app-page">
    <TaskHeader title={t('sight.title')} subtitle={driveName} backTo={`/choirs/${props.choirId}`} />
    <main className="page-shell settings-page challenge-page">
      <div className="challenge-library-header"><h2>{t('sight.questions')}</h2>
        <button className="primary-button" type="button" onClick={() => setSelection({ edit: true })}><Plus size={18} aria-hidden="true" />{t('sight.create')}</button>
      </div>
      <section className="challenge-library-section"><h3>{t('sight.publishedQuestions')}</h3>
        {published === undefined ? <LoadingStatus>{t('sight.loading')}</LoadingStatus>
          : published === null ? <p role="alert">{t('sight.publishedError')} <button type="button" className="text-button" onClick={() => { setPublished(undefined); setReload(value => value + 1); }}>{t('sight.retryLoad')}</button></p>
          : <QuestionList questions={published} empty={t('sight.noPublished')} open={question => setSelection({ question, edit: false, shared: true })} />}
      </section>
      <section className="challenge-library-section"><h3>{t('sight.personalQuestions')}</h3>
        {questions === undefined ? <LoadingStatus>{t('sight.loading')}</LoadingStatus>
          : questions === null ? <p role="alert">{t('sight.storageError')}</p>
          : <QuestionList questions={privateQuestions ?? []} empty={t('sight.empty')} open={question => setSelection({ question, edit: false })} />}
      </section>
      <section className="challenge-library-section"><h3>{t('sight.history')}</h3>
        {takes === undefined ? <LoadingStatus>{t('sight.loading')}</LoadingStatus>
          : takes === null ? <p role="alert">{t('sight.storageError')}</p>
          : takes.length ? <PracticeHistory takes={takes} /> : <p className="challenge-empty">{t('sight.scoreHistoryEmpty')}</p>}
      </section>
    </main>
  </div>;
}

function QuestionList({ questions, empty, open }: { questions: SightSingingQuestion[]; empty: string; open: (question: SightSingingQuestion) => void }) {
  return questions.length ? <ul className="challenge-list">{questions.map(question => <li key={question.id}>
    <button type="button" className="challenge-question" aria-label={question.title} onClick={() => open(question)}>
      <Mic size={18} aria-hidden="true" /><span>{question.title}</span><span className="challenge-question-meta">{versionTag(question.version ?? 1)}<ChevronRight size={18} aria-hidden="true" /></span>
    </button>
  </li>)}</ul> : <p className="challenge-empty">{empty}</p>;
}

function PracticeHistory({ takes }: { takes: PracticeTake[] }) {
  const t = useMessages('practice');
  const { locale } = useAppLocale();
  const date = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });
  return <ul className="challenge-list challenge-score-list">{takes.map(take => <li key={take.id}>
    <div><strong>{take.title}</strong><small>{take.voiceName} · {versionTag(take.version)} · {t(take.published ? 'sight.scorePublishedTag' : 'sight.scorePrivateTag')}</small></div>
    <div><strong>{take.percent === null ? '—' : t('sight.takeScore', { score: take.percent })}</strong><small><time dateTime={new Date(take.at).toISOString()}>{date.format(take.at)}</time></small></div>
  </li>)}</ul>;
}

function PublishedResults({ choirId, questionId, version, generation }: { choirId: string; questionId: string; version: number; generation: number }) {
  const t = useMessages('practice');
  const [expanded, setExpanded] = useState(false);
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<{ generation: number; retry: number; rows: PublishedSightSingingResult[] | null }>();
  useEffect(() => {
    if (!expanded) return;
    const controller = new AbortController();
    void readSightSingingResults(choirId, questionId, version, controller.signal).then(rows => {
      if (!controller.signal.aborted) setState({ generation, retry, rows });
    }).catch(() => {
      if (!controller.signal.aborted) setState({ generation, retry, rows: null });
    });
    return () => controller.abort();
  }, [choirId, questionId, version, expanded, generation, retry]);
  const rows = state?.generation === generation && state.retry === retry ? state.rows : undefined;
  return <details className="challenge-published-results" onToggle={event => setExpanded(event.currentTarget.open)}>
    <summary>{t('sight.publishedResults')} <small>{versionTag(version)}</small></summary>
    {expanded && (rows === undefined ? <LoadingStatus>{t('sight.loading')}</LoadingStatus>
      : rows === null ? <p role="alert">{t('sight.publishedResultsError')} <button type="button" className="text-button" onClick={() => setRetry(value => value + 1)}>{t('sight.retryLoad')}</button></p>
      : rows.length === 0 ? <p>{t('sight.publishedResultsEmpty')}</p>
      : <ul className="challenge-list challenge-score-list">{rows.map(row => <li key={row.id}>
        <div><strong>{row.displayName}</strong><small>{row.voiceName} · {versionTag(row.version)}</small></div><strong>{t('sight.takeScore', { score: row.score })}</strong>
      </li>)}</ul>)}
  </details>;
}

function QuestionWorkspace({ owner, choirId, sessionId, userId, canPublish, scores, question, initiallyEditing, initiallyShared, onBack }: DriveContext & {
  question?: SightSingingQuestion; initiallyEditing: boolean; initiallyShared: boolean; onBack: () => void;
}) {
  const t = useMessages('practice');
  const { locale } = useAppLocale();
  const id = useId();
  const heading = useRef<HTMLSpanElement>(null);
  const [saved, setSaved] = useState(question);
  const [shared, setShared] = useState(initiallyShared);
  const [sourceMode, setSourceMode] = useState<SourceMode>(question?.snapshot ? 'saved' : 'library');
  const [upload, setUpload] = useState<{ key: string; file: File } | null>(null);
  const [invalidUpload, setInvalidUpload] = useState(false);
  const [resultGeneration, setResultGeneration] = useState(0);
  const [questionId] = useState(() => question?.id ?? crypto.randomUUID());
  const [editing, setEditing] = useState(initiallyEditing);
  useEffect(() => { heading.current?.focus(); }, [editing]);
  const [title, setTitle] = useState(question?.title ?? '');
  const [scoreId, setScoreId] = useState(question?.scoreId ?? '');
  const [fileChoice, setFileChoice] = useState(question?.attachmentId ? `${question.attachmentId}:${question.revision}` : '');
  const [voiceChoice, setVoiceChoice] = useState(question?.voice ?? '');
  const [first, setFirst] = useState(question?.first ?? 0);
  const [lastChoice, setLastChoice] = useState<number | undefined>(question?.last);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState<'local' | 'publish' | null>(null);
  const saveLifetime = useRef<AbortController | null>(null);
  const resultLifetime = useRef<AbortController | null>(null);
  useEffect(() => () => { saveLifetime.current?.abort(); resultLifetime.current?.abort(); }, []);

  const visibleSource = editing ? sourceMode : saved?.snapshot ? 'saved' : 'library';
  const candidates = useMemo(() => scores.filter(score => (score.musicXmlCount ?? score.attachmentCount ?? 0) > 0), [scores]);
  const score = visibleSource === 'library' ? candidates.find(row => row.id === scoreId) : undefined;
  const attachments = useLibraryAttachments(choirId, score ? [score] : [], Boolean(score), sessionId, owner);
  const files = attachments.items.filter(file => file.kind === 'musicxml' && !file.trashExpiresAt)
    .sort((left, right) => Number(right.source === 'generated') - Number(left.source === 'generated'));
  const fileKey = (file: (typeof files)[number]) => `${file.id}:${file.revision}`;
  const attachment = files.find(file => fileKey(file) === fileChoice) ?? (!fileChoice && files.length === 1 ? files[0] : undefined);
  const version = saved?.version ?? 1;
  let source: MelodySource | null = null;
  if (visibleSource === 'saved' && saved?.snapshot) {
    const snapshot = { choirId, questionId: saved.id, version, name: saved.snapshot.name };
    source = shared ? { kind: 'cloud', ...snapshot } : { kind: 'local', owner, ...snapshot };
  } else if (visibleSource === 'upload' && upload) source = { kind: 'upload', choirId, locale, ...upload };
  else if (visibleSource === 'library' && score && attachment) source = { kind: 'library', playback: { attachment, score, choirId, ownerKey: owner, sessionId } };
  const loaded = useMelodySource(source);
  const { bytes: loadedBytes, name: loadedName } = loaded;
  useEffect(() => {
    if (shared || !saved || saved.snapshot || editing || !loadedBytes || !loadedName) return;
    const controller = new AbortController();
    void freezeLegacyQuestion(owner, choirId, saved, loadedName, new Blob([loadedBytes]), controller.signal).catch(() => undefined);
    return () => controller.abort();
  }, [owner, choirId, saved, shared, editing, loadedBytes, loadedName]);
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
  const resetRange = () => { setVoiceChoice(''); setFirst(0); setLastChoice(undefined); setFailed(null); };
  const changeSourceMode = (mode: SourceMode) => {
    setSourceMode(mode); resetRange(); setInvalidUpload(false); setUpload(null);
    if (mode === 'saved' && saved) { setFirst(saved.first); setLastChoice(saved.last); }
  };
  const changeUpload = (file: File | null) => {
    setUpload(null); setInvalidUpload(false); resetRange();
    if (!file) return;
    if (!attachmentNameSchema.safeParse(file.name).success || attachmentFormat(file.name)?.kind !== 'musicxml'
        || file.size === 0 || file.size > SIGHT_SINGING_SCORE_MAX_BYTES) { setInvalidUpload(true); return; }
    setUpload({ key: crypto.randomUUID(), file });
  };
  const range = first === last ? visitLabel(first) : `${visitLabel(first)} – ${visitLabel(last)}`;
  const save = async (publish: boolean) => {
    if (!title.trim() || !source || !loadedBytes || !loadedName || !selected || saveLifetime.current || (publish && !canPublish)) return;
    const fields = { title: title.trim(), first, last };
    const original = source.kind === 'library'
      ? { scoreId: source.playback.score.id, attachmentId: source.playback.attachment.id, revision: source.playback.attachment.revision }
      : source.kind === 'upload' ? { scoreId: null, attachmentId: null, revision: null }
      : { scoreId: saved?.scoreId ?? null, attachmentId: saved?.attachmentId ?? null, revision: saved?.revision ?? null };
    const controller = new AbortController();
    saveLifetime.current = controller;
    const current = captureNavigationIdentity();
    setSaving(true); setFailed(null);
    try {
      let next: SightSingingQuestion;
      if (publish) {
        const headers: Record<string, string> = { ...sightSingingProtocol, 'x-same-page-owner-user-id': userId };
        const expectedEditToken = shared ? saved?.snapshot?.editToken : undefined;
        const payload = { ...fields, expectedVersion: shared ? version : null, ...(expectedEditToken && { expectedEditToken }) };
        let body: BodyInit;
        if (source.kind === 'library' || source.kind === 'cloud') {
          headers['content-type'] = 'application/json';
          body = JSON.stringify({ ...payload, ...(source.kind === 'cloud' ? { reuseSnapshot: true } : original) });
        } else {
          const form = new FormData();
          form.set('fields', JSON.stringify(payload));
          form.set('file', new Blob([loadedBytes]), loadedName);
          body = form;
        }
        const response = await diagnosticFetch(`${publishedPath(choirId)}/${questionId}`, { method: 'PUT', signal: controller.signal, headers, body });
        if (!response.ok) throw new Error('publish_question_failed');
        next = (await parseDiagnosticResponse(response, publishedQuestionResponseSchema)).question;
      } else {
        const changed = saved && (source.kind === 'upload' || original.scoreId !== saved.scoreId || original.attachmentId !== saved.attachmentId
          || original.revision !== saved.revision || first !== saved.first || last !== saved.last);
        next = { ...fields, ...original, id: questionId, version: changed ? version + 1 : version, snapshot: { name: loadedName },
          ...(saved?.voice && { voice: saved.voice }) };
        await saveQuestion(owner, choirId, next, controller.signal, new Blob([loadedBytes]));
      }
      if (!controller.signal.aborted && current()) {
        setTitle(next.title); setFirst(next.first); setLastChoice(next.last);
        setScoreId(next.scoreId ?? ''); setFileChoice(next.attachmentId ? `${next.attachmentId}:${next.revision}` : '');
        setSaved(next); setShared(publish); setSourceMode(next.snapshot ? 'saved' : 'library'); setUpload(null); setEditing(false);
      }
    } catch { if (!controller.signal.aborted && current()) setFailed(publish ? 'publish' : 'local'); }
    finally { saveLifetime.current = null; if (!controller.signal.aborted) setSaving(false); }
  };
  const canPublishResult = Boolean(shared && saved?.snapshot);
  const confirmResult = async (decision: ResultDecision) => {
    if (!saved || decision.score === null) return;
    if (resultLifetime.current) throw new Error('result_confirmation_pending');
    const controller = new AbortController(), current = captureNavigationIdentity();
    resultLifetime.current = controller;
    try {
      const published = decision.publish && canPublishResult;
      if (published) {
        await publishSightSingingResult(choirId, saved.id, userId, { id: decision.id, version, score: decision.score,
          voiceId: decision.voiceId, voiceName: decision.voiceName }, controller.signal);
      }
      controller.signal.throwIfAborted();
      if (!current()) throw new Error('result_confirmation_identity_changed');
      const history = saveTake(owner, choirId, { id: decision.id, at: Date.now(), title: saved.title, questionId: saved.id, version,
        voiceId: decision.voiceId, voiceName: decision.voiceName, published, percent: decision.score }, controller.signal);
      if (published) {
        setResultGeneration(prev => prev + 1);
        // The cloud entry is authoritative after confirmation. Local history is optional.
        await history.catch(() => undefined);
      } else await history;
    } finally { resultLifetime.current = null; }
  };
  const status = score && attachments.statusFor(score.id);
  const needsSource = visibleSource === 'library' && ((!score && Boolean(scoreId)) || (score && status === 'ready' && !attachment && Boolean(fileChoice)));
  const playable = Boolean(loaded.document && selected);
  const issue = !selected && loaded.document ? options[0]?.melody ?? 'noMelody' : null;
  const canEdit = !editing && (!shared || canPublish);
  const replace = Boolean(shared && saved?.snapshot && (sourceMode !== 'saved' || first !== saved.first || last !== saved.last));
  const badUpload = invalidUpload || (source?.kind === 'upload' && loaded.failed);
  const backingUnavailable = options.some(({ melody }) => typeof melody === 'string' && melody !== 'noMelody');
  return <div className="app-page challenge-workspace">
    <TaskHeader title={<span ref={heading} tabIndex={-1} id={`${id}-heading`}>{editing ? t(saved ? 'sight.edit' : 'sight.create') : saved?.title}</span>}
      subtitle={editing || !loaded.document ? undefined : `${range} · ${versionTag(version)}`} backTo={`/choirs/${choirId}`} onBack={onBack} backLabel={t('sight.backToQuestions')}
      actions={canEdit && <button type="button" className="icon-button" aria-label={t('sight.edit')} title={t('sight.edit')} onClick={() => { setSourceMode(saved?.snapshot ? 'saved' : 'library'); setEditing(true); }}><Pencil size={18} aria-hidden="true" /></button>} />
    <main className="page-shell challenge-page">
      {editing && <form className="challenge-form" aria-labelledby={`${id}-heading`} onSubmit={event => {
        event.preventDefault();
        const trigger = (event.nativeEvent as SubmitEvent).submitter;
        void save(shared || trigger?.getAttribute('value') === 'publish');
      }}>
        <label htmlFor={`${id}-name`}>{t('sight.name')}</label>
        <input id={`${id}-name`} name="title" value={title} onChange={event => { setTitle(event.target.value); event.target.setCustomValidity(event.target.value && !event.target.value.trim() ? t('sight.nameRequired') : ''); }} maxLength={80} disabled={saving} required />
        <label htmlFor={`${id}-source`}>{t('sight.questionSource')}</label>
        <select id={`${id}-source`} name="source" value={sourceMode} disabled={saving} onChange={event => changeSourceMode(event.target.value as SourceMode)}>
          {saved?.snapshot && <option value="saved">{t('sight.keepSnapshot')}</option>}
          <option value="library">{t('sight.chooseLibrarySource')}</option>
          <option value="upload">{t('sight.uploadSource')}</option>
        </select>
        {sourceMode === 'saved' && saved?.snapshot && <p className="challenge-source-file"><span>{t('sight.savedSource')} · {versionTag(version)}</span><strong>{saved.snapshot.name}</strong></p>}
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
        <div className="challenge-actions">
          <button type="submit" className="primary-button" disabled={saving || !playable || (shared && !canPublish)}>{t(replace ? 'sight.replacePublished' : shared ? 'sight.updatePublished' : 'sight.savePrivate')}</button>
          {!shared && canPublish && <button type="submit" value="publish" className="secondary-button" disabled={saving || !playable} aria-describedby={`${id}-publish`}>{t('sight.publish')}</button>}
        </div>
        <small>{t('sight.sourceFrozen')}</small>
        {canPublish && <small id={`${id}-publish`}>{t('sight.publishScope')}</small>}
      </form>}
      {(status === 'loading' || (source && !loaded.failed && !loaded.document)) && <LoadingStatus>{t('sight.loading')}</LoadingStatus>}
      {status === 'error' && <p role="alert" className="challenge-error">{t('sight.sourceError')} <button type="button" className="text-button" onClick={attachments.retry}>{t('sight.tryLoad')}</button></p>}
      {needsSource && <p role="alert" className="challenge-error">{t('sight.sourceChanged')}</p>}
      {loaded.failed && source?.kind !== 'upload' && <p role="alert" className="challenge-error">{t('sight.sourceError')} <button type="button" className="text-button" onClick={loaded.retry}>{t('sight.tryLoad')}</button></p>}
      {typeof issue === 'string' && <p role="alert" className="challenge-error">{t(`sight.${issue}`)}</p>}
      {failed && <p role="alert" className="challenge-error">{t(failed === 'publish' ? 'sight.publishError' : 'sight.storageError')}</p>}
      {!editing && loaded.document && selected && <ChallengeRun document={loaded.document} selected={selected} voices={voices}
        backingUnavailable={backingUnavailable} selectVoice={setVoiceChoice} visitLabel={visitLabel} questionVersion={version}
        canPublishResult={canPublishResult} onConfirm={confirmResult} />}
      {!editing && canPublishResult && saved && <PublishedResults key={`${saved.id}:${version}`}
        choirId={choirId} questionId={saved.id} version={version} generation={resultGeneration} />}
    </main>
  </div>;
}
