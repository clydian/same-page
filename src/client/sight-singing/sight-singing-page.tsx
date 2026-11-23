import { useLiveQuery } from 'dexie-react-hooks';
import { ChevronRight, Mic, Plus } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useAppLocale, useMessages } from '../../i18n';
import type { ScoreSummary } from '../../shared/scores';
import { publishedQuestionResponseSchema, publishedQuestionsSchema, type PublishedQuestion } from '../../shared/sight-singing';
import { diagnosticFetch, parseDiagnosticResponse } from '../diagnostics/diagnostics';
import { useApplicationIdentity } from '../auth/application-identity';
import { LoadingStatus } from '../components/loading-status';
import { TaskHeader } from '../components/task-header';
import { useNetworkStatus } from '../platform/use-network-status';
import { useLibraryAttachments } from '../score-library/attachments/use-library-attachments';
import { driveCacheOwnerKey, type DriveCacheOwnerKey } from '../score-library/drive-library-cache';
import { useDriveLibraryResource } from '../score-library/use-drive-library';
import { captureNavigationIdentity } from '../settings/navigation-events';
import { ChallengeRun, type TakeFeedback, type VoiceOption } from './challenge-run';
import { buildMelody } from './melody';
import { readQuestions, saveQuestion, type SightSingingQuestion } from './questions';
import { FeedbackTable } from './practice-feedback';
import { readTakes, saveTake, type PracticeTake } from './practice-history';
import { useMelodySource } from './use-melody-source';
import './sight-singing.css';

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
  return <div className="app-page">
    <TaskHeader title={t('sight.title')} subtitle={allowed ? access.choir.name : undefined} backTo={`/choirs/${choirId}`} />
    <main className="page-shell settings-page challenge-page">
      {allowed && sessionId && userId ? <QuestionLibrary key={JSON.stringify([owner, choirId, sessionId])} owner={owner} choirId={choirId} sessionId={sessionId}
        userId={userId} canPublish={access.result.permissions.capabilities.operations.operations.includes('editDriveInfo')} scores={access.result.scores} />
        : online && (identity.restoring || sessionId && access.kind === 'loading') ? <LoadingStatus>{t('sight.loading')}</LoadingStatus>
        : <p role="status">{t('sight.needMember')}</p>}
    </main>
  </div>;
}

type DriveContext = { owner: DriveCacheOwnerKey; choirId: string; sessionId: string; userId: string; canPublish: boolean; scores: ScoreSummary[] };
const publishedPath = (drive: string) => `/api/choirs/${encodeURIComponent(drive)}/sight-singing/questions`;

function QuestionLibrary(props: DriveContext) {
  const t = useMessages('practice');
  const questions = useLiveQuery(() => readQuestions(props.owner, props.choirId).catch(() => null), [props.owner, props.choirId]);
  const takes = useLiveQuery(() => readTakes(props.owner, props.choirId).catch(() => null), [props.owner, props.choirId]);
  const [published, setPublished] = useState<PublishedQuestion[] | null>();
  const [reload, setReload] = useState(0);
  const [selection, setSelection] = useState<{ question?: SightSingingQuestion; edit: boolean } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void diagnosticFetch(publishedPath(props.choirId), { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error('questions_unavailable');
      const payload = await parseDiagnosticResponse(response, publishedQuestionsSchema);
      if (!controller.signal.aborted) setPublished(payload.questions);
    }).catch(() => { if (!controller.signal.aborted) setPublished(null); });
    return () => controller.abort();
  }, [props.choirId, reload]);
  if (selection) return <QuestionWorkspace {...props} question={selection.question} initiallyEditing={selection.edit}
    onBack={() => { setSelection(null); setReload(value => value + 1); }} />;
  const privateQuestions = questions?.filter(question => !published?.some(item => item.id === question.id));
  return <>
    <div className="challenge-library-header"><h2>{t('sight.questions')}</h2>
      <button className="primary-button" type="button" onClick={() => setSelection({ edit: true })}><Plus size={18} aria-hidden="true" />{t('sight.create')}</button>
    </div>
    <section className="challenge-library-section"><h3>{t('sight.publishedQuestions')}</h3>
      {published === undefined ? <LoadingStatus>{t('sight.loading')}</LoadingStatus>
        : published === null ? <p role="alert">{t('sight.publishedError')} <button type="button" className="text-button" onClick={() => { setPublished(undefined); setReload(value => value + 1); }}>{t('sight.retryLoad')}</button></p>
        : <QuestionList questions={published} empty={t('sight.noPublished')} open={question => setSelection({ question, edit: false })} />}
    </section>
    <section className="challenge-library-section"><h3>{t('sight.personalQuestions')}</h3>
      {questions === undefined ? <LoadingStatus>{t('sight.loading')}</LoadingStatus>
        : questions === null ? <p role="alert">{t('sight.storageError')}</p>
        : <QuestionList questions={privateQuestions ?? []} empty={t('sight.empty')} open={question => setSelection({ question, edit: false })} />}
    </section>
    <section className="challenge-library-section"><h3>{t('sight.history')}</h3>
      {takes === undefined ? <LoadingStatus>{t('sight.loading')}</LoadingStatus>
        : takes === null ? <p role="alert">{t('sight.storageError')}</p>
        : takes.length ? <PracticeHistory takes={takes} /> : <p className="challenge-empty">{t('sight.noHistory')}</p>}
    </section>
  </>;
}

