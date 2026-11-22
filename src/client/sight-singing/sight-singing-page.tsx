import { useLiveQuery } from 'dexie-react-hooks';
import { ChevronRight, Mic, Plus } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMessages } from '../../i18n';
import type { ScoreSummary } from '../../shared/scores';
import { useApplicationIdentity } from '../auth/application-identity';
import { LoadingStatus } from '../components/loading-status';
import { TaskHeader } from '../components/task-header';
import { useNetworkStatus } from '../platform/use-network-status';
import { useLibraryAttachments } from '../score-library/attachments/use-library-attachments';
import { driveCacheOwnerKey, type DriveCacheOwnerKey } from '../score-library/drive-library-cache';
import { useDriveLibraryResource } from '../score-library/use-drive-library';
import { captureNavigationIdentity } from '../settings/navigation-events';
import { ChallengeRun } from './challenge-run';
import { buildMelody } from './melody';
import { readQuestions, saveQuestion, type SightSingingQuestion } from './questions';
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
  const allowed = online && Boolean(sessionId) && access.kind === 'opened' && access.isMember && !access.local && !access.choir.isPreviewEntry;
  return <div className="app-page">
    <TaskHeader title={t('sight.title')} subtitle={allowed ? access.choir.name : undefined} backTo={`/choirs/${choirId}`} />
    <main className="page-shell settings-page challenge-page">
      {allowed && sessionId ? <QuestionLibrary key={JSON.stringify([owner, choirId, sessionId])} owner={owner} choirId={choirId} sessionId={sessionId} scores={access.result.scores} />
        : online && (identity.restoring || sessionId && access.kind === 'loading') ? <LoadingStatus>{t('sight.loading')}</LoadingStatus>
        : <p role="status">{t('sight.needMember')}</p>}
    </main>
  </div>;
}

type DriveContext = { owner: DriveCacheOwnerKey; choirId: string; sessionId: string; scores: ScoreSummary[] };
function QuestionLibrary(props: DriveContext) {
  const t = useMessages('practice');
  const questions = useLiveQuery(() => readQuestions(props.owner, props.choirId).catch(() => null), [props.owner, props.choirId]);
  const [selection, setSelection] = useState<{ question?: SightSingingQuestion; edit: boolean } | null>(null);
  if (selection) return <QuestionWorkspace {...props} question={selection.question} initiallyEditing={selection.edit} onBack={() => setSelection(null)} />;
  return <>
    <div className="challenge-library-header"><div><h2>{t('sight.personalQuestions')}</h2><p>{t('sight.localQuestions')}</p></div>
      <button className="primary-button" type="button" onClick={() => setSelection({ edit: true })}><Plus size={18} aria-hidden="true" />{t('sight.create')}</button>
    </div>
    {questions === undefined ? <LoadingStatus>{t('sight.loading')}</LoadingStatus>
      : questions === null ? <p role="alert">{t('sight.storageError')}</p>
      : questions.length === 0 ? <p className="challenge-empty">{t('sight.empty')}</p>
      : <ul className="challenge-list">{questions.map(question => <li key={question.id}>
        <button type="button" className="challenge-question" onClick={() => setSelection({ question, edit: false })}>
          <Mic size={18} aria-hidden="true" /><span>{question.title}</span><ChevronRight size={18} aria-hidden="true" />
        </button>
      </li>)}</ul>}
  </>;
}

