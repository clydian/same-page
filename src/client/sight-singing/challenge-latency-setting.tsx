import { playbackAudioSession } from '@same-page/player/playback-audio-session';
import { Minus, Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useMessages } from '../../i18n';
import { PracticeDisclosure, PracticeHelp } from '../playback/practice-setting';
import { measureRecordingLatency } from './challenge-audio';
import { latencyStepMs, recordingLatency, recordingMarginMs } from './recording-latency';

export function ChallengeLatencySetting({ value, onChange, audioBusy, onMeasure }: {
  value: number; onChange: (value: number) => void; audioBusy: boolean;
  onMeasure: (busy: boolean) => void;
}) {
  const t = useMessages('practice');
  const summary = t('sight.latency.value', { ms: value });
  return <div className="challenge-latency-setting"><PracticeDisclosure title={t('sight.latency.title')} summary={summary}>
    <LatencyControls value={value} onChange={onChange} audioBusy={audioBusy} onMeasure={onMeasure} />
  </PracticeDisclosure></div>;
}

export function LatencyControls({ value, onChange, audioBusy, onMeasure, showDirection }: {
  value: number; onChange: (value: number) => void; audioBusy: boolean; onMeasure: (busy: boolean) => void; showDirection?: boolean;
}) {
  const t = useMessages('practice');
  const [status, setStatus] = useState<'idle' | 'measuring' | 'failed'>('idle');
  const running = useRef<AbortController | null>(null);
  useEffect(() => {
    const stop = () => { if (document.visibilityState === 'hidden') running.current?.abort(); };
    document.addEventListener('visibilitychange', stop);
    return () => {
      document.removeEventListener('visibilitychange', stop);
      running.current?.abort();
    };
  }, []);
  const measure = async () => {
    if (running.current || audioBusy) return;
    const controller = new AbortController();
    running.current = controller;
    const session = playbackAudioSession();
    session.request('play-and-record');
    setStatus('measuring');
    onMeasure(true);
    try {
      const latency = await measureRecordingLatency(AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]));
      if (controller.signal.aborted) return;
      if (latency !== null) onChange(latency);
      setStatus(latency === null ? 'failed' : 'idle');
    } catch {
      setStatus(controller.signal.aborted ? 'idle' : 'failed');
    } finally {
      running.current = null;
      session.release();
      onMeasure(false);
    }
  };
  const title = t('sight.latency.title');
  const set = (next: number) => {
    setStatus('idle');
    onChange(recordingLatency(next));
  };
  const measuring = status === 'measuring';
  const direction = value === 0 ? t('sight.latency.zero')
    : t(value > 0 ? 'sight.latency.ahead' : 'sight.latency.behind', { ms: Math.abs(value) });
  return <div className="challenge-latency-controls" data-show-direction={showDirection || undefined}>
    <div className="challenge-latency-stepper" role="group" aria-label={title}>
      <button type="button" className="icon-button" aria-label={t('sight.latency.less')}
        disabled={measuring || value <= -recordingMarginMs} onClick={() => set(value - latencyStepMs)}><Minus size={16} aria-hidden="true" /></button>
      {showDirection && <span className="challenge-latency-value" aria-hidden="true">{direction}</span>}
      <input type="range" aria-label={title} aria-valuetext={direction}
        min={-recordingMarginMs} max={recordingMarginMs} value={value} disabled={measuring}
        onChange={event => set(event.currentTarget.valueAsNumber)} />
      <button type="button" className="icon-button" aria-label={t('sight.latency.more')}
        disabled={measuring || value >= recordingMarginMs} onClick={() => set(value + latencyStepMs)}><Plus size={16} aria-hidden="true" /></button>
    </div>
    <div className="challenge-latency-actions">
      <button type="button" className="secondary-button" disabled={audioBusy || measuring} onClick={() => void measure()}>
        {t(measuring ? 'sight.latency.measuring' : 'sight.latency.measure')}</button>
      <PracticeHelp title={title}>{t('sight.latency.help')}</PracticeHelp>
      <button type="button" className="secondary-button challenge-latency-reset" disabled={measuring || value === 0} onClick={() => set(0)}>{t('sight.latency.reset')}</button>
    </div>
    {status === 'failed' && <small role="status">{t('sight.latency.failed')}</small>}
  </div>;
}
