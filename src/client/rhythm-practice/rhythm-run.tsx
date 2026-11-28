import { Drum, Play, RotateCcw, Square } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { useMessages } from '../../i18n';
import { loadPracticeClicks, practiceBeatAccent, schedulePracticeClicks } from '../playback/practice-metronome';
import { ChallengeNotation } from '../sight-singing/challenge-notation';
import type { MelodyScore, MelodyVoice } from '../sight-singing/melody';
import type { RhythmMark } from './review-marks';
import { acceptsRhythmTap, lockRhythmTiming, rhythmElapsed, scoreRhythm, type RhythmRunTiming, type RhythmScore } from './scoring';
import type { RhythmTimeline } from './timeline';
import './rhythm-run.css';

export type RhythmOption = { voice: MelodyVoice; timeline: RhythmTimeline; label: string };
type Run = {
  context: AudioContext; timing: RhythmRunTiming; targets: number[]; taps: number[];
  startStamp: number; countDuration: number; frame?: number; stopClicks?: () => void;
};
type Phase = 'ready' | 'loading' | 'count' | 'tap' | 'review';
type View = { phase: Phase; elapsed: number; count: number };

const ready: View = { phase: 'ready', elapsed: 0, count: 0 };
const reviewStatuses = ['onTime', 'early', 'late', 'missed', 'extra'] as const;
const slowSpeed = .75;
const beatGlyph: Partial<Record<number, string>> = { 2: '𝅗𝅥', 4: '♩', 8: '♪', 16: '𝅘𝅥𝅯' };

