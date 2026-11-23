import { Mic, Play, RotateCcw, Square, Volume2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  const playFrom = (time: number) => {
    const audio = replay.current;
    if (!audio) return;
    setError(null);
    audio.currentTime = time;
    setReplayTime(time);
    void audio.play().catch(() => setError('audioFailure'));
  };
  const recording = state.phase === 'permission' || state.phase === 'count' || state.phase === 'sing';
  const elapsed = state.phase === 'sing' ? state.elapsed : state.phase === 'result' ? replayTime : 0;
  // Compare the displayed voice with the target at the center of the same capture window.
  const position = state.phase === 'sing' ? state.frame.time : elapsed;
  const measure = melody.measures.find(bar => position < bar.end) ?? melody.measures[melody.measures.length - 1];
  const target = melody.notes.find(note => note.start <= position && position < note.end);
  const captured = state.phase === 'result' ? state.frames : null;
  const review = useMemo(() => captured && assessNotes(melody.notes, captured), [melody.notes, captured]);
  const unscored = review?.filter(row => row.status === 'insufficientData').length ?? 0;
  const signed = (cents: number) => cents > 0 ? `+${cents}` : String(cents);
  const missing = '—';

  return <div className="challenge-run">
    <div className="challenge-stage">
      <div role="status">{previewing ? t('sight.playingReference')
        : state.phase === 'count' ? t('sight.count', { count: state.count })
        : state.phase === 'permission' ? t('sight.waitingMicrophone')
        : state.phase === 'sing' ? t('sight.singNow')
        : state.phase === 'result' ? t('sight.takeComplete')
        : t('sight.ready')}</div>
      {state.phase === 'count' && <div className="challenge-count" aria-hidden="true">
        {Array.from({ length: melody.beats }, (_, index) => <span key={index} data-passed={index <= melody.beats - state.count} />)}
      </div>}
      {state.phase === 'sing' && <div className="challenge-pitches">
        <span>{visitLabel(measure.visit)}</span>
        <span>{target ? t('sight.currentTarget', { pitch: pitchName(target.midi) }) : t('sight.rest')}</span>
        <span>{state.frame.midi === null ? t('sight.noPitch') : t('sight.currentPitch', { pitch: pitchName(Math.round(state.frame.midi)) })}</span>
      </div>}
    </div>
    <div className="challenge-actions">
      {!recording && !previewing && <>
        <button className="secondary-button" type="button" onClick={() => preview(true)}><Volume2 size={17} aria-hidden="true" />{t('sight.startingNote')}</button>
        <button className="secondary-button" type="button" onClick={() => preview(false)}><Play size={17} aria-hidden="true" />{t('sight.listen')}</button>
        <button className="primary-button" type="button" onClick={start}>{state.phase === 'result' ? <RotateCcw size={17} aria-hidden="true" /> : <Mic size={17} aria-hidden="true" />}{t(state.phase === 'result' ? 'sight.retry' : 'sight.start')}</button>
      </>}
      {(recording || previewing) && <button className="secondary-button" type="button" onClick={cancel}><Square size={17} aria-hidden="true" />{t('sight.stop')}</button>}
    </div>
    {error && <p className="challenge-error" role="alert">{t(`sight.${error}`)}</p>}
    <ChallengeNotation score={document.score} voice={voice} melody={melody} currentBar={measure.bar}
      beatIndex={target?.bar === measure.bar ? target.beatIndex : undefined} />
    <PitchGraph melody={melody} frames={'frames' in state ? state.frames : emptyFrames} elapsed={elapsed} review={state.phase === 'result'} />
    {state.phase === 'result' && review && <section className="challenge-review" aria-labelledby="challenge-review-title">
      <h3 id="challenge-review-title">{t('sight.review')}</h3>
      {review.length > unscored && <p>{t('sight.summary', { matched: review.filter(row => row.status === 'inTune').length, total: review.length - unscored })}</p>}
      {unscored > 0 && <p>{t('sight.unscoredCount', { count: unscored })}</p>}
      <audio ref={replay} controls controlsList="nodownload noremoteplayback" preload="metadata" src={state.url} aria-label={t('sight.replay')}
        onTimeUpdate={event => setReplayTime(event.currentTarget.currentTime)}
        onPlay={() => { const stop = run.current; run.current = null; stop?.(); setPreviewing(false); }} />
      <p className="challenge-feedback-guide">{t('sight.feedbackGuide')}</p>
      <div className="challenge-results" tabIndex={0} role="region" aria-label={t('sight.noteFeedback')}>
        <table><thead><tr>
          <th scope="col">{t('sight.measure')}</th><th scope="col">{t('sight.expected')}</th><th scope="col">{t('sight.feedback')}</th>
          <th scope="col">{t('sight.sung')}</th><th scope="col">{t('sight.pitchError')}</th><th scope="col">{t('sight.intervalError')}</th>
        </tr></thead><tbody>{review.map(({ note, sung, cents, interval, status }, index) => <tr key={note.start} data-active={note === target}>
          <td>{visitLabel(note.visit)}</td>
          <td><button className="challenge-note-replay" type="button" onClick={() => playFrom(note.start)}
            aria-label={t('sight.replayFromNote', { index: index + 1, pitch: pitchName(note.midi) })}>
            <Play size={15} aria-hidden="true" />{pitchName(note.midi)}
          </button></td>
          <td data-result>{t(`sight.${status}`)}</td><td>{sung === null ? missing : pitchName(Math.round(sung))}</td>
          <td>{cents === null ? missing : signed(cents)}</td><td>{interval === null ? missing : signed(interval)}</td>
        </tr>)}</tbody></table>
      </div>
    </section>}
  </div>;
}