function QuestionList({ questions, empty, open }: { questions: SightSingingQuestion[]; empty: string; open: (question: SightSingingQuestion) => void }) {
  return questions.length ? <ul className="challenge-list">{questions.map(question => <li key={question.id}>
    <button type="button" className="challenge-question" onClick={() => open(question)}>
      <Mic size={18} aria-hidden="true" /><span>{question.title}</span><ChevronRight size={18} aria-hidden="true" />
    </button>
  </li>)}</ul> : <p className="challenge-empty">{empty}</p>;
}

function PracticeHistory({ takes }: { takes: PracticeTake[] }) {
  const t = useMessages('practice');
  const { locale } = useAppLocale();
  const date = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });
  return <ul className="challenge-list challenge-history">{takes.map(take => <li key={take.id}><details>
    <summary><strong>{take.title}</strong><span>{take.voiceName}</span><span>{take.percent === null ? '—' : t('sight.takeScore', { score: take.percent })}</span></summary>
    <div className="challenge-history-detail">
      <p><time dateTime={new Date(take.at).toISOString()}>{date.format(take.at)}</time> · {take.range}{take.version !== null && <> · {t('sight.questionVersion', { version: take.version })}</>}</p>
      {(take.drone || take.accompaniment.length > 0) && <p>{[...(take.drone ? [t('sight.droneUsed')] : []), ...take.accompaniment].join(' · ')}</p>}
      {take.total > 0 && <p>{t('sight.summary', { matched: take.matched, total: take.total })}</p>}
      {take.total < take.notes.length && <p>{t('sight.unscoredCount', { count: take.notes.length - take.total })}</p>}
      <FeedbackTable notes={take.notes} />
    </div>
  </details></li>)}</ul>;
}