function QuestionWorkspace({ owner, choirId, sessionId, scores, question, initiallyEditing, onBack }: DriveContext & {
  question?: SightSingingQuestion; initiallyEditing: boolean; onBack: () => void;
}) {
  const t = useMessages('practice');
  const id = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const [saved, setSaved] = useState(question);
  const [editing, setEditing] = useState(initiallyEditing);
  useEffect(() => { heading.current?.focus(); }, [editing]);
  const [title, setTitle] = useState(question?.title ?? '');
  const [scoreId, setScoreId] = useState(question?.scoreId ?? '');
  const [fileChoice, setFileChoice] = useState(question ? `${question.attachmentId}:${question.revision}` : '');
  const [voiceChoice, setVoiceChoice] = useState(question?.voice ?? '');
  const [first, setFirst] = useState(question?.first ?? 0);
  const [lastChoice, setLastChoice] = useState<number | undefined>(question?.last);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
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
  const voice = loaded.document?.voices.find(row => row.id === voiceChoice) ?? (!voiceChoice && loaded.document?.voices.length === 1 ? loaded.document.voices[0] : undefined);
  const last = lastChoice ?? (loaded.document?.visits.length ?? 1) - 1;
  const melody = useMemo(() => loaded.document && voice ? buildMelody(loaded.document, voice, first, last) : null, [loaded.document, voice, first, last]);
  const visitLabel = (index: number) => {
    const visit = loaded.document?.visits[index];
    return visit?.visit ? t('sight.measureVisit', { measure: visit.number, visit: visit.visit }) : t('sight.measureNumber', { measure: visit?.number ?? index + 1 });
  };
  const resetRange = () => { setVoiceChoice(''); setFirst(0); setLastChoice(undefined); setFailed(false); };
  const save = async () => {
    if (!title.trim() || !attachment || !score || !voice || !melody || typeof melody === 'string' || saveLifetime.current) return;
    const next = { id: saved?.id ?? crypto.randomUUID(), title: title.trim(), scoreId: score.id, attachmentId: attachment.id, revision: attachment.revision, voice: voice.id, first, last };
    const controller = new AbortController();
    saveLifetime.current = controller;
    const current = captureNavigationIdentity();
    setSaving(true); setFailed(false);
    try {
      await saveQuestion(owner, choirId, next, controller.signal);
      if (!controller.signal.aborted && current()) { setSaved(next); setEditing(false); }
    } catch { if (!controller.signal.aborted && current()) setFailed(true); }
    finally { saveLifetime.current = null; if (!controller.signal.aborted) setSaving(false); }
  };
  const status = score && attachments.statusFor(score.id);
  const needsSource = (!score && Boolean(scoreId)) || (score && status === 'ready' && !attachment && Boolean(fileChoice));
  const playable = melody && typeof melody !== 'string' && loaded.document && voice;
  return <>
    <div className="challenge-workspace-header">
      <button className="text-button" type="button" onClick={onBack}>{t('sight.backToQuestions')}</button>
      <h2 ref={heading} tabIndex={-1} id={`${id}-heading`}>{editing ? t(saved ? 'sight.edit' : 'sight.create') : saved?.title}</h2>
      {!editing && <button type="button" className="secondary-button" onClick={() => setEditing(true)}>{t('sight.edit')}</button>}
    </div>
    {editing && <form className="challenge-form" aria-labelledby={`${id}-heading`} onSubmit={event => { event.preventDefault(); void save(); }}>
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
        <label htmlFor={`${id}-voice`}>{t('sight.voice')}</label>
        <select id={`${id}-voice`} name="voice" value={voice?.id ?? ''} required onChange={event => setVoiceChoice(event.target.value)}>
          <option value="">{t(loaded.document.voices.length ? 'sight.chooseVoice' : 'sight.noMelody')}</option>
          {loaded.document.voices.map(item => <option key={item.id} value={item.id}>{item.multiple ? t('sight.voiceDetail', { name: item.name || t('sight.part', { number: item.track + 1 }), staff: item.staff + 1, voice: item.voice + 1 }) : item.name || t('sight.part', { number: item.track + 1 })}</option>)}
        </select>
        <div className="challenge-range">
          <div><label htmlFor={`${id}-first`}>{t('sight.first')}</label><select id={`${id}-first`} name="first" value={first} onChange={event => { const next = Number(event.target.value); setFirst(next); if (next > last) setLastChoice(next); }}>
            {loaded.document.visits.map((_, index) => <option key={index} value={index}>{visitLabel(index)}</option>)}
          </select></div>
          <div><label htmlFor={`${id}-last`}>{t('sight.last')}</label><select id={`${id}-last`} name="last" value={last} onChange={event => setLastChoice(Number(event.target.value))}>
            {loaded.document.visits.map((_, index) => index >= first && <option key={index} value={index}>{visitLabel(index)}</option>)}
          </select></div>
        </div>
      </>}
      <div className="challenge-actions"><button type="submit" className="primary-button" disabled={saving || !playable}>{t('sight.save')}</button></div>
    </form>}
    {(status === 'loading' || (source && !loaded.failed && !loaded.document)) && <LoadingStatus>{t('sight.loading')}</LoadingStatus>}
    {status === 'error' && <p role="alert" className="challenge-error">{t('sight.sourceError')} <button type="button" className="text-button" onClick={attachments.retry}>{t('sight.tryLoad')}</button></p>}
    {(needsSource || (!editing && loaded.document && !voice)) && <p role="alert" className="challenge-error">{t('sight.sourceChanged')}</p>}
    {loaded.failed && <p role="alert" className="challenge-error">{t('sight.sourceError')} <button type="button" className="text-button" onClick={loaded.retry}>{t('sight.tryLoad')}</button></p>}
    {typeof melody === 'string' && <p role="alert" className="challenge-error">{t(`sight.${melody}`)}</p>}
    {failed && <p role="alert" className="challenge-error">{t('sight.storageError')}</p>}
    {!editing && playable && loaded.document && voice && typeof melody === 'object' && melody && <>
      <p className="challenge-source">{voice.multiple ? t('sight.voiceDetail', { name: voice.name || t('sight.part', { number: voice.track + 1 }), staff: voice.staff + 1, voice: voice.voice + 1 }) : voice.name || t('sight.part', { number: voice.track + 1 })} · {visitLabel(first)} – {visitLabel(last)}</p>
      <p className="challenge-privacy">{t('sight.recordingPrivacy')}</p>
      <ChallengeRun document={loaded.document} voice={voice} melody={melody} visitLabel={visitLabel} />
    </>}
  </>;
}
