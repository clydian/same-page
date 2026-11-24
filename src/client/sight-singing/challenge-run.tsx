import { ChevronDown, Headphones, Mic, Minus, Play, Plus, RotateCcw, Square, UserRound, UsersRound, X, createLucideIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMessages } from '../../i18n';
import { currentSingingScoringRule, sightSingingSpeeds, type SightSingingResultSubmission } from '../../shared/sight-singing-results';
import { holdUpdate } from '../updates/update-safety';
import { beginCapture, mixPianoAnswer, playNote, type CaptureError } from './challenge-audio';
import { ChallengeNotation, type NotationNoteHit } from './challenge-notation';
import { PitchGraph } from './pitch-graph';
import { melodyAtSpeed, targetPitches, type Melody, type MelodyScore, type MelodyVoice } from './melody';
import { FeedbackTable } from './practice-feedback';
import { assessNotes, pitchName, takeScore, type PitchFrame } from './pitch-feedback';
import { createPitchTrace } from './pitch-trace';

const emptyFrames: PitchFrame[] = [];
const TuningFork = createLucideIcon('TuningFork', [['path', { d: 'M7 3v8a5 5 0 0 0 10 0V3M12 16v5', key: 'fork' }]]);
type Speed = NonNullable<SightSingingResultSubmission['speed']>;
export type ResultSave = 'published' | 'previous' | 'local';
export type VoiceOption = { voice: MelodyVoice; melody: Melody; label: string };
export type ScoredTake = SightSingingResultSubmission & { speed: Speed; scoringRule: typeof currentSingingScoringRule };
type Review = ReturnType<typeof assessNotes>;
type Answer = { status: 'preparing' } | { status: 'ready'; url: string } | { status: 'failed'; recording: Blob };
type RunState = { phase: 'idle' | 'permission' }
  | { phase: 'count'; count: number }
  | { phase: 'sing'; frame: PitchFrame; frames: PitchFrame[] }
  | { phase: 'result'; id: string; frames: PitchFrame[]; review: Review; score: ReturnType<typeof takeScore>; answer: Answer; save: ResultSave | 'saving' | 'failed' | 'unscored' };