export function RhythmRun({ document: scoreDocument, selected, voices, selectVoice, visitLabel }: {
  document: MelodyScore; selected: RhythmOption; voices: RhythmOption[]; selectVoice: (id: string) => void;
  visitLabel: (index: number) => string;
}) {
  const t = useMessages('practice');
  const { timeline, voice } = selected;
  const active = useRef<Run>(null);
  const pad = useRef<HTMLButtonElement>(null);
  const [view, setView] = useState<View>(ready);
  const [review, setReview] = useState<{ score: RhythmScore; timing: RhythmRunTiming }>();
  const [reviewVisit, setReviewVisit] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [attempt, setAttempt] = useState(0);
  const [failure, setFailure] = useState(false);

  const stop = () => {
    const run = active.current;
    if (!run) return;
    active.current = null;
    if (run.frame !== undefined) cancelAnimationFrame(run.frame);
    run.stopClicks?.();
    if (run.context.state !== 'closed') void run.context.close().catch(() => undefined);
  };

  const capture = (stamp: number) => {
    const run = active.current;
    if (!run || !Number.isFinite(run.startStamp)) return;
    const time = rhythmElapsed(stamp, run.startStamp);
    if (acceptsRhythmTap(time, run.targets[0], run.timing)) run.taps.push(time);
  };

  useEffect(() => {
    const keyDown = (event: KeyboardEvent) => {
      const run = active.current, target = event.target;
      if (!run || !Number.isFinite(run.startStamp) || event.defaultPrevented || event.isComposing ||
        event.code !== 'Space' && event.key !== ' ' || event.altKey || event.ctrlKey || event.metaKey) return;
      if (target instanceof Element && target !== pad.current &&
        target.closest('button, a, input, select, textarea, summary, [contenteditable], [role="button"]')) return;
      event.preventDefault();
      if (!event.repeat) capture(event.timeStamp);
    };
    const hide = () => {
      if (window.document.visibilityState === 'visible' || !active.current) return;
      stop();
      setView(ready);
      setFailure(true);
    };
    window.addEventListener('keydown', keyDown);
    window.document.addEventListener('visibilitychange', hide);
    return () => {
      stop();
      window.removeEventListener('keydown', keyDown);
      window.document.removeEventListener('visibilitychange', hide);
    };
  }, []);

  const start = async (nextSpeed: number) => {
    if (active.current) return;
    setFailure(false);
    let run: Run | undefined;
    try {
      const context = new AudioContext();
      const timing = lockRhythmTiming(nextSpeed, timeline.countBeatSeconds, timeline.duration);
      const period = timeline.countBeatSeconds / nextSpeed;
      run = { context, timing, targets: timeline.targets.map(target => target.time / nextSpeed),
        taps: [], startStamp: NaN, countDuration: timeline.countBeats * period };
      active.current = run;
      const current = run;
      setReview(undefined);
      setSpeed(nextSpeed);
      setAttempt(previous => previous + 1);
      setView({ ...ready, phase: 'loading' });
      const [, buffers] = await Promise.all([context.resume(), loadPracticeClicks(context)]);
      if (active.current !== run) return;
      if (context.state !== 'running') throw new Error('rhythm_audio_unavailable');
      const interrupt = () => {
        if (active.current !== current || context.state === 'running') return;
        stop();
        setView(ready);
        setFailure(true);
      };
      context.addEventListener('statechange', interrupt);
      const countStart = context.currentTime + .12;
      const startAt = countStart + run.countDuration;
      const { performanceTime, contextTime } = context.getOutputTimestamp?.() ?? {};
      run.startStamp = performanceTime && contextTime !== undefined
        ? performanceTime + (startAt - contextTime) * 1000
        : performance.now() + (startAt - context.currentTime) * 1000;
      const countDuration = run.countDuration;
      const clicks = Array.from({ length: timeline.countBeats }, (_, beat) => ({
        time: beat * period - countDuration,
        accent: practiceBeatAccent(beat, timeline.countBeats, timeline.denominator),
      }));
      run.stopClicks = schedulePracticeClicks(context, buffers, startAt,
        [...clicks, ...timeline.clicks.map(click => ({ ...click, time: click.time / nextSpeed }))]);
      const update = (now: number) => {
        if (active.current !== current) return;
        const time = rhythmElapsed(now, current.startStamp);
        // Give an input already queued by the browser time to arrive. Its
        // event timestamp, not the delivery time, determines eligibility.
        if (time >= timing.end + .05) {
          stop();
          setReview({ score: scoreRhythm(current.targets, current.taps, timing), timing });
          setReviewVisit(timeline.measures[0].visit);
          setView({ ...ready, phase: 'review' });
          return;
        }
        const elapsed = Math.max(0, Math.min(timeline.duration, time * nextSpeed));
        const count = Math.max(0, Math.floor((time + current.countDuration) / period) + 1);
        setView(previous => time >= 0 ? { phase: 'tap', elapsed, count: 0 } :
          previous.phase === 'count' && previous.count === count ? previous : { phase: 'count', elapsed: 0, count });
        current.frame = requestAnimationFrame(update);
      };
      run.frame = requestAnimationFrame(update);
    } catch {
      if (run && active.current !== run) return;
      stop();
      setFailure(true);
      setView(ready);
    }
  };

  const marks = useMemo<RhythmMark[] | undefined>(() => {
    if (!review) return;
    const { score, timing } = review;
    return [...score.targets.map(({ time, status }, index) => ({
      ...timeline.targets[index], status, time: time * timing.speed,
    })), ...score.taps.map(({ time, status }) => {
      const at = Math.min(timeline.duration, Math.max(0, time * timing.speed));
      const measure = timeline.measures.find(item => at < item.end) ?? timeline.measures.at(-1)!;
      return { time: at, visit: measure.visit, status };
    })];
  }, [review, timeline]);

  const { phase, elapsed, count } = view;
  const busy = phase === 'count' || phase === 'tap' || phase === 'loading';
  const measure = (phase === 'review' ? timeline.measures.find(item => item.visit === reviewVisit)
    : timeline.measures.find(item => elapsed < item.end)) ?? timeline.measures.at(-1)!;
  const repeats = new Set(timeline.measures.map(item => item.bar)).size < timeline.measures.length;
  const cancel = () => { stop(); setView(ready); };
  const pointerTap = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || !event.isPrimary) return;
    event.preventDefault(); // Keep the current keyboard focus where the user placed it.
    capture(event.timeStamp);
  };
  return <section className="challenge-run rhythm-run" data-phase={phase}>
    <ChallengeNotation score={scoreDocument.score} voice={voice} melody={timeline} measure={measure}
      elapsed={elapsed} positioned={phase === 'tap'} followRun={attempt} attemptReset={attempt}
      bpm={Math.round(timeline.bpm * speed * (beatGlyph[timeline.denominator] ? timeline.denominator / 4 : 1))}
      tempoBeat={beatGlyph[timeline.denominator]} rhythm rhythmMarks={marks} />
    <div className="rhythm-controls">
      {failure && <p role="alert" className="challenge-error">{t('rhythm.audioInterrupted')}</p>}
      {busy ? <>
        <div className="rhythm-transport">
          <span role="status">{phase === 'loading' ? t('sight.loading') : phase === 'count' ? t('rhythm.countIn') : t('rhythm.playing')}</span>
          {phase === 'count' && <div className="challenge-count" aria-hidden="true">
            {Array.from({ length: timeline.countBeats }, (_, index) => <span key={index} data-passed={index < count} />)}
          </div>}
          <button type="button" className="icon-button" aria-label={t('rhythm.stop')} onClick={cancel}><Square size={17} aria-hidden="true" /></button>
        </div>
        <button ref={pad} type="button" className="primary-button rhythm-pad" onPointerDown={pointerTap}
          onClick={event => { if (event.detail === 0) capture(event.timeStamp); }}>
          <Drum size={22} aria-hidden="true" />{t('rhythm.tap')} <kbd>{t('rhythm.space')}</kbd>
        </button>
      </> : <>
        {review ? <>
          <details className="rhythm-summary" open>
            <summary>{t('rhythm.result', { hits: review.score.counts.onTime, total: timeline.targets.length })}</summary>
            <ul className="rhythm-counts" role="list">
              {reviewStatuses.slice(1).map(status => <li key={status} data-status={status}>
                {t(`rhythm.${status}`)} <b>{review.score.counts[status]}</b>
              </li>)}
            </ul>
            <div className="rhythm-legend">
              <span><i data-mark="target" />{t('rhythm.target')}</span>
              <span><i data-mark="tap" />{t('rhythm.tapMark')}</span>
              <span>{t('rhythm.threshold', { ms: Math.round(review.timing.threshold * 1000) })}</span>
              {repeats && <select aria-label={t('rhythm.reviewVisit')} value={reviewVisit} onChange={event => setReviewVisit(Number(event.target.value))}>
                {timeline.measures.map(item => <option key={item.visit} value={item.visit}>{visitLabel(item.visit)}</option>)}
              </select>}
            </div>
          </details>
          <div className="rhythm-actions">
            <button type="button" className="primary-button" onClick={() => void start(1)}>
              <RotateCcw size={17} aria-hidden="true" />{t('rhythm.retry')}
            </button>
            <button type="button" className="secondary-button" onClick={() => void start(slowSpeed)}>{t('rhythm.slowRetry')}</button>
            {voices.length > 1 && <select aria-label={t('sight.voice')} value={voice.id} onChange={event => selectVoice(event.target.value)}>
              {voices.map(option => <option key={option.voice.id} value={option.voice.id}>{option.label}</option>)}
            </select>}
          </div>
        </> : <>
          <p className="rhythm-instructions">{t('rhythm.instructions')}</p>
          <div className="rhythm-actions">
            <button type="button" className="primary-button" onClick={() => void start(1)}>
              <Play size={17} aria-hidden="true" />{t('rhythm.start')}
            </button>
            {voices.length > 1 && <select aria-label={t('sight.voice')} value={voice.id} onChange={event => selectVoice(event.target.value)}>
              {voices.map(option => <option key={option.voice.id} value={option.voice.id}>{option.label}</option>)}
            </select>}
          </div>
        </>}
      </>}
    </div>
  </section>;
}
