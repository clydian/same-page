import { Check, Headphones, Mic, Pause, Play, RotateCcw, Square } from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useMessages } from '../../i18n';
import { holdUpdate } from '../updates/update-safety';
import { beginCapture, mixPianoAnswer, playNote, type CaptureError } from './challenge-audio';
import { ChallengeNotation, type NotationNoteHit } from './challenge-notation';
import { PitchGraph } from './pitch-graph';
import { targetPitches, type Melody, type MelodyScore, type MelodyVoice } from './melody';
import { FeedbackTable } from './practice-feedback';
import { takeScore } from './practice-history';
import { assessNotes, pitchName, type PitchFrame } from './pitch-feedback';

const emptyFrames: PitchFrame[] = [];
export type VoiceOption = { voice: MelodyVoice; melody: Melody; label: string };
export type ResultDecision = { id: string; score: number | null; voiceId: string; voiceName: string; publish: boolean };
type Review = ReturnType<typeof assessNotes>;
type Answer = { status: 'preparing' } | { status: 'ready'; url: string } | { status: 'failed'; recording: Blob };
type RunState = { phase: 'idle' | 'permission' }
  | { phase: 'count'; count: number }
  | { phase: 'sing'; frame: PitchFrame; frames: PitchFrame[] }
  | { phase: 'result'; id: string; frames: PitchFrame[]; review: Review; score: ReturnType<typeof takeScore>; answer: Answer }
  | { phase: 'complete'; score: number | null; published: boolean };