function QuestionWorkspace({ owner, choirId, sessionId, userId, canPublish, scores, question, initiallyEditing, onBack }: DriveContext & {
  question?: SightSingingQuestion; initiallyEditing: boolean; onBack: () => void;
}) {
  const t = useMessages('practice');
  const id = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const [saved, setSaved] = useState(question);
  const [questionId] = useState(() => question?.id ?? crypto.randomUUID());
  const [editing, setEditing] = useState(initiallyEditing);
  useEffect(() => { heading.current?.focus(); }, [editing]);
  const [title, setTitle] = useState(question?.title ?? '');
  const [scoreId, setScoreId] = useState(question?.scoreId ?? '');
  const [fileChoice, setFileChoice] = useState(question ? `${question.attachmentId}:${question.revision}` : '');
  const [voiceChoice, setVoiceChoice] = useState(question?.voice ?? '');
  const [first, setFirst] = useState(question?.first ?? 0);
  const [lastChoice, setLastChoice] = useState<number | undefined>(question?.last);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState<'local' | 'publish' | null>(null);
  const saveLifetime = useRef<AbortController | null>(null);
  useEffect(() => () => saveLifetime.current?.abort(), []);

  const candidates = scores.filter(score => (score.musicXmlCount ?? score.attachmentCount ?? 0) > 0);
  const score = candidates.find(row => row.id === scoreId);
  const attachments = useLibraryAttachments(choirId, score ? [score] : [], Boolean(score), sessionId, owner);
  const files = attachments.items.filter(file => file.kind === 'musicxml' && !file.trashExpiresAt)
    .sort((left, right) => Number(right.source === 'generated') - Number(left.source === 'generated'));
  const fileKey = (file: (typeof files)[number]) => `${file.id}:${file.revision}`;
  const attachment = files.find(file => fileKey(file) === fileChoice) ?? (!fileChoice && files.length === 1 ? files[0] : undefined);
  const source = score && attachment ? { attachment, score, choirId, ownerKey: owner, sessionId } : null;
  const loaded = useMelodySource(source);
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
  const range = first === last ? visitLabel(first) : `${visitLabel(first)} – ${visitLabel(last)}`;
  const save = async (publish: boolean) => {
    if (!title.trim() || !attachment || !score || !selected || saveLifetime.current || (publish && !canPublish)) return;
    const fields = { title: title.trim(), scoreId: score.id, attachmentId: attachment.id, revision: attachment.revision, first, last };
    const controller = new AbortController();
    saveLifetime.current = controller;
    const current = captureNavigationIdentity();
    setSaving(true); setFailed(null);
    try {
      let next: SightSingingQuestion;
      if (publish) {
        const response = await diagnosticFetch(`${publishedPath(choirId)}/${questionId}`, {
          method: 'PUT', signal: controller.signal,
          headers: { 'content-type': 'application/json', 'x-same-page-owner-user-id': userId },
          body: JSON.stringify({ ...fields, expectedVersion: saved?.version ?? null }),
        });
        if (!response.ok) throw new Error('publish_question_failed');
        next = (await parseDiagnosticResponse(response, publishedQuestionResponseSchema)).question;
      } else {
        next = { ...fields, id: questionId, ...(saved?.voice && { voice: saved.voice }) };
        await saveQuestion(owner, choirId, next, controller.signal);
      }
      if (!controller.signal.aborted && current()) {
        setSaved(next); setEditing(false);
      }
    } catch { if (!controller.signal.aborted && current()) setFailed(publish ? 'publish' : 'local'); }
    finally { saveLifetime.current = null; if (!controller.signal.aborted) setSaving(false); }
  };
  const recordTake = (take: TakeFeedback) => {
    if (!saved) return Promise.reject(new Error('question_not_saved'));
    return saveTake(owner, choirId, { ...take, id: crypto.randomUUID(), at: Date.now(), title: saved.title,
      questionId: saved.id, version: saved.version ?? null, scoreId: saved.scoreId, attachmentId: saved.attachmentId,
      revision: saved.revision, first: saved.first, last: saved.last, range });
  };
  const status = score && attachments.statusFor(score.id);
  const needsSource = (!score && Boolean(scoreId)) || (score && status === 'ready' && !attachment && Boolean(fileChoice));
  const playable = Boolean(loaded.document && selected);
  const issue = !selected && loaded.document ? options[0]?.melody ?? 'noMelody' : null;
  return <>
    <div className="challenge-workspace-header">
      <button className="text-button" type="button" onClick={onBack}>{t('sight.backToQuestions')}</button>
      <h2 ref={heading} tabIndex={-1} id={`${id}-heading`}>{editing ? t(saved ? 'sight.edit' : 'sight.create') : saved?.title}</h2>
      {!editing && (!saved?.version || canPublish) && <button type="button" className="secondary-button" onClick={() => setEditing(true)}>{t('sight.edit')}</button>}
    </div>
    {editing && <form className="challenge-form" aria-labelledby={`${id}-heading`} onSubmit={event => {
      event.preventDefault();
      const trigger = (event.nativeEvent as SubmitEvent).submitter;
      void save(Boolean(saved?.version) || trigger?.getAttribute('value') === 'publish');
    }}>
      <label htmlFor={`${id}-name`}>{t('sight.name')}</label>
      <input id={`${id}-name`} name="title" value={title} onChange={event => { setTitle(event.target.value); event.target.setCustomValidity(event.target.value && !event.target.value.trim() ? t('sight.nameRequired') : ''); }} maxLength={80} required />
      <label htmlFor={`${id}-score`}>{t('sight.score')}</label>
      <select id={`${id}-score`} name="score" value={score?.id ?? ''} required onChange={event => { setScoreId(event.target.value); setFileChoice(''); resetRange(); }}>
        <option value="">{t('sight.chooseScore')}</option>
        {candidates.map(item => <option key={item.id} value={item.id}>{item.fileName}</option>)}
      </select>
      {!candidates.length && <small>{t('sight.noScores')}</small>}
      {status === 'ready' && <>
        <label htmlFor={`${id}-files`}>MusicXML</label>
        <select id={`${id}-files`} name="attachment" value={attachment ? fileKey(attachment) : ''} required onChange={event => { setFileChoice(event.target.value); resetRange(); }}>
          <option value="">{t(files.length ? 'sight.chooseFile' : 'sight.noFiles')}</option>
          {files.map(file => <option key={file.id} value={fileKey(file)}>{file.source === 'generated' ? t('generatedBadge') : file.name}</option>)}
        </select>
      </>}
      {loaded.document && <>
        <div className="challenge-range">
          <div><label htmlFor={`${id}-first`}>{t('sight.first')}</label><select id={`${id}-first`} name="first" value={first} onChange={event => { const next = Number(event.target.value); setFirst(next); if (next > last) setLastChoice(next); }}>
            {loaded.document.visits.map((_, index) => <option key={index} value={index}>{visitLabel(index)}</option>)}
          </select></div>
          <div><label htmlFor={`${id}-last`}>{t('sight.last')}</label><select id={`${id}-last`} name="last" value={last} onChange={event => setLastChoice(Number(event.target.value))}>
            {loaded.document.visits.map((_, index) => index >= first && <option key={index} value={index}>{visitLabel(index)}</option>)}
          </select></div>
        </div>
      </>}
      <div className="challenge-actions">
        <button type="submit" className="primary-button" disabled={saving || !playable || Boolean(saved?.version && !canPublish)}>{t(saved?.version ? 'sight.updatePublished' : 'sight.savePrivate')}</button>
        {!saved?.version && canPublish && <button type="submit" value="publish" className="secondary-button" disabled={saving || !playable} aria-describedby={`${id}-publish`}>{t('sight.publish')}</button>}
      </div>
      {canPublish && <small id={`${id}-publish`}>{t('sight.publishScope')}</small>}
    </form>}
    {(status === 'loading' || (source && !loaded.failed && !loaded.document)) && <LoadingStatus>{t('sight.loading')}</LoadingStatus>}
    {status === 'error' && <p role="alert" className="challenge-error">{t('sight.sourceError')} <button type="button" className="text-button" onClick={attachments.retry}>{t('sight.tryLoad')}</button></p>}
    {needsSource && <p role="alert" className="challenge-error">{t('sight.sourceChanged')}</p>}
    {loaded.failed && <p role="alert" className="challenge-error">{t('sight.sourceError')} <button type="button" className="text-button" onClick={loaded.retry}>{t('sight.tryLoad')}</button></p>}
    {typeof issue === 'string' && <p role="alert" className="challenge-error">{t(`sight.${issue}`)}</p>}
    {failed && <p role="alert" className="challenge-error">{t(failed === 'publish' ? 'sight.publishError' : 'sight.storageError')}</p>}
    {!editing && loaded.document && selected && <>
      <p className="challenge-source">{range}{saved?.version && <> · {t('sight.questionVersion', { version: saved.version })}</>}</p>
      <p className="challenge-privacy">{t('sight.recordingPrivacy')}</p>
      <ChallengeRun document={loaded.document} selected={selected} voices={voices} selectVoice={setVoiceChoice} visitLabel={visitLabel} onTake={recordTake} />
    </>}
  </>;
}
