import { Mic, Play, RotateCcw, Square, Volume2 } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useMessages } from '../../i18n';
import { holdUpdate } from '../updates/update-safety';
import { beginCapture, mixPianoAnswer, playMelody, type CaptureError } from './challenge-audio';
import { ChallengeNotation, PitchGraph } from './challenge-notation';
import { targetPitches, type Melody, type MelodyScore, type MelodyVoice } from './melody';
import { FeedbackTable } from './practice-feedback';
import { takeScore, type PracticeTake } from './practice-history';
import { assessNotes, pitchName, type PitchFrame } from './pitch-feedback';

const emptyFrames: PitchFrame[] = [];
export type VoiceOption = { voice: MelodyVoice; melody: Melody; label: string };
export type TakeFeedback = Pick<PracticeTake, 'voiceId' | 'voiceName' | 'drone' | 'accompaniment' | 'notes' | 'matched' | 'total' | 'percent'>;
const pitchList = (pitches: number[]) => pitches.map(pitchName).join(' / ');
type RunState = { phase: 'idle' | 'permission' }
  | { phase: 'count'; count: number }
  | { phase: 'sing'; elapsed: number; frame: PitchFrame; frames: PitchFrame[] }
  | { phase: 'result'; frames: PitchFrame[]; url: string; recording: Blob; review: ReturnType<typeof assessNotes>; take: TakeFeedback };