export function ChallengeRun({ document, selected, voices, backingUnavailable, selectVoice, visitLabel, questionVersion, canPublishResult, onScored }: {
  document: MelodyScore; selected: VoiceOption; voices: VoiceOption[]; backingUnavailable: boolean;
  selectVoice: (id: string) => void; visitLabel: (index: number) => string; questionVersion: number;
  canPublishResult: boolean; onScored: (take: ScoredTake) => Promise<ResultSave>;
}) {
  const t = useMessages('practice');
  const { voice } = selected;
  const [speed, setSpeed] = useState<Speed>(1);
  const speedIndex = sightSingingSpeeds.indexOf(speed);
  const melody = useMemo(() => melodyAtSpeed(selected.melody, speed), [selected.melody, speed]);
  const [drone, setDrone] = useState(false);
  const [backing, setBacking] = useState(false);
  const otherVoices = voices.filter(option => option.voice.id !== voice.id);
  const accompaniment = backing && !backingUnavailable ? otherVoices : [];
  const [state, setState] = useState<RunState>({ phase: 'idle' });
  const [headphones, setHeadphones] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [replayTime, setReplayTime] = useState(0);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [graphOpen, setGraphOpen] = useState(false);
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
      const octaves = new Map<number, number>();
      for (const row of review) if (row.octave !== null && row.status !== 'wrongNote') {
        octaves.set(row.octave, (octaves.get(row.octave) ?? 0) + 1);
      }
      const sungOctave = [...octaves].sort((a, b) => b[1] - a[1] || Math.abs(a[0]) - Math.abs(b[0]))[0]?.[0] ?? 0;
      const notes = review.map(row => ({ ...row.note,
        midi: (row.target ?? row.note.midi) + 12 * (row.octave ?? sungOctave),
        chord: row.target === null ? row.note.chord?.map(midi => midi + 12 * sungOctave) : undefined,
      }));
      const mixed = await mixPianoAnswer(recording, notes);
      if (take.current !== takeId) return;
      const url = URL.createObjectURL(mixed);
      mixedUrl.current = url;
      update({ status: 'ready', url });
    } catch {
      if (take.current === takeId) update({ status: 'failed', recording });
    }
  };

  const saveResult = async (id: string, score: number) => {
    const update = (save: ResultSave | 'failed' | 'saving') =>
      setState(current => current.phase === 'result' && current.id === id ? { ...current, save } : current);
    update('saving');
    try {
      update(await onScored({ id, score, speed, scoringRule: currentSingingScoringRule,
        version: questionVersion, voiceId: voice.id, voiceName: selected.label }));
    } catch {
      update('failed');
    }
  };

  const start = () => {
    discard(); setPlaying(false); setReplayTime(0); setError(null); setHeadphones(false);
    setDetailsOpen(false); setGraphOpen(false);
    setState({ phase: 'permission' });
    const takeId = crypto.randomUUID();
    take.current = takeId;
    const releaseUpdate = holdUpdate();
    const trace = createPitchTrace();
    const stop = beginCapture(melody, {
      onCount: count => setState({ phase: 'count', count }),
      onFrame: frame => {
        setState({ phase: 'sing', frame: trace.append(frame), frames: trace.frames });
      },
      onComplete: (result, recording) => {
        release();
        const review = assessNotes(melody.notes, result), score = takeScore(review);
        setState({ phase: 'result', id: takeId, frames: trace.frames, review, score,
          answer: { status: 'preparing' }, save: score.percent === null ? 'unscored' : 'saving' });
        if (score.percent !== null) void saveResult(takeId, score.percent);
        void prepareAnswer(takeId, recording, review);
      },
      onError: reason => { releaseUpdate(); discard(); setError(reason); setState({ phase: 'idle' }); },
    }, drone || accompaniment.length ? { drone, others: accompaniment.map(option => melodyAtSpeed(option.melody, speed).notes) } : undefined);
    run.current = () => { stop(); releaseUpdate(); };
  };
  const reset = () => {
    discard(); setPlaying(false); setReplayTime(0); setError(null); setHeadphones(false);
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

  const playMeasure = useCallback((index: number) => {
    const visit = measure.visit;
    const bar = melody.measures.filter(candidate => candidate.bar === index).reduce<(typeof melody.measures)[number] | undefined>(
      (closest, candidate) => !closest || Math.abs(candidate.visit - visit) < Math.abs(closest.visit - visit) ? candidate : closest, undefined);
    if (bar) playFrom(bar.start);
  }, [measure.visit, melody, playFrom]);
  const selectNote = useCallback((hit: NotationNoteHit) => {
    if (state.phase === 'result') { playMeasure(hit.bar); return; }
    if (state.phase !== 'idle') return;
    release(); setError(null);
    try {
      run.current = playNote(hit.midi, failed => {
        run.current = null;
        if (failed) setError('audioFailure');
      });
    } catch { setError('audioFailure'); }
  }, [playMeasure, release, state.phase]);

  const bpm = melody.tempoMarks.reduce((tempo, mark) => mark.start <= position ? mark.bpm : tempo, melody.tempo.bpm * speed);
  const positioned = state.phase === 'sing' || state.phase === 'result' && (playing || replayTime > 0);
  const canTap = state.phase === 'idle' || (state.phase === 'result' && state.answer.status === 'ready');

  return <div className="challenge-run" data-phase={state.phase} data-replaying={playing}>
    <ChallengeNotation score={document.score} voice={voice} melody={melody} currentBar={positioned ? measure.bar : undefined} bpm={Number(bpm.toFixed(1))}
      currentVisit={measure.visit} feedback={feedback}
      onNote={canTap ? selectNote : undefined} onMeasure={state.phase === 'result' && canTap ? playMeasure : undefined}
      pitchFrames={'frames' in state ? state.frames : undefined}
      liveTrace={state.phase === 'sing' || playing} traceThrough={state.phase === 'result' ? replayTime : undefined} />

    {state.phase === 'idle' && <div className="challenge-setup">
      {headphones && <div className="challenge-headphones">
        <span role="status"><Headphones size={17} aria-hidden="true" />{t('sight.audioGuidance')}</span>
        <button type="button" className="text-button" aria-label={t('sight.dismissAudioHint')} onClick={() => setHeadphones(false)}>
          <X size={17} aria-hidden="true" />
        </button>
      </div>}
      <div className="challenge-practice-controls">
        <label className="challenge-part-control challenge-option">
          <UserRound size={18} aria-hidden="true" />
          <span>{selected.label}</span><ChevronDown size={16} aria-hidden="true" />
          <select aria-label={t('sight.singVoice')} value={voice.id} onChange={event => { release(); selectVoice(event.target.value); }}>
            {voices.map(option => <option key={option.voice.id} value={option.voice.id}>{option.label}</option>)}
          </select>
        </label>
        <div className="challenge-speed challenge-option" role="group" aria-label={t('playbackSpeed')}>
          <button type="button" aria-label={t('decreaseSpeed')} disabled={speedIndex === 0} onClick={() => setSpeed(sightSingingSpeeds[speedIndex - 1])}>
            <Minus size={18} aria-hidden="true" />
          </button>
          <output aria-label={t('playbackSpeed')}>{speed.toFixed(2)}×</output>
          <button type="button" aria-label={t('increaseSpeed')} disabled={speedIndex === sightSingingSpeeds.length - 1} onClick={() => setSpeed(sightSingingSpeeds[speedIndex + 1])}>
            <Plus size={18} aria-hidden="true" />
          </button>
        </div>
        <button type="button" className="challenge-option" aria-pressed={drone} onClick={() => {
          setDrone(!drone); if (!drone) setHeadphones(true);
        }}><TuningFork size={18} aria-hidden="true" />{t('sight.sustainedTonic')}</button>
        <button type="button" className="challenge-option" aria-pressed={accompaniment.length > 0}
          disabled={backingUnavailable || otherVoices.length === 0} onClick={() => {
            setBacking(!backing); if (!backing) setHeadphones(true);
          }}><UsersRound size={18} aria-hidden="true" />{t('sight.ensembleBacking')}</button>
      </div>
      {backingUnavailable && <small>{t('sight.backingUnavailable')}</small>}
      {canPublishResult && <small className="challenge-auto-publish">{t('sight.autoPublish')}</small>}
      <button className="primary-button challenge-start" type="button" onClick={start}><Mic size={18} aria-hidden="true" />{t('sight.start')}</button>
    </div>}

    {recording && <div className="challenge-transport">
      <div className="challenge-stage" role="status">
        {state.phase === 'count' ? t('sight.count', { count: state.count }) : state.phase === 'permission' ? t('sight.waitingMicrophone') : t('sight.singNow')}
        {state.phase === 'count' && <div className="challenge-count" aria-hidden="true">
          {Array.from({ length: melody.beats }, (_, index) => <span key={index} data-passed={index <= melody.beats - state.count} />)}
        </div>}
      </div>
      {state.phase === 'sing' && state.frame.midi !== null && <span className="challenge-staff-current-pitch">
        {t('sight.currentPitch', { pitch: pitchName(Math.round(state.frame.midi)) })}
      </span>}
      <button className="secondary-button challenge-stop" type="button" onClick={reset}><Square size={15} aria-hidden="true" />{t('sight.stop')}</button>
    </div>}

    {state.phase === 'result' && <section className="challenge-result" aria-label={t('sight.review')}>
      <div className="challenge-score"><strong>{state.score.percent === null ? t('sight.takeComplete') : t('sight.intonationScore', { score: state.score.percent })}</strong>
        {state.score.total > 0 && <span>{t('sight.matchedNotes', { matched: state.score.matched, total: state.score.total })}</span>}
      </div>
      <div className="challenge-replay-controls">
        {state.answer.status === 'ready' && <audio ref={replay} src={state.answer.url} preload="auto"
          onPlay={() => setPlaying(true)} onPause={event => { setPlaying(false); setReplayTime(event.currentTarget.currentTime); }}
          onTimeUpdate={event => setReplayTime(event.currentTarget.currentTime)} onEnded={() => setPlaying(false)} onError={() => setError('audioFailure')} />}
        <button className="primary-button challenge-review-play" type="button" disabled={state.answer.status === 'preparing'} onClick={() => {
          if (state.answer.status === 'failed') void prepareAnswer(state.id, state.answer.recording, state.review);
          else if (playing) replay.current?.pause();
          else playFrom();
        }}>{playing ? <Square size={18} aria-hidden="true" /> : <Play size={18} aria-hidden="true" />}
          {t(state.answer.status === 'preparing' ? 'sight.mixingAnswer' : playing ? 'sight.stopReplay' : 'sight.replayMix')}
        </button>
        <button className="secondary-button challenge-stop" type="button" onClick={reset}><RotateCcw size={17} aria-hidden="true" />{t('sight.retry')}</button>
      </div>
      {state.save !== 'unscored' && <p className="challenge-save-status" role={state.save === 'failed' ? 'alert' : 'status'}>
        {t(`sight.resultSave.${state.save}`)}
        {state.save === 'failed' && state.score.percent !== null && <button type="button" className="text-button" onClick={() => {
          if (state.score.percent !== null) void saveResult(state.id, state.score.percent);
        }}>{t('sight.retryLoad')}</button>}
      </p>}
    </section>}

    {error && <p className="challenge-error" role="alert">{t(`sight.${error}`)}</p>}
    {(state.phase === 'count' || state.phase === 'sing' || state.phase === 'result') && <details className="challenge-pitch-details"
      open={graphOpen} onToggle={event => setGraphOpen(event.currentTarget.open)}>
      <summary>{t('sight.pitchMonitor')}</summary>
      {graphOpen && <PitchGraph melody={melody} frames={'frames' in state ? state.frames : emptyFrames} elapsed={position}
        following={recording || playing} reviewing={state.phase === 'result'} activeTarget={target ? targetPitches(target).map(pitchName).join(' / ') : undefined} />}
    </details>}

    {state.phase === 'result' && <details className="challenge-review-details" onToggle={event => setDetailsOpen(event.currentTarget.open)}>
      <summary>{t('sight.noteFeedback')}</summary>
      {detailsOpen && reviewNotes && <FeedbackTable notes={reviewNotes} active={activeFeedback}
        onPlay={state.answer.status === 'ready' ? index => playFrom(state.review[index].note.start) : undefined} />}
    </details>}
  </div>;
}