function clock(seconds: number) {
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export function ChallengeRun({ document, selected, voices, backingUnavailable, selectVoice, visitLabel, questionVersion, canPublishResult, onConfirm }: {
  document: MelodyScore; selected: VoiceOption; voices: VoiceOption[]; backingUnavailable: boolean;
  selectVoice: (id: string) => void; visitLabel: (index: number) => string; questionVersion: number;
  canPublishResult: boolean; onConfirm: (decision: ResultDecision) => Promise<void>;
}) {
  const t = useMessages('practice');
  const id = useId();
  const { voice, melody } = selected;
  const [drone, setDrone] = useState(false);
  const [backing, setBacking] = useState(false);
  const otherVoices = voices.filter(option => option.voice.id !== voice.id);
  const accompaniment = backing && !backingUnavailable ? otherVoices : [];
  const [state, setState] = useState<RunState>({ phase: 'idle' });
  const [showAuditionHint, setAuditionHint] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [replayTime, setReplayTime] = useState(0);
  const [publish, setPublish] = useState(true);
  const [publishStarted, setPublishStarted] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [error, setError] = useState<CaptureError | null>(null);
  const take = useRef<string | null>(null);
  const run = useRef<(() => void) | null>(null);
  const mixedUrl = useRef<string | null>(null);
  const replay = useRef<HTMLAudioElement>(null);
  const release = useCallback(() => {
    const stop = run.current;
    run.current = null;
    stop?.();
    replay.current?.pause();
  }, []);
  const discard = useCallback(() => {
    take.current = null;
    release();
    if (mixedUrl.current) URL.revokeObjectURL(mixedUrl.current);
    mixedUrl.current = null;
  }, [release]);
  useEffect(() => {
    const interrupt = () => {
      if (window.document.visibilityState !== 'hidden') return;
      release();
      setState(current => current.phase === 'permission' || current.phase === 'count' || current.phase === 'sing' ? { phase: 'idle' } : current);
    };
    const pageHide = () => { discard(); setState({ phase: 'idle' }); };
    window.document.addEventListener('visibilitychange', interrupt);
    window.addEventListener('pagehide', pageHide);
    return () => {
      window.document.removeEventListener('visibilitychange', interrupt);
      window.removeEventListener('pagehide', pageHide);
      discard();
    };
  }, [discard, release]);

  useEffect(() => {
    if (!playing || state.phase !== 'result') return;
    let frame = 0, last = -1;
    const follow = () => {
      const audio = replay.current;
      if (!audio || audio.paused) return;
      if (Math.abs(audio.currentTime - last) >= .02) {
        last = audio.currentTime;
        setReplayTime(last);
      }
      frame = requestAnimationFrame(follow);
    };
    frame = requestAnimationFrame(follow);
    return () => cancelAnimationFrame(frame);
  }, [playing, state.phase]);

  const prepareAnswer = async (takeId: string, recording: Blob, review: Review) => {
    const update = (answer: Answer) => setState(current => current.phase === 'result' && current.id === takeId ? { ...current, answer } : current);
    update({ status: 'preparing' });
    try {
      const notes = review.map(row => row.target === null ? row.note : { ...row.note, midi: row.target, chord: undefined });
      const mixed = await mixPianoAnswer(recording, notes);
      if (take.current !== takeId) return;
      const url = URL.createObjectURL(mixed);
      mixedUrl.current = url;
      update({ status: 'ready', url });
    } catch {
      if (take.current === takeId) update({ status: 'failed', recording });
    }
  };

  const start = () => {
    discard(); setPlaying(false); setReplayTime(0); setError(null); setConfirmError(false); setAuditionHint(false);
    setConfirming(false); setDetailsOpen(false); setPublishStarted(false);
    setState({ phase: 'permission' });
    const takeId = crypto.randomUUID();
    take.current = takeId;
    const releaseUpdate = holdUpdate();
    const frames: PitchFrame[] = [];
    const stop = beginCapture(melody, {
      onCount: count => setState({ phase: 'count', count }),
      onFrame: frame => {
        frames.push(frame);
        setState({ phase: 'sing', frame, frames });
      },
      onComplete: (result, recording) => {
        release();
        const review = assessNotes(melody.notes, result), score = takeScore(review);
        setPublish(canPublishResult && score.percent !== null);
        setState({ phase: 'result', id: takeId, frames: result, review, score, answer: { status: 'preparing' } });
        void prepareAnswer(takeId, recording, review);
      },
      onError: reason => { releaseUpdate(); discard(); setError(reason); setState({ phase: 'idle' }); },
    }, drone || accompaniment.length ? { drone, others: accompaniment.map(option => option.melody.notes) } : undefined);
    run.current = () => { stop(); releaseUpdate(); };
  };
  const reset = () => {
    discard(); setPlaying(false); setReplayTime(0); setError(null); setConfirmError(false); setAuditionHint(false);
    setState({ phase: 'idle' });
  };
  const seek = useCallback((time: number) => {
    const audio = replay.current;
    if (!audio) return;
    audio.currentTime = time;
    setReplayTime(time);
  }, []);
  const playFrom = useCallback((time?: number) => {
    const audio = replay.current;
    if (!audio) return;
    setError(null);
    if (time !== undefined) seek(time);
    else if (audio.ended) seek(0);
    void audio.play().catch(() => setError('audioFailure'));
  }, [seek]);

  const recording = state.phase === 'permission' || state.phase === 'count' || state.phase === 'sing';
  const position = state.phase === 'sing' ? state.frame.time : state.phase === 'result' ? replayTime : 0;
  const measure = melody.measures.find(bar => position < bar.end) ?? melody.measures[melody.measures.length - 1];
  const target = melody.notes.find(note => note.start <= position && position < note.end);
  const review = state.phase === 'result' ? state.review : undefined;
  const feedback = useMemo(() => review?.flatMap(row => row.note.beatIndex === undefined ? [] : [{
    bar: row.note.bar, beatIndex: row.note.beatIndex, visit: row.note.visit, status: row.status, midi: row.target ?? undefined,
  }]), [review]);
  const reviewNotes = useMemo(() => review?.map(({ note, ...detail }) => ({ ...detail, measure: visitLabel(note.visit), targets: targetPitches(note) })), [review, visitLabel]);
  const activeFeedback = review?.findIndex(row => row.note === target) ?? -1;
  const unscored = state.phase === 'result' ? state.review.length - state.score.total : 0;

  const selectNote = useCallback((hit: NotationNoteHit) => {
    if (state.phase === 'result') {
      const position = replay.current?.currentTime ?? 0;
      const visit = melody.measures.find(bar => position < bar.end)?.visit;
      const part = voices.find(option => option.voice.track === hit.track && option.voice.staff === hit.staff && option.voice.voice === hit.voice);
      const notes = part?.melody.notes.filter(note => note.bar === hit.bar && note.beatIndex === hit.beatIndex);
      const note = notes?.find(candidate => candidate.visit === visit) ?? notes?.reduce<(typeof melody.notes)[number] | undefined>((closest, candidate) =>
        !closest || Math.abs(candidate.start - position) < Math.abs(closest.start - position) ? candidate : closest, undefined);
      const bar = melody.measures.find(candidate => candidate.bar === hit.bar && candidate.visit === visit) ?? melody.measures.find(candidate => candidate.bar === hit.bar);
      if (note || bar) playFrom(note?.start ?? bar?.start);
      return;
    }
    if (state.phase !== 'idle') return;
    release(); setError(null); setAuditionHint(true);
    try {
      run.current = playNote(hit.midi, failed => {
        run.current = null;
        if (failed) setError('audioFailure');
      });
    } catch { setError('audioFailure'); }
  }, [melody, playFrom, release, state.phase, voices]);

  const confirm = async () => {
    if (state.phase !== 'result' || confirming) return;
    const score = state.score.percent;
    const published = publish && canPublishResult && score !== null;
    const takeId = state.id;
    setConfirming(true); setConfirmError(false);
    // A lost response can leave a published score on the server. Retrying the
    // same confirmation keeps the attempt ID and publication choice intact.
    if (published) setPublishStarted(true);
    try {
      await onConfirm({ id: takeId, score, publish: published, voiceId: voice.id, voiceName: selected.label });
      if (take.current !== takeId) return;
      discard(); setPlaying(false); setReplayTime(0); setConfirming(false);
      setState({ phase: 'complete', score, published });
    } catch {
      if (take.current === takeId) setConfirmError(true);
    } finally {
      if (take.current === takeId) setConfirming(false);
    }
  };
  const showHeadphones = (state.phase === 'idle' && (showAuditionHint || drone || accompaniment.length > 0)) ||
    (recording && (drone || accompaniment.length > 0)) || (state.phase === 'result' && playing);
  const canTap = state.phase === 'idle' || (state.phase === 'result' && state.answer.status === 'ready');

  return <div className="challenge-run" data-phase={state.phase}>
    <ChallengeNotation score={document.score} voice={voice} melody={melody} currentBar={recording || state.phase === 'result' ? measure.bar : undefined}
      currentVisit={measure.visit} beatIndex={target?.bar === measure.bar ? target?.beatIndex : undefined} feedback={feedback}
      onNote={canTap ? selectNote : undefined} />

    {state.phase === 'idle' && <div className="challenge-practice-controls">
      <label className="challenge-part-control" htmlFor={`${id}-part`}><span>{t('sight.singVoice')}</span>
        <select id={`${id}-part`} value={voice.id} onChange={event => { release(); selectVoice(event.target.value); }}>
          {voices.map(option => <option key={option.voice.id} value={option.voice.id}>{option.label}</option>)}
        </select>
      </label>
      <div className="challenge-play-options">
        <label className="challenge-toggle" htmlFor={`${id}-drone`}><input id={`${id}-drone`} type="checkbox" checked={drone} onChange={event => setDrone(event.target.checked)} />
          <span>{t('sight.drone', { pitch: pitchName(melody.tonic) })}</span></label>
        {(otherVoices.length > 0 || backingUnavailable) && <label className="challenge-toggle" htmlFor={`${id}-backing`}>
          <input id={`${id}-backing`} type="checkbox" checked={accompaniment.length > 0} disabled={backingUnavailable} onChange={event => setBacking(event.target.checked)} />
          <span>{t('sight.ensembleBacking')}</span>
        </label>}
      </div>
      <button className="primary-button challenge-start" type="button" onClick={start}><Mic size={18} aria-hidden="true" />{t('sight.start')}</button>
      {backingUnavailable && <small>{t('sight.backingUnavailable')}</small>}
    </div>}

    {recording && <div className="challenge-transport">
      <div className="challenge-stage" role="status">
        {state.phase === 'count' ? t('sight.count', { count: state.count }) : state.phase === 'permission' ? t('sight.waitingMicrophone') : t('sight.singNow')}
        {state.phase === 'count' && <div className="challenge-count" aria-hidden="true">
          {Array.from({ length: melody.beats }, (_, index) => <span key={index} data-passed={index <= melody.beats - state.count} />)}
        </div>}
      </div>
      <button className="secondary-button challenge-stop" type="button" onClick={reset}><Square size={15} aria-hidden="true" />{t('sight.stop')}</button>
    </div>}

    {state.phase === 'result' && <section className="challenge-result" aria-label={t('sight.review')}>
      <div className="challenge-result-top">
        <div className="challenge-score"><strong>{state.score.percent === null ? t('sight.takeComplete') : t('sight.takeScore', { score: state.score.percent })}</strong>
          <span>{selected.label} · {t('sight.questionVersion', { version: questionVersion })}</span></div>
        <button className="secondary-button challenge-stop" type="button" onClick={reset} disabled={confirming}><RotateCcw size={17} aria-hidden="true" />{t('sight.retry')}</button>
      </div>
      {state.answer.status === 'ready' && <div className="challenge-replay-controls">
        <audio ref={replay} src={state.answer.url} preload="auto" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
          onTimeUpdate={event => setReplayTime(event.currentTarget.currentTime)} onEnded={() => setPlaying(false)} onError={() => setError('audioFailure')} />
        <button className="secondary-button challenge-review-play" type="button" aria-label={t(playing ? 'sight.pauseReplay' : 'sight.replayMix')}
          onClick={() => playing ? replay.current?.pause() : playFrom()}>{playing ? <Pause size={18} aria-hidden="true" /> : <Play size={18} aria-hidden="true" />}</button>
        <label className="challenge-replay-timeline" htmlFor={`${id}-position`}><span>{t('sight.replayMix')}</span>
          <input id={`${id}-position`} type="range" aria-label={t('sight.replayPosition')} min={0} max={melody.duration} step={.01} value={Math.min(replayTime, melody.duration)} onChange={event => seek(Number(event.target.value))} />
        </label>
        <span className="challenge-replay-time">{clock(replayTime)} / {clock(melody.duration)}</span>
      </div>}
      {state.answer.status === 'preparing' && <p role="status">{t('sight.mixingAnswer')}</p>}
      {state.answer.status === 'failed' && <button type="button" className="secondary-button"
        onClick={() => { if (state.answer.status === 'failed') void prepareAnswer(state.id, state.answer.recording, state.review); }}>{t('sight.replayMix')}</button>}
      {activeFeedback >= 0 && <div className="challenge-current-feedback">
        <span>{visitLabel(state.review[activeFeedback].note.visit)}</span><strong>{pitchName(state.review[activeFeedback].target ?? state.review[activeFeedback].note.midi)}</strong>
        <span>{t(`sight.${state.review[activeFeedback].status}`)}</span>
      </div>}
    </section>}

    {showHeadphones && <p className="challenge-headphones" role="status"><Headphones size={17} aria-hidden="true" />{t('sight.audioGuidance')}</p>}
    {error && <p className="challenge-error" role="alert">{t(`sight.${error}`)}</p>}
    {(state.phase === 'count' || state.phase === 'sing' || state.phase === 'result') && <PitchGraph melody={melody}
      frames={'frames' in state ? state.frames : emptyFrames} elapsed={position} activePitch={state.phase === 'sing' ? state.frame.midi : null}
      activeTarget={state.phase === 'sing' && target ? targetPitches(target).map(pitchName).join(' / ') : undefined} />}

    {state.phase === 'result' && <>
      <details className="challenge-review-details" onToggle={event => setDetailsOpen(event.currentTarget.open)}>
        <summary>{t('sight.noteFeedback')}{state.score.total > 0 && <span>{t('sight.summary', { matched: state.score.matched, total: state.score.total })}</span>}</summary>
        {unscored > 0 && <p>{t('sight.unscoredCount', { count: unscored })}</p>}
        {detailsOpen && reviewNotes && <FeedbackTable notes={reviewNotes} active={activeFeedback}
          onPlay={state.answer.status === 'ready' ? index => playFrom(state.review[index].note.start) : undefined} />}
      </details>
      <div className="challenge-confirm">
        <div>
          {canPublishResult && state.score.percent !== null && <label className="challenge-toggle" htmlFor={`${id}-publish`}>
            <input id={`${id}-publish`} type="checkbox" checked={publish} disabled={confirming || publishStarted} onChange={event => setPublish(event.target.checked)} />{t('sight.publishRun')}
          </label>}
          <p>{t('sight.resultOnly')}</p>
          {confirmError && <p className="challenge-error" role="alert">{t('sight.confirmScoreError')}</p>}
        </div>
        <button className="primary-button challenge-start" type="button" disabled={confirming} onClick={() => void confirm()}>
          <Check size={18} aria-hidden="true" />{t(publish && canPublishResult && state.score.percent !== null ? 'sight.confirmAndPublish' : 'sight.confirmScore')}
        </button>
      </div>
    </>}
    {state.phase === 'complete' && <div className="challenge-confirm challenge-complete">
      <div role="status"><strong>{t(state.published ? 'sight.publishedScore' : 'sight.confirmedScore')}</strong>
        <p>{state.score === null ? selected.label : `${t('sight.takeScore', { score: state.score })} · ${selected.label}`} · {t('sight.questionVersion', { version: questionVersion })}</p>
      </div>
      <button className="primary-button challenge-start" type="button" onClick={reset}><RotateCcw size={18} aria-hidden="true" />{t('sight.retry')}</button>
    </div>}
  </div>;
}
