import { playbackAudioSession } from '@same-page/player/playback-audio-session';
import { ChevronDown, Headphones, Mic, Minus, Play, Plus, RotateCcw, Square, UserRound, UsersRound, X, createLucideIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMessages } from '../../i18n';
import { sightSingingSpeeds, type SightSingingResultSubmission, type SightSingingStanding } from '../../shared/sight-singing-results';
import { holdUpdate } from '../updates/update-safety';
import { beginCapture, mixPianoAnswer, playNote, playSustainedTonic, type CaptureError } from './challenge-audio';
import { ChallengeNotation, type NotationNoteHit } from './challenge-notation';
import { ChallengeStanding } from './challenge-standing';
import { useSightSingingScoreFormat } from './format-score';
import { PitchGraph } from './pitch-graph';
import { melodyAtSpeed, targetPitches, type Melody, type MelodyScore, type MelodyVoice } from './melody';
import { assessNotes, pitchName, takeScore, type PitchFrame } from './pitch-feedback';
import { createPitchTrace } from './pitch-trace';
import { ScoreBadges } from './score-badge';

const emptyFrames: PitchFrame[] = [];
const TuningFork = createLucideIcon('TuningFork', [['path', { d: 'M7 3v8a5 5 0 0 0 10 0V3M12 16v5', key: 'fork' }]]);
type Speed = SightSingingResultSubmission['speed'];
export type ResultSave = { published: boolean; standing: SightSingingStanding };
export type VoiceOption = { voice: MelodyVoice; melody: Melody; label: string };
type Review = ReturnType<typeof assessNotes>;
type Answer = { status: 'preparing' } | { status: 'ready'; url: string } | { status: 'failed'; recording: Blob };
type RunState = { phase: 'idle' | 'permission' }
  | { phase: 'count'; count: number }
  | { phase: 'sing'; frame: PitchFrame; frames: PitchFrame[] }
  | { phase: 'result'; id: string; frames: PitchFrame[]; review: Review; score: ReturnType<typeof takeScore>; answer: Answer; save: ResultSave | 'saving' | 'failed' | 'unscored' };

