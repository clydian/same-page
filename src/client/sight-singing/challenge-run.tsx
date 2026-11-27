import { playbackAudioSession } from '@same-page/player/playback-audio-session';
import { Check, ChevronDown, Headphones, Mic, Minus, Play, Plus, RotateCcw, Square, UserRound, UsersRound, X, createLucideIcon } from 'lucide-react';
import { useCallback, useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type Ref } from 'react';
import { useMessages } from '../../i18n';
import { sightSingingSpeeds, type SightSingingResultSubmission } from '../../shared/sight-singing-results';
import { holdUpdate } from '../updates/update-safety';
import { beginCapture, playNote, playSustainedTonic, type CaptureError } from './challenge-audio';
import type { PitchMode } from './live-pitch';
import { PitchModeSelect } from './pitch-mode-select';
import { LatencyControls } from './challenge-latency-setting';
import { ChallengeNotation, type NotationNoteHit } from './challenge-notation';
import { useSightSingingScoreFormat } from './format-score';
import { PitchGraph } from './pitch-graph';
import { melodyAtSpeed, targetPitches, type Melody, type MelodyScore, type MelodyVoice } from './melody';
import { assessNotes, pitchName, takeScore, type PitchFrame } from './pitch-feedback';
import { ScoreBadges } from './score-badge';
import { useChallengeAnswer } from './use-challenge-answer';
import type { ChallengeMix } from './use-challenge-mix';

const emptyFrames: PitchFrame[] = [];
const TuningFork = createLucideIcon('TuningFork', [['path', { d: 'M7 3v8a5 5 0 0 0 10 0V3M12 16v5', key: 'fork' }]]);
type Speed = SightSingingResultSubmission['speed'];
export type ChallengeResult = { finish: () => void };
export type VoiceOption = { voice: MelodyVoice; melody: Melody; label: string };
type RunState = { phase: 'idle' | 'permission' }
  | { phase: 'count'; count: number }
  | { phase: 'sing'; frame: PitchFrame; frames: PitchFrame[] }
  | { phase: 'result'; id: string; frames: PitchFrame[]; mode: PitchMode; captureLatency: number; recording: Blob };

function reviewRecording(melody: Melody, take: Extract<RunState, { phase: 'result' }>, latency: number) {
  const shift = (latency - take.captureLatency) / 1000;
  const frames = take.frames.flatMap(frame => {
    const time = frame.time - shift;
    return time >= melody.leadIn && time <= melody.duration ? [{ time, midi: frame.midi }] : [];
  });
  const review = assessNotes(melody.notes.filter(note => note.start >= melody.leadIn), frames);
  return { frames, review, score: takeScore(review) };
}

