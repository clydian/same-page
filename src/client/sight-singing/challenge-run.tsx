import { Mic, Music2, RotateCcw, SlidersHorizontal, Square, Volume2 } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useMessages } from '../../i18n';
import { holdUpdate } from '../updates/update-safety';
import { beginCapture, mixPianoAnswer, playMelody, type CaptureError } from './challenge-audio';
import { ChallengeNotation } from './challenge-notation';
import { ChallengeSettings } from './challenge-settings';
import { PitchGraph } from './pitch-graph';
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
  | { phase: 'sing'; frame: PitchFrame; frames: PitchFrame[] }
  | { phase: 'result'; frames: PitchFrame[]; url: string; recording: Blob; review: ReturnType<typeof assessNotes>; take: TakeFeedback };

export function ChallengeRun({ document, selected, voices, backingUnavailable, selectVoice, visitLabel, onTake }: {
  document: MelodyScore; selected: VoiceOption; voices: VoiceOption[]; backingUnavailable: boolean; selectVoice: (id: string) => void;
  visitLabel: (index: number) => string; onTake: (take: TakeFeedback) => Promise<void>;
}) {
  const t = useMessages('practice');
  const id = useId();
  const { voice, melody } = selected;
  const [drone, setDrone] = useState(false);
  const [backing, setBacking] = useState(false);
  const settings = useRef<HTMLDialogElement>(null);
  const accompaniment = backing && !backingUnavailable ? voices.filter(option => option.voice.id !== voice.id) : [];
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
      onFrame: frame => {
        frames.push(frame);
        setState({ phase: 'sing', frame, frames });
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
    }, drone || accompaniment.length ? { drone, others: accompaniment.map(option => option.melody.notes) } : undefined);
    run.current = () => { stop(); releaseUpdate(); };
  };
  const cancel = () => { release(); setPreviewing(false); setState(current => current.phase === 'result' ? current : { phase: 'idle' }); };
  const configureTake = () => {
    discard();
    setState({ phase: 'idle' });
    setAnswer('off');
    setReplayTime(0);
    setError(null);
    settings.current?.showModal();
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
  // The detected voice and target use the center of the same capture window.
  const position = state.phase === 'sing' ? state.frame.time : state.phase === 'result' ? replayTime : 0;
  const measure = melody.measures.find(bar => position < bar.end) ?? melody.measures[melody.measures.length - 1];
  const target = melody.notes.find(note => note.start <= position && position < note.end);
  const busy = recording || previewing;
  const unscored = state.phase === 'result' ? state.take.notes.length - state.take.total : 0;

  return <div className="challenge-run" data-phase={state.phase}>
    <ChallengeNotation score={document.score} voice={voice} melody={melody} currentBar={state.phase === 'idle' ? undefined : measure.bar}
      beatIndex={target?.bar === measure.bar ? target?.beatIndex : undefined} />
    <div className="challenge-transport" data-ready={state.phase === 'idle' && !busy}>
      {state.phase === 'idle' && !busy && <>
        <div className="challenge-tools">
          <button className="challenge-tool" type="button" onClick={() => preview(true)}><Music2 size={18} aria-hidden="true" />{t('sight.startingNoteShort')}</button>
          <button className="challenge-tool" type="button" onClick={() => preview(false)}><Volume2 size={18} aria-hidden="true" />{t('sight.listenShort')}</button>
          <button className="challenge-tool challenge-tool-settings" type="button" aria-haspopup="dialog" onClick={() => settings.current?.showModal()}
            aria-label={`${t('sight.practiceSetup')} · ${selected.label}`} title={t('sight.practiceSetup')}>
            <SlidersHorizontal size={18} aria-hidden="true" /><span>{selected.label}</span>
          </button>
        </div>
        <button className="primary-button challenge-start" type="button" onClick={start}><Mic size={18} aria-hidden="true" />{t('sight.start')}</button>
      </>}
      {busy && <>
        <div className="challenge-stage">
          <div role="status">{previewing ? t('sight.playingReference') : state.phase === 'count' ? t('sight.count', { count: state.count })
            : state.phase === 'permission' ? t('sight.waitingMicrophone') : t('sight.singNow')}</div>
          {state.phase === 'count' && <div className="challenge-count" aria-hidden="true">
            {Array.from({ length: melody.beats }, (_, index) => <span key={index} data-passed={index <= melody.beats - state.count} />)}
          </div>}
        </div>
        <button className="secondary-button challenge-stop" type="button" onClick={cancel}><Square size={15} aria-hidden="true" />{t('sight.stop')}</button>
      </>}
      {state.phase === 'result' && <>
        <div className="challenge-stage challenge-score" role="status"><strong>{state.take.percent === null ? t('sight.takeComplete') : t('sight.takeScore', { score: state.take.percent })}</strong><span>{state.take.voiceName}</span></div>
        <div className="challenge-result-tools">
          <button className="challenge-tool" type="button" aria-haspopup="dialog" aria-label={t('sight.practiceSetup')} title={t('sight.practiceSetup')} onClick={configureTake}><SlidersHorizontal size={18} aria-hidden="true" /></button>
          <button className="primary-button challenge-start" type="button" onClick={start}><RotateCcw size={18} aria-hidden="true" />{t('sight.retry')}</button>
        </div>
      </>}
    </div>
    <ChallengeSettings dialog={settings} selected={selected} voices={voices} selectVoice={selectVoice}
      drone={drone} setDrone={setDrone} backing={backing} setBacking={setBacking} backingUnavailable={backingUnavailable} />
    {error && <p className="challenge-error" role="alert">{t(`sight.${error}`)}</p>}
    {(state.phase === 'count' || state.phase === 'sing' || state.phase === 'result') && <PitchGraph melody={melody}
      frames={'frames' in state ? state.frames : emptyFrames} elapsed={position} activePitch={state.phase === 'sing' ? state.frame.midi : null}
      activeTarget={state.phase === 'sing' && target ? pitchList(targetPitches(target)) : undefined} />}
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
      <p className="challenge-feedback-guide">{t('sight.recordingPrivacy')}</p>
      <FeedbackTable notes={state.take.notes} active={state.review.findIndex(row => row.note === target)} onPlay={index => playFrom(state.review[index].note.start)} />
    </section>}
  </div>;
}
