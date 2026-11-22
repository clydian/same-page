import { Mic, Play, RotateCcw, Square, Volume2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useMessages } from '../../i18n';
import { holdUpdate } from '../updates/update-safety';
import { beginCapture, playMelody, type CaptureError } from './challenge-audio';
import { ChallengeNotation, PitchGraph } from './challenge-notation';
import type { Melody, MelodyScore, MelodyVoice } from './melody';
import { assessNotes, pitchName, type PitchFrame } from './pitch-feedback';

const emptyFrames: PitchFrame[] = [];
type RunState = { phase: 'idle' | 'permission' }
  | { phase: 'count'; count: number }
  | { phase: 'sing'; elapsed: number; frame: PitchFrame; frames: PitchFrame[] }
  | { phase: 'result'; frames: PitchFrame[]; url: string };

export function ChallengeRun({ document, voice, melody, visitLabel }: {
  document: MelodyScore; voice: MelodyVoice; melody: Melody; visitLabel: (index: number) => string;
}) {
  const t = useMessages('practice');
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
    discard(); setReplayTime(0); setError(null); setState({ phase: 'permission' });
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
        setState({ phase: 'result', frames: result, url });
      },
      onError: reason => { releaseUpdate(); release(); setError(reason); setState({ phase: 'idle' }); },
    });
    run.current = () => { stop(); releaseUpdate(); };
  };
  const cancel = () => { release(); setPreviewing(false); setState(current => current.phase === 'result' ? current : { phase: 'idle' }); };
  const recording = state.phase === 'permission' || state.phase === 'count' || state.phase === 'sing';
  const elapsed = state.phase === 'sing' ? state.elapsed : state.phase === 'result' ? replayTime : 0;
  const measure = melody.measures[melody.measures.findIndex(bar => elapsed < bar.end)] ?? melody.measures[melody.measures.length - 1];
  const target = melody.notes.find(note => note.start <= elapsed && elapsed < note.end);
  const review = state.phase === 'result' ? assessNotes(melody.notes, state.frames) : null;
  const signed = (cents: number) => cents > 0 ? `+${cents}` : String(cents);
  const missing = '—';

  return <div className="challenge-run">
    <ChallengeNotation score={document.score} voice={voice} melody={melody} currentBar={measure.bar} />
    <div className="challenge-stage" aria-live="polite">
      {previewing ? t('sight.playingReference')
        : state.phase === 'count' ? t('sight.count', { count: state.count })
        : state.phase === 'permission' ? t('sight.waitingMicrophone')
        : state.phase === 'sing' ? t('sight.singNow')
        : state.phase === 'result' ? t('sight.takeComplete')
        : t('sight.ready')}
    </div>
    {state.phase === 'sing' && <div className="challenge-pitches">
      <span>{visitLabel(measure.visit)}</span>
      <span>{target ? t('sight.currentTarget', { pitch: pitchName(target.midi) }) : t('sight.rest')}</span>
      <span>{state.frame.midi === null ? t('sight.noPitch') : t('sight.currentPitch', { pitch: pitchName(Math.round(state.frame.midi)) })}</span>
    </div>}
    <PitchGraph melody={melody} frames={'frames' in state ? state.frames : emptyFrames} elapsed={elapsed} review={state.phase === 'result'} />
    <div className="challenge-actions">
      {!recording && !previewing && <>
        <button className="secondary-button" type="button" onClick={() => preview(true)}><Volume2 size={17} aria-hidden="true" />{t('sight.startingNote')}</button>
        <button className="secondary-button" type="button" onClick={() => preview(false)}><Play size={17} aria-hidden="true" />{t('sight.listen')}</button>
        <button className="primary-button" type="button" onClick={start}>{state.phase === 'result' ? <RotateCcw size={17} aria-hidden="true" /> : <Mic size={17} aria-hidden="true" />}{t(state.phase === 'result' ? 'sight.retry' : 'sight.start')}</button>
      </>}
      {(recording || previewing) && <button className="secondary-button" type="button" onClick={cancel}><Square size={17} aria-hidden="true" />{t('sight.stop')}</button>}
    </div>
    {error && <p className="challenge-error" role="alert">{t(`sight.${error}`)}</p>}
    {state.phase === 'result' && review && <section className="challenge-review" aria-labelledby="challenge-review-title">
      <h3 id="challenge-review-title">{t('sight.review')}</h3>
      <p>{t('sight.summary', { matched: review.filter(row => row.status === 'inTune').length, total: review.length })}</p>
      <audio ref={replay} controls controlsList="nodownload noremoteplayback" preload="metadata" src={state.url} aria-label={t('sight.replay')}
        onTimeUpdate={event => setReplayTime(event.currentTarget.currentTime)}
        onPlay={() => { const stop = run.current; run.current = null; stop?.(); setPreviewing(false); }} />
      <div className="challenge-results">
        <table aria-label={t('sight.noteFeedback')}><thead><tr>
          <th scope="col">{t('sight.measure')}</th><th scope="col">{t('sight.expected')}</th><th scope="col">{t('sight.sung')}</th>
          <th scope="col">{t('sight.pitchError')}</th><th scope="col">{t('sight.intervalError')}</th><th scope="col">{t('sight.feedback')}</th>
        </tr></thead><tbody>{review.map(({ note, sung, cents, interval, status }) => <tr key={note.start}>
          <td>{visitLabel(note.visit)}</td><td>{pitchName(note.midi)}</td><td>{sung === null ? missing : pitchName(Math.round(sung))}</td>
          <td>{cents === null ? missing : signed(cents)}</td><td>{interval === null ? missing : signed(interval)}</td><td>{t(`sight.${status}`)}</td>
        </tr>)}</tbody></table>
      </div>
    </section>}
  </div>;
}