export function ChallengeRun({ document, selected, voices, backingUnavailable, selectVoice, questionVersion, pitchTraceEnabled, onScored }: {
  document: MelodyScore; selected: VoiceOption; voices: VoiceOption[]; backingUnavailable: boolean;
  selectVoice: (id: string) => void; questionVersion: number;
  pitchTraceEnabled: boolean; onScored: (take: SightSingingResultSubmission) => Promise<ResultSave>;
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
  const [headphones, setHeadphones] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [replayTime, setReplayTime] = useState(0);
  const [dismissedStanding, setDismissedStanding] = useState<string>();
  const [error, setError] = useState<CaptureError | null>(null);
  const [audioHint, setAudioHint] = useState(false);
  const [audioSession] = useState(() => playbackAudioSession());
  const [followRun, setFollowRun] = useState(0);
  const [attemptReset, setAttemptReset] = useState(0);
  const [pitchSpan, setPitchSpan] = useState(3);
  const take = useRef<string | null>(null);
  const run = useRef<(() => void) | null>(null);
  const tonicPreview = useRef<ReturnType<typeof playSustainedTonic> | null>(null);
  const mixedUrl = useRef<string | null>(null);
  const replay = useRef<HTMLAudioElement>(null);
  const reviewSection = useRef<HTMLElement>(null);
  const release = useCallback(() => {
    const stop = run.current;
    run.current = null;
    stop?.();
    replay.current?.pause();
    if (!tonicPreview.current) audioSession.release();
  }, [audioSession]);
  const stopTonic = useCallback(() => {
    const preview = tonicPreview.current;
    tonicPreview.current = null;
    preview?.stop();
    if (preview && !run.current) audioSession.release();
  }, [audioSession]);
  const discard = useCallback((keepTonic = false) => {
    take.current = null;
    release();
    if (!keepTonic) stopTonic();
    if (mixedUrl.current) URL.revokeObjectURL(mixedUrl.current);
    mixedUrl.current = null;
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
    const pageHide = () => { discard(); setDrone(false); setHeadphones(false); setState({ phase: 'idle' }); };
    window.document.addEventListener('visibilitychange', interrupt);
    window.addEventListener('pagehide', pageHide);
    return () => {
      window.document.removeEventListener('visibilitychange', interrupt);
      window.removeEventListener('pagehide', pageHide);
      discard();
    };
  }, [discard, release, stopTonic]);

  useEffect(() => { tonicPreview.current?.setPitch(melody.tonic); }, [melody.tonic]);

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

  const saveResult = async (id: string, { percent, perfect, writtenOctave }: ReturnType<typeof takeScore>) => {
    if (percent === null) return;
    const update = (save: ResultSave | 'failed' | 'saving') =>
      setState(current => current.phase === 'result' && current.id === id ? { ...current, save } : current);
    update('saving');
    try {
      update(await onScored({ id, score: percent, speed, perfect, writtenOctave,
        version: questionVersion, voiceId: voice.id, voiceName: selected.label }));
    } catch {
      update('failed');
    }
  };

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
      const preview = playSustainedTonic(melody.tonic, () => {
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
        setDrone(false);
        const review = assessNotes(melody.notes.filter(note => note.start >= melody.leadIn), result), score = takeScore(review);
        setState({ phase: 'result', id: takeId, frames: trace.frames, review, score,
          answer: { status: 'preparing' }, save: score.percent === null ? 'unscored' : 'saving' });
        void saveResult(takeId, score);
        void prepareAnswer(takeId, recording, review);
      },
      onError: reason => { releaseUpdate(); discard(); setDrone(false); setError(reason); setState({ phase: 'idle' }); },
    }, accompaniment.map(option => melodyAtSpeed(option.melody, speed).notes), preview?.context);
    run.current = () => { stop(); releaseUpdate(); };
  };
  const reset = () => {
    discard(); setDrone(false); setPlaying(false); setReplayTime(0); setError(null); setHeadphones(false);
    setAttemptReset(value => value + 1);
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
    setFollowRun(value => value + 1);
    setAudioHint(Boolean(audioSession.request()));
    void audio.play().catch((reason: unknown) => {
      if (replay.current !== audio || reason instanceof DOMException && reason.name === 'AbortError') return;
      if (audio.paused) audioSession.release();
      setError('audioFailure');
    });
  }, [audioSession, seek]);

  const recording = state.phase === 'permission' || state.phase === 'count' || state.phase === 'sing';
  const position = state.phase === 'sing' ? state.frame.time : state.phase === 'result' ? replayTime : 0;
  const inLeadIn = state.phase === 'sing' && position < melody.leadIn;
  const measure = melody.measures.find(bar => position < bar.end) ?? melody.measures[melody.measures.length - 1];
  const target = melody.notes.find(note => note.start <= position && position < note.end);
  const review = state.phase === 'result' ? state.review : undefined;
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
    if (state.phase === 'result') { playMeasure(hit.bar); return; }
    if (state.phase !== 'idle') return;
    release(); setError(null);
    setAudioHint(Boolean(audioSession.request()));
    try {
      run.current = playNote(hit.midi, failed => {
        run.current = null;
        if (!tonicPreview.current) audioSession.release();
        if (failed) setError('audioFailure');
      });
    } catch {
      if (!tonicPreview.current) audioSession.release();
      setError('audioFailure');
    }
  }, [audioSession, playMeasure, release, state.phase]);

  const bpm = melody.tempoMarks.reduce((tempo, mark) => mark.start <= position ? mark.bpm : tempo, melody.tempo.bpm * speed);
  const cropped = melody.measures.some(bar => bar.clip);
  const positioned = state.phase === 'count' && !cropped || state.phase === 'sing' || state.phase === 'result' && (playing || replayTime > 0);
  const canTap = state.phase === 'idle' || (state.phase === 'result' && state.answer.status === 'ready');
  const standing = state.phase === 'result' && !playing && dismissedStanding !== state.id && typeof state.save === 'object' && state.save.standing
    && state.score.percent !== null ? { id: state.id, score: state.score.percent, published: state.save.published, rank: state.save.standing } : null;

  return <div className="challenge-run" data-phase={state.phase} data-replaying={playing}>
    <ChallengeNotation score={document.score} voice={voice} melody={melody} measure={measure} elapsed={position}
      positioned={positioned} followRun={followRun} attemptReset={attemptReset} bpm={Number(bpm.toFixed(1))} feedback={feedback}
      onNote={canTap ? hit => {
        const inside = !cropped || voices.some(({ voice: part, melody: phrase }) =>
          part.track === hit.track && part.staff === hit.staff && part.voice === hit.voice &&
          phrase.staffBeats.some(beat => beat.bar === hit.bar && beat.beatIndex === hit.beatIndex && beat.pitches.includes(hit.midi)));
        if (inside) selectNote(hit);
      } : undefined} onMeasure={state.phase === 'result' && canTap ? playMeasure : undefined}
      pitchFrames={'frames' in state ? state.frames : undefined}
      liveTrace={state.phase === 'sing' || playing} traceThrough={state.phase === 'result' ? replayTime : undefined} />

    {pitchTraceEnabled && <PitchGraph key={voice.id} melody={melody} visits={document.visits} measure={measure} attemptReset={attemptReset}
      measureSpan={pitchSpan} onMeasureSpanChange={setPitchSpan} frames={'frames' in state ? state.frames : emptyFrames} elapsed={position}
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
          aria-label={t('sight.sustainedTonic')} title={t('sight.sustainedTonic')} onClick={toggleTonic}>
          <TuningFork size={18} aria-hidden="true" /><span>{t('sight.sustainedTonic')}</span>
        </button>
        <button type="button" className="challenge-option challenge-toggle" aria-pressed={accompaniment.length > 0}
          aria-label={t('sight.ensembleBacking')} title={t('sight.ensembleBacking')}
          disabled={backingUnavailable || otherVoices.length === 0} onClick={() => {
            setBacking(!backing); if (!backing) setHeadphones(true);
          }}><UsersRound size={18} aria-hidden="true" /><span>{t('sight.ensembleBacking')}</span></button>
      </div>
      {backingUnavailable && <small>{t('sight.backingUnavailable')}</small>}
      <button className="primary-button challenge-start" type="button" onClick={start}><Mic size={18} aria-hidden="true" />{t('sight.start')}</button>
    </div>}

    {recording && <div className="challenge-controls challenge-transport">
      <div className="challenge-stage" role="status">
        {state.phase === 'count' ? t('sight.count', { count: state.count }) : state.phase === 'permission' ? t('sight.waitingMicrophone')
          : t(inLeadIn ? 'sight.leadIn' : 'sight.singNow')}
        {state.phase === 'count' && <div className="challenge-count" aria-hidden="true">
          {Array.from({ length: melody.beats }, (_, index) => <span key={index} data-passed={index <= melody.beats - state.count} />)}
        </div>}
      </div>
      {state.phase === 'sing' && state.frame.midi !== null && <span className="challenge-staff-current-pitch">
        {t('sight.currentPitch', { pitch: pitchName(Math.round(state.frame.midi)) })}
      </span>}
      <button className="secondary-button challenge-stop" type="button" onClick={reset}><Square size={15} aria-hidden="true" />{t('sight.stop')}</button>
    </div>}

    {state.phase === 'result' && <section ref={reviewSection} tabIndex={-1} className="challenge-controls challenge-result" aria-label={t('sight.review')}>
      <div className="challenge-score">
        <ScoreBadges perfect={state.score.perfect} writtenOctave={state.score.writtenOctave} size={22} />
        <strong>{state.score.percent === null ? t('sight.takeComplete') : t('sight.intonationScore', { score: formatScore(state.score.percent) })}</strong>
        {state.score.total > 0 && !state.score.perfect && <span>{t('sight.matchedNotes', { matched: state.score.matched, total: state.score.total })}</span>}
      </div>
      <div className="challenge-replay-controls">
        {state.answer.status === 'ready' && <audio ref={replay} src={state.answer.url} preload="auto"
          onPlay={() => setPlaying(true)} onPause={event => {
            if (!event.currentTarget.paused) return;
            audioSession.release(); setPlaying(false); setReplayTime(event.currentTarget.currentTime);
          }}
          onTimeUpdate={event => setReplayTime(event.currentTarget.currentTime)}
          onEnded={() => { audioSession.release(); setPlaying(false); }}
          onError={() => { audioSession.release(); setError('audioFailure'); }} />}
        <button className="primary-button challenge-review-play" type="button" disabled={state.answer.status === 'preparing'} onClick={() => {
          if (state.answer.status === 'failed') void prepareAnswer(state.id, state.answer.recording, state.review);
          else if (playing) replay.current?.pause();
          else playFrom();
        }}>{playing ? <Square size={18} aria-hidden="true" /> : <Play size={18} aria-hidden="true" />}
          {t(state.answer.status === 'preparing' ? 'sight.mixingAnswer' : playing ? 'sight.stopReplay' : 'sight.replayMix')}
        </button>
        <button className="secondary-button challenge-stop" type="button" onClick={reset}><RotateCcw size={17} aria-hidden="true" />{t('sight.retry')}</button>
      </div>
      {state.save === 'failed' && <p className="challenge-save-status" role="alert">
        {t('sight.resultSave.failed')}
        {state.score.percent !== null && <button type="button" className="text-button" onClick={() => void saveResult(state.id, state.score)}>
          {t('sight.retryLoad')}</button>}
      </p>}
    </section>}

    {standing && <ChallengeStanding key={standing.id} standing={standing.rank} score={standing.score} published={standing.published}
      onClose={() => {
        setDismissedStanding(standing.id);
        requestAnimationFrame(() => reviewSection.current?.focus({ preventScroll: true }));
      }} />}

  </div>;
}