export function ChallengeRun({ document, selected, voices, selectVoice, visitLabel, onTake }: {
  document: MelodyScore; selected: VoiceOption; voices: VoiceOption[]; selectVoice: (id: string) => void;
  visitLabel: (index: number) => string; onTake: (take: TakeFeedback) => Promise<void>;
}) {
  const t = useMessages('practice');
  const id = useId();
  const { voice, melody } = selected;
  const [drone, setDrone] = useState(false);
  const [backing, setBacking] = useState<string[]>([]);
  const otherVoices = voices.filter(option => option.voice.id !== voice.id);
  const accompaniment = otherVoices.filter(option => backing.includes(option.voice.id));
  const [answer, setAnswer] = useState<'off' | 'loading' | { url: string }>('off');
  const [historyError, setHistoryError] = useState(false);
  const answerUrl = useRef<string | null>(null);
  const seekOnMetadata = useRef<number | null>(null);
  const [state, setState] = useState<RunState>({ phase: 'idle' });
  const [previewing, setPreviewing] = useState(false);
  const [replayTime, setReplayTime] = useState(0);
  const [error, setError] = useState<CaptureError | null>(null);
  const run = useRef<(() => void) | null>(null);
  const recordingUrl = useRef<string | null>(null);
  const replay = useRef<HTMLAudioElement>(null);
  const release = useCallback(() => {
    const stop = run.current;
    run.current = null;
    stop?.();
    replay.current?.pause();
  }, []);
  const discard = useCallback(() => {
    release();
    if (recordingUrl.current) URL.revokeObjectURL(recordingUrl.current);
    recordingUrl.current = null;
    if (answerUrl.current) URL.revokeObjectURL(answerUrl.current);
    answerUrl.current = null;
    seekOnMetadata.current = null;
  }, [release]);
  useEffect(() => {
    const interrupt = () => {
      const active = Boolean(run.current);
      release();
      setPreviewing(false);
      if (active) {
        setState(current => current.phase === 'result' ? current : { phase: 'idle' });
        setError('audioInterrupted');
      }
    };
    const visibility = () => { if (window.document.hidden) interrupt(); };
    window.document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', interrupt);
    return () => {
      window.document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pagehide', interrupt);
      discard();
    };
  }, [discard, release]);

  const preview = (firstOnly: boolean) => {
    release(); setError(null);
    try {
      run.current = playMelody(melody, firstOnly, failed => {
        release(); setPreviewing(false);
        if (failed) setError('audioFailure');
      });
      setPreviewing(true);
    } catch { setError('audioFailure'); }
  };
  const start = () => {
    discard(); setReplayTime(0); setError(null); setAnswer('off'); setHistoryError(false); setState({ phase: 'permission' });
    const releaseUpdate = holdUpdate();
    const frames: PitchFrame[] = [];
    const stop = beginCapture(melody, {
      onCount: count => setState({ phase: 'count', count }),
      onFrame: (frame, elapsed) => {
        frames.push(frame);
        setState({ phase: 'sing', frame, elapsed, frames });
      },
      onComplete: (result, recording) => {
        release();
        const url = URL.createObjectURL(recording);
        recordingUrl.current = url;
        const review = assessNotes(melody.notes, result);
        const notes = review.map(({ note, ...detail }) => ({ ...detail, measure: visitLabel(note.visit), targets: targetPitches(note) }));
        const take = { ...takeScore(review), voiceId: voice.id, voiceName: selected.label, drone,
          accompaniment: accompaniment.map(option => option.label), notes };
        setState({ phase: 'result', frames: result, url, recording, review, take });
        void onTake(take).catch(() => { if (recordingUrl.current === url) setHistoryError(true); });
      },
      onError: reason => { releaseUpdate(); release(); setError(reason); setState({ phase: 'idle' }); },
    }, drone || accompaniment.length ? { drone, others: accompaniment.flatMap(option => option.melody.notes) } : undefined);
    run.current = () => { stop(); releaseUpdate(); };
  };
  const cancel = () => { release(); setPreviewing(false); setState(current => current.phase === 'result' ? current : { phase: 'idle' }); };
  const configureTake = () => {
    discard();
    setState({ phase: 'idle' });
    setAnswer('off');
    setReplayTime(0);
    setError(null);
  };
  const changeVoice = (next: string) => {
    setBacking(previous => previous.filter(value => value !== next));
    selectVoice(next);
  };
  const playFrom = (time: number) => {
    const audio = replay.current;
    if (!audio) return;
    setError(null);
    seekOnMetadata.current = null;
    audio.currentTime = time;
    setReplayTime(time);
    void audio.play().catch(() => setError('audioFailure'));
  };
  const compareAnswer = async (enabled: boolean) => {
    if (state.phase !== 'result') return;
    release();
    setError(null);
    seekOnMetadata.current = replay.current?.currentTime ?? 0;
    if (!enabled) { setAnswer('off'); return; }
    if (answerUrl.current) { setAnswer({ url: answerUrl.current }); return; }
    setAnswer('loading');
    try {
      const notes = state.review.map(row => row.target === null ? row.note : { ...row.note, midi: row.target, chord: undefined });
      const mixed = await mixPianoAnswer(state.recording, notes);
      if (recordingUrl.current !== state.url) return;
      const url = URL.createObjectURL(mixed);
      answerUrl.current = url;
      setAnswer({ url });
    } catch {
      if (recordingUrl.current !== state.url) return;
      setAnswer('off'); setError('audioFailure');
    }
  };
  const recording = state.phase === 'permission' || state.phase === 'count' || state.phase === 'sing';
  const elapsed = state.phase === 'sing' ? state.elapsed : state.phase === 'result' ? replayTime : 0;
  // Compare the displayed voice with the target at the center of the same capture window.
  const position = state.phase === 'sing' ? state.frame.time : elapsed;
  const measure = melody.measures.find(bar => position < bar.end) ?? melody.measures[melody.measures.length - 1];
  const target = melody.notes.find(note => note.start <= position && position < note.end);
  const busy = recording || previewing;
  const unscored = state.phase === 'result' ? state.take.notes.length - state.take.total : 0;

  return <div className="challenge-run">
    {state.phase === 'idle' && !busy && <div className="challenge-options">
      <div className="challenge-voice">
        <label htmlFor={`${id}-voice`}>{t('sight.singVoice')}</label>
        <select id={`${id}-voice`} value={voice.id} onChange={event => changeVoice(event.target.value)}>
          {voices.map(option => <option key={option.voice.id} value={option.voice.id}>{option.label}</option>)}
        </select>
      </div>
      <details className="challenge-backing">
        <summary>{t('sight.accompaniment')}{(drone || accompaniment.length > 0) && <span>{t('sight.accompanimentOn')}</span>}</summary>
        <p id={`${id}-headphones`}>{t('sight.headphones')}</p>
        <label><input type="checkbox" checked={drone} aria-describedby={`${id}-headphones`} onChange={event => setDrone(event.target.checked)} />{t('sight.drone', { pitch: pitchName(melody.tonic) })}</label>
        {otherVoices.length > 0 && <fieldset><legend>{t('sight.otherVoices')}</legend>
          {otherVoices.map(option => <label key={option.voice.id}>
            <input type="checkbox" checked={backing.includes(option.voice.id)} onChange={event => {
              const checked = event.target.checked, voiceId = option.voice.id;
              setBacking(previous => checked ? [...previous, voiceId] : previous.filter(value => value !== voiceId));
            }} />{option.label}
          </label>)}
        </fieldset>}
      </details>
    </div>}
    <div className="challenge-stage">
      <div role="status">{previewing ? t('sight.playingReference')
        : state.phase === 'count' ? t('sight.count', { count: state.count })
        : state.phase === 'permission' ? t('sight.waitingMicrophone')
        : state.phase === 'sing' ? t('sight.singNow')
        : state.phase === 'result' ? state.take.percent === null ? t('sight.takeComplete') : t('sight.takeScore', { score: state.take.percent })
        : t('sight.ready')}</div>
      {state.phase === 'count' && <div className="challenge-count" aria-hidden="true">
        {Array.from({ length: melody.beats }, (_, index) => <span key={index} data-passed={index <= melody.beats - state.count} />)}
      </div>}
      {state.phase === 'sing' && <div className="challenge-pitches">
        <span>{visitLabel(measure.visit)}</span>
        <span>{target ? t('sight.currentTarget', { pitch: pitchList(targetPitches(target)) }) : t('sight.rest')}</span>
        <span>{state.frame.midi === null ? t('sight.noPitch') : t('sight.currentPitch', { pitch: pitchName(Math.round(state.frame.midi)) })}</span>
      </div>}
      {state.phase === 'result' && <span className="challenge-pitches">{state.take.voiceName}</span>}
    </div>
    <div className="challenge-actions">
      {state.phase === 'idle' && !busy && <>
        <button className="secondary-button" type="button" onClick={() => preview(true)}><Volume2 size={17} aria-hidden="true" />{t('sight.startingNote')}</button>
        <button className="secondary-button" type="button" onClick={() => preview(false)}><Play size={17} aria-hidden="true" />{t('sight.listen')}</button>
        <button className="primary-button" type="button" onClick={start}><Mic size={17} aria-hidden="true" />{t('sight.start')}</button>
      </>}
      {state.phase === 'result' && <>
        <button className="primary-button" type="button" onClick={start}><RotateCcw size={17} aria-hidden="true" />{t('sight.retry')}</button>
        <button className="secondary-button" type="button" onClick={configureTake}>{t('sight.practiceSetup')}</button>
      </>}
      {(recording || previewing) && <button className="secondary-button" type="button" onClick={cancel}><Square size={17} aria-hidden="true" />{t('sight.stop')}</button>}
    </div>
    {error && <p className="challenge-error" role="alert">{t(`sight.${error}`)}</p>}
    <ChallengeNotation score={document.score} voice={voice} melody={melody} currentBar={measure.bar}
      beatIndex={target?.bar === measure.bar ? target.beatIndex : undefined} />
    <PitchGraph melody={melody} frames={'frames' in state ? state.frames : emptyFrames} elapsed={elapsed} review={state.phase === 'result'} />
    {state.phase === 'result' && <section className="challenge-review" aria-labelledby={`${id}-review`}>
      <h3 id={`${id}-review`}>{t('sight.review')}</h3>
      {state.take.total > 0 && <p>{t('sight.summary', { matched: state.take.matched, total: state.take.total })}</p>}
      {unscored > 0 && <p>{t('sight.unscoredCount', { count: unscored })}</p>}
      {historyError && <p role="alert" className="challenge-error">{t('sight.historyError')}</p>}
      <label className="challenge-answer"><input type="checkbox" checked={answer !== 'off'} disabled={answer === 'loading'}
        onChange={event => void compareAnswer(event.target.checked)} />{t('sight.pianoAnswer')}</label>
      {answer === 'loading' && <p role="status">{t('sight.mixingAnswer')}</p>}
      <audio ref={replay} controls controlsList="nodownload noremoteplayback" preload="metadata" src={typeof answer === 'object' ? answer.url : state.url} aria-label={t('sight.replay')}
        onLoadedMetadata={event => {
          if (seekOnMetadata.current === null) return;
          event.currentTarget.currentTime = seekOnMetadata.current;
          seekOnMetadata.current = null;
        }}
        onTimeUpdate={event => setReplayTime(event.currentTarget.currentTime)}
        onPlay={() => { const stop = run.current; run.current = null; stop?.(); setPreviewing(false); }} />
      <p className="challenge-feedback-guide">{t('sight.feedbackGuide')}</p>
      <FeedbackTable notes={state.take.notes} active={state.review.findIndex(row => row.note === target)} onPlay={index => playFrom(state.review[index].note.start)} />
    </section>}
  </div>;
}