export function ChallengeRun({ document, selected, voices, backingUnavailable, selectVoice, questionVersion, pitchTraceEnabled, mix, onScored, onAudioBusy, measuring, onMeasure, onLatency, ref }: {
  document: MelodyScore; selected: VoiceOption; voices: VoiceOption[]; backingUnavailable: boolean;
  selectVoice: (id: string) => void; questionVersion: number;
  pitchTraceEnabled: boolean; mix: ChallengeMix; onAudioBusy: (busy: boolean) => void; measuring: boolean;
  onMeasure: (busy: boolean) => void; onLatency: (value: number) => void; onScored: (take: SightSingingResultSubmission) => void; ref: Ref<ChallengeResult>;
}) {
  const t = useMessages('practice');
  const formatScore = useSightSingingScoreFormat();
  const { voice } = selected;
  const [speed, setSpeed] = useState<Speed>(1);
  const speedIndex = sightSingingSpeeds.indexOf(speed);
  const melody = useMemo(() => melodyAtSpeed(selected.melody, speed), [selected.melody, speed]);
  const [drone, setDrone] = useState(false);
  const [backing, setBacking] = useState(false);
  const otherVoices = voices.filter(option => option.voice.id !== voice.id);
  const accompaniment = backing && !backingUnavailable ? otherVoices : [];
  const [state, setState] = useState<RunState>({ phase: 'idle' });
  const [pitchMode, setPitchMode] = useState<PitchMode | null>(null);
  const [headphones, setHeadphones] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [replayTime, setReplayTime] = useState(0);
  const [latencyDraft, setLatencyDraft] = useState<number | null>(null);
  const adjusting = latencyDraft !== null;
  const latencyTitle = useId();
  const latencyTrigger = useRef<HTMLButtonElement>(null);
  const beforeAlignment = useRef(0);
  const latencyHeading = useRef<HTMLHeadingElement>(null);
  const wasAdjusting = useRef(false);
  useLayoutEffect(() => {
    if (adjusting) latencyHeading.current?.focus({ preventScroll: true });
    else if (wasAdjusting.current) latencyTrigger.current?.focus({ preventScroll: true });
    wasAdjusting.current = adjusting;
  }, [adjusting]);
  const [error, setError] = useState<CaptureError | null>(null);
  const [audioHint, setAudioHint] = useState(false);
  const [audioSession] = useState(() => playbackAudioSession());
  const [followRun, setFollowRun] = useState(0);
  const [attemptReset, setAttemptReset] = useState(0);
  const [pitchSpan, setPitchSpan] = useState(3);
  const run = useRef<{ stop: () => void; setMix?: (mix: Pick<ChallengeMix, 'backing' | 'tonic' | 'metronome'>) => void } | null>(null);
  const tonicPreview = useRef<ReturnType<typeof playSustainedTonic> | null>(null);
  const replay = useRef<HTMLAudioElement>(null);
  const take = state.phase === 'result' ? state : undefined;
  const latency = latencyDraft ?? mix.latency;
  const corrected = useMemo(() => take ? reviewRecording(melody, take, latency) : undefined, [take, latency, melody]);
  const { answer, retryAnswer } = useChallengeAnswer(take?.recording, corrected?.review, mix.voice, melody.duration, latency);
  const recording = state.phase === 'permission' || state.phase === 'count' || state.phase === 'sing';
  const audioBusy = recording || playing || drone;
  useEffect(() => { onAudioBusy(audioBusy); return () => onAudioBusy(false); }, [audioBusy, onAudioBusy]);
  const release = useCallback(() => {
    const active = run.current;
    run.current = null;
    active?.stop();
    replay.current?.pause();
    if (!tonicPreview.current) audioSession.release();
  }, [audioSession]);
  const attachReplay = useCallback((audio: HTMLAudioElement | null) => {
    replay.current = audio;
    if (!audio) return;
    return () => {
      if (!audio.paused) {
        audio.pause();
        setPlaying(false);
        setReplayTime(audio.currentTime);
      }
      audioSession.release();
      replay.current = null;
    };
  }, [audioSession]);
  const stopTonic = useCallback(() => {
    const preview = tonicPreview.current;
    tonicPreview.current = null;
    preview?.stop();
    if (preview && !run.current) audioSession.release();
  }, [audioSession]);
  const discard = useCallback((keepTonic = false) => {
    release();
    if (!keepTonic) stopTonic();
  }, [release, stopTonic]);
  useEffect(() => {
    const interrupt = () => {
      if (window.document.visibilityState !== 'hidden') return;
      release();
      stopTonic();
      setDrone(false);
      setHeadphones(false);
      setState(current => current.phase === 'permission' || current.phase === 'count' || current.phase === 'sing' ? { phase: 'idle' } : current);
    };
    const pageHide = () => { discard(); setDrone(false); setHeadphones(false); setLatencyDraft(null); setState({ phase: 'idle' }); };
    window.document.addEventListener('visibilitychange', interrupt);
    window.addEventListener('pagehide', pageHide);
    return () => {
      window.document.removeEventListener('visibilitychange', interrupt);
      window.removeEventListener('pagehide', pageHide);
      discard();
    };
  }, [discard, release, stopTonic]);

  useEffect(() => { tonicPreview.current?.setPitch(melody.tonic); }, [melody.tonic]);
  const { backing: backingVolume, tonic: tonicVolume, metronome } = mix;
  useEffect(() => {
    tonicPreview.current?.setVolume(tonicVolume);
    run.current?.setMix?.({ backing: backingVolume, tonic: tonicVolume, metronome });
  }, [backingVolume, tonicVolume, metronome]);

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

  const finish = () => {
    if (!take) return;
    // Leaving without finishing an adjustment submits the last applied score.
    const score = latency === mix.latency ? corrected?.score : reviewRecording(melody, take, mix.latency).score;
    if (!score || score.percent === null) return;
    onScored({ id: take.id, score: score.percent, speed, perfect: score.perfect, writtenOctave: score.writtenOctave,
      version: questionVersion, voiceId: voice.id, voiceName: selected.label });
  };
  useImperativeHandle(ref, () => ({ finish }));

  const toggleTonic = () => {
    if (tonicPreview.current) {
      stopTonic();
      setDrone(false);
      if (!backing) setHeadphones(false);
      return;
    }
    setError(null);
    setAudioHint(Boolean(audioSession.request()));
    try {
      const preview = playSustainedTonic(melody.tonic, tonicVolume, () => {
        if (tonicPreview.current !== preview) return;
        stopTonic();
        setDrone(false);
        setError('audioFailure');
      });
      tonicPreview.current = preview;
      setDrone(true);
      setHeadphones(true);
    } catch {
      if (!run.current) audioSession.release();
      setError('audioFailure');
    }
  };

  const start = () => {
    if (!pitchMode) return;
    const captureLatency = mix.latency;
    // Transfer the audible oscillator to the capture session without restarting it.
    const preview = tonicPreview.current;
    discard(true);
    tonicPreview.current = null;
    setPlaying(false); setReplayTime(0); setError(null); setHeadphones(false);
    setFollowRun(value => value + 1);
    // Declare simultaneous output and capture before the gesture starts Web Audio and getUserMedia.
    setAudioHint(Boolean(audioSession.request('play-and-record')));
    setState({ phase: 'permission' });
    const takeId = crypto.randomUUID();
    const releaseUpdate = holdUpdate();
    let paint = 0;
    let latest: Extract<RunState, { phase: 'sing' }>;
    const capture = beginCapture(melody, {
      onCount: count => setState({ phase: 'count', count }),
      onFrame: (frame, frames) => {
        latest = { phase: 'sing', frame, frames };
        if (!paint) paint = requestAnimationFrame(() => {
          paint = 0;
          setState(latest);
        });
      },
      onComplete: (frames, recording) => {
        release();
        setDrone(false);
        setState({ phase: 'result', id: takeId, frames, mode: pitchMode, captureLatency, recording });
      },
      onError: reason => { releaseUpdate(); discard(); setDrone(false); setError(reason); setState({ phase: 'idle' }); },
    }, accompaniment.map(option => melodyAtSpeed(option.melody, speed).notes), mix, { mode: pitchMode, latency: captureLatency }, preview?.context);
    run.current = {
      stop: () => { cancelAnimationFrame(paint); capture.stop(); releaseUpdate(); },
      setMix: next => { capture.setMix(next); preview?.setVolume(next.tonic); },
    };
  };
  const reset = () => {
    discard(); setDrone(false); setPlaying(false); setReplayTime(0); setError(null); setHeadphones(false);
    setLatencyDraft(null);
    setAttemptReset(value => value + 1);
    setState({ phase: 'idle' });
  };
  const pauseForAlignment = () => {
    const audio = replay.current;
    if (!audio || audio.paused) return;
    audio.pause();
    setPlaying(false);
    setReplayTime(audio.currentTime);
  };
  const seek = useCallback((time: number) => {
    const audio = replay.current;
    if (!audio) return;
    audio.currentTime = time;
    setReplayTime(time);
  }, []);
  const cancelAlignment = () => {
    pauseForAlignment();
    seek(beforeAlignment.current);
    setReplayTime(beforeAlignment.current);
    setLatencyDraft(null);
  };
  const playFrom = useCallback((time?: number) => {
    const audio = replay.current;
    if (!audio) return;
    setError(null);
    if (time !== undefined) seek(time);
    else if (audio.ended) seek(0);
    setFollowRun(value => value + 1);
    setAudioHint(Boolean(audioSession.request()));
    void audio.play().catch((reason: unknown) => {
      if (replay.current !== audio || reason instanceof DOMException && reason.name === 'AbortError') return;
      if (audio.paused) audioSession.release();
      setError('audioFailure');
    });
  }, [audioSession, seek]);

  const position = state.phase === 'sing' ? state.frame.time : state.phase === 'result' ? replayTime : 0;
  const inLeadIn = state.phase === 'sing' && position < melody.leadIn;
  const measure = melody.measures.find(bar => position < bar.end) ?? melody.measures[melody.measures.length - 1];
  const target = melody.notes.find(note => note.start <= position && position < note.end);
  const review = corrected?.review;
  const displayFrames = corrected?.frames ?? (state.phase === 'sing' ? state.frames : undefined);
  const feedback = useMemo(() => review?.flatMap(row => row.note.beatIndex === undefined ? [] : [{
    bar: row.note.bar, beatIndex: row.note.beatIndex, visit: row.note.visit, status: row.status, midi: row.target ?? undefined, cents: row.cents,
  }]), [review]);

  const playMeasure = useCallback((index: number) => {
    const visit = measure.visit;
    const bar = melody.measures.filter(candidate => candidate.bar === index).reduce<(typeof melody.measures)[number] | undefined>(
      (closest, candidate) => !closest || Math.abs(candidate.visit - visit) < Math.abs(closest.visit - visit) ? candidate : closest, undefined);
    if (bar) playFrom(bar.start);
  }, [measure.visit, melody, playFrom]);
  const selectNote = useCallback((hit: NotationNoteHit) => {
    if (measuring) return;
    if (state.phase === 'result') { playMeasure(hit.bar); return; }
    if (state.phase !== 'idle') return;
    release(); setError(null);
    setAudioHint(Boolean(audioSession.request()));
    try {
      const stop = playNote(hit.midi, failed => {
        run.current = null;
        if (!tonicPreview.current) audioSession.release();
        if (failed) setError('audioFailure');
      });
      run.current = { stop };
    } catch {
      if (!tonicPreview.current) audioSession.release();
      setError('audioFailure');
    }
  }, [audioSession, measuring, playMeasure, release, state.phase]);

  const bpm = melody.tempoMarks.reduce((tempo, mark) => mark.start <= position ? mark.bpm : tempo, melody.tempo.bpm * speed);
  const cropped = melody.measures.some(bar => bar.clip);
  const positioned = state.phase === 'count' && !cropped || state.phase === 'sing' || state.phase === 'result' && (playing || replayTime > 0);
  const canTap = !measuring && (state.phase === 'idle' || (state.phase === 'result' && answer.status === 'ready'));

  return <div className="challenge-run" data-phase={state.phase} data-replaying={playing} data-pitch-mode={take?.mode ?? pitchMode ?? undefined}>
    <ChallengeNotation score={document.score} voice={voice} melody={melody} measure={measure} elapsed={position}
      positioned={positioned} followRun={followRun} attemptReset={attemptReset} bpm={Number(bpm.toFixed(1))} feedback={feedback}
      onNote={canTap ? hit => {
        const inside = !cropped || voices.some(({ voice: part, melody: phrase }) =>
          part.track === hit.track && part.staff === hit.staff && part.voice === hit.voice &&
          phrase.staffBeats.some(beat => beat.bar === hit.bar && beat.beatIndex === hit.beatIndex && beat.pitches.includes(hit.midi)));
        if (inside) selectNote(hit);
      } : undefined} onMeasure={state.phase === 'result' && canTap ? playMeasure : undefined}
      pitchFrames={displayFrames}
      traceMode={state.phase === 'sing' ? 'recording' : playing ? 'replaying' : undefined}
      traceThrough={state.phase === 'sing' || state.phase === 'result' ? position : undefined} />

    {pitchTraceEnabled && <PitchGraph key={voice.id} melody={melody} visits={document.visits} measure={measure} attemptReset={attemptReset}
      measureSpan={pitchSpan} onMeasureSpanChange={setPitchSpan} frames={displayFrames ?? emptyFrames} elapsed={position}
      following={recording || playing} reviewing={state.phase === 'result'} activeTarget={target ? targetPitches(target).map(pitchName).join(' / ') : undefined} />}

    {error && <p className="challenge-error" role="alert">{t(`sight.${error}`)}</p>}
    {audioHint && <p className="challenge-save-status" role="status">{t('audioHint')}</p>}
    {state.phase === 'idle' && <div className="challenge-controls challenge-setup">
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
        <button type="button" className="challenge-option challenge-toggle" aria-pressed={drone}
          disabled={measuring} aria-label={t('sight.sustainedTonic')} title={t('sight.sustainedTonic')} onClick={toggleTonic}>
          <TuningFork size={18} aria-hidden="true" /><span>{t('sight.sustainedTonic')}</span>
        </button>
        <button type="button" className="challenge-option challenge-toggle" aria-pressed={accompaniment.length > 0}
          aria-label={t('sight.ensembleBacking')} title={t('sight.ensembleBacking')}
          disabled={backingUnavailable || otherVoices.length === 0} onClick={() => {
            setBacking(!backing); if (!backing) setHeadphones(true);
          }}><UsersRound size={18} aria-hidden="true" /><span>{t('sight.ensembleBacking')}</span></button>
        <PitchModeSelect className="challenge-pitch-mode" value={pitchMode} onChange={setPitchMode} disabled={measuring} />
      </div>
      {backingUnavailable && <small>{t('sight.backingUnavailable')}</small>}
      <button className="primary-button challenge-start" type="button" disabled={measuring || pitchMode === null} onClick={start}><Mic size={18} aria-hidden="true" />{t('sight.start')}</button>
    </div>}

    {recording && <div className="challenge-controls challenge-transport">
      <div className={state.phase === 'sing' ? 'visually-hidden' : 'challenge-stage'} role="status">
        {state.phase === 'count' ? t('sight.count', { count: state.count }) : state.phase === 'permission' ? t('sight.waitingMicrophone')
          : inLeadIn ? t('sight.leadIn') : null}
        {state.phase === 'count' && <div className="challenge-count" aria-hidden="true">
          {Array.from({ length: melody.beats }, (_, index) => <span key={index} data-passed={index <= melody.beats - state.count} />)}
        </div>}
      </div>
      {state.phase !== 'count' && <button className="secondary-button challenge-stop" type="button" onClick={reset}>
        <Square size={15} aria-hidden="true" />{t('sight.stop')}
      </button>}
    </div>}

    {state.phase === 'result' && corrected && <section className="challenge-controls challenge-result" aria-label={t('sight.review')}
      onKeyDown={event => {
        if (adjusting && event.key === 'Escape' && !event.defaultPrevented) cancelAlignment();
      }}>
      <div className="challenge-result-summary">
        <div className="challenge-score">
          <ScoreBadges perfect={corrected.score.perfect} writtenOctave={corrected.score.writtenOctave} size={22} />
          <strong>{corrected.score.percent === null ? t('sight.takeComplete') : t('sight.intonationScore', { score: formatScore(corrected.score.percent) })}</strong>
          <span>{t('pitchMode.label')} · {t(state.mode === 'clear' ? 'pitchMode.clear' : 'pitchMode.all')}</span>
          {corrected.score.total > 0 && !corrected.score.perfect && <span>{t('sight.matchedNotes', { matched: corrected.score.matched, total: corrected.score.total })}</span>}
        </div>
        {!adjusting && <button ref={latencyTrigger} className="secondary-button challenge-latency-trigger" type="button"
          onClick={() => {
            beforeAlignment.current = replay.current?.currentTime ?? replayTime;
            setLatencyDraft(mix.latency);
          }}>{t('sight.latency.problem')}</button>}
      </div>
      {answer.status === 'ready' && <audio ref={attachReplay} src={answer.url} preload="auto"
        onLoadedMetadata={event => { if (replayTime > 0) event.currentTarget.currentTime = replayTime; }}
        onPlay={() => setPlaying(true)} onPause={event => {
          if (!event.currentTarget.paused) return;
          audioSession.release(); setPlaying(false); setReplayTime(event.currentTarget.currentTime);
        }}
        onTimeUpdate={event => setReplayTime(event.currentTarget.currentTime)}
        onEnded={() => { audioSession.release(); setPlaying(false); }}
        onError={() => { audioSession.release(); setError('audioFailure'); }} />}
      {adjusting && <div className="challenge-result-adjustment" role="group" aria-labelledby={latencyTitle}>
        <div className="challenge-latency-heading">
          <h2 id={latencyTitle} tabIndex={-1} ref={latencyHeading}>{t('sight.latency.adjust')}</h2>
          <button type="button" className="icon-button" aria-label={t('cancel')} onClick={cancelAlignment}><X size={18} aria-hidden="true" /></button>
        </div>
        <LatencyControls value={latency} showDirection audioBusy={audioBusy || measuring} onMeasure={onMeasure} onChange={value => {
          pauseForAlignment();
          setLatencyDraft(value);
        }} />
      </div>}
      <div className="challenge-replay-controls">
        <button className={`${adjusting ? 'secondary-button' : 'primary-button'} challenge-review-play`} type="button" disabled={measuring || answer.status === 'preparing'}
          aria-busy={answer.status === 'preparing' || undefined} onClick={() => {
          if (answer.status === 'failed') retryAnswer();
          else if (playing) replay.current?.pause();
          else playFrom();
        }}>{playing ? <Square size={18} aria-hidden="true" /> : <Play size={18} aria-hidden="true" />}
          {t(playing ? 'sight.stopReplay' : 'sight.latency.listen')}
        </button>
        {adjusting ? <button className="primary-button challenge-stop" type="button" disabled={measuring} onClick={() => {
          onLatency(latency);
          setLatencyDraft(null);
        }}><Check size={17} aria-hidden="true" />{t('sight.latency.done')}</button>
          : <button className="secondary-button challenge-stop" type="button" onClick={() => { finish(); reset(); }}>
            <RotateCcw size={17} aria-hidden="true" />{t('sight.retry')}
          </button>}
      </div>
    </section>}

  </div>;
}
