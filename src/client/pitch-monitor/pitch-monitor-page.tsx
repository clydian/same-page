import { playbackAudioSession } from '@same-page/player/playback-audio-session';
import { ChevronDown, Circle, Play, Square } from 'lucide-react';
import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { useMessages } from '../../i18n';
import { LoadingStatus } from '../components/loading-status';
import { pcm16, waveFile } from '../playback/pcm-audio';
import { holdUpdate } from '../updates/update-safety';
import type { PitchMode } from '../sight-singing/live-pitch';
import { formatCents, pitchName, type PitchFrame } from '../sight-singing/pitch-feedback';
import { createPitchViewport } from '../sight-singing/pitch-viewport';
import { firstFrameAt, pitchFramesConnect } from '../sight-singing/pitch-trace';
import { keyPitchClasses, pitchClass } from '../sight-singing/staff-pitch';
import { openPitchInput } from './pitch-input';
import { monitorColors, useMonitorAppearance } from './pitch-monitor-appearance';
import { BeatGridSettings, MonitorAppearanceSettings } from './pitch-monitor-settings';
import { PitchMonitorShell } from './pitch-monitor-shell';

const seconds = 6, semitones = 24, recordLimit = 180;
const majorKeys = ['C♭', 'G♭', 'D♭', 'A♭', 'E♭', 'B♭', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F♯', 'C♯'];
const minorKeys = ['A♭', 'E♭', 'B♭', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F♯', 'C♯', 'G♯', 'D♯', 'A♯'];
const empty: PitchFrame = { time: 0, midi: null };
type Take = { url: string; frames: PitchFrame[]; mode: PitchMode };
type Recording = { mode: PitchMode; frames: PitchFrame[]; pcm: ArrayBuffer[]; length: number; rate: number; startTime: number; source?: PitchFrame[]; release: () => void };

function visibleFrames(frames: PitchFrame[], time: number) {
  return frames.slice(firstFrameAt(frames, time - seconds), firstFrameAt(frames, time + 1e-7));
}

function appendRecordedFrames(take: Recording, frames: PitchFrame[], through: number) {
  const previous = take.frames.at(-1);
  const from = take.startTime + (previous ? previous.time + 1e-7 : 0);
  for (let i = firstFrameAt(frames, from); i < frames.length && frames[i].time <= through; i++) {
    const { time, midi } = frames[i];
    take.frames.push({ time: time - take.startTime, midi });
  }
}

function PitchPlot({ frames, current, center, label, signature, tonic, beatBpm }: {
  frames: PitchFrame[]; current: PitchFrame; center: number; label: string;
  signature: number; tonic: number; beatBpm?: number;
}) {
  const right = current.time, bottom = center - semitones / 2;
  const left = right - seconds;
  const interval = beatBpm ? 60 / beatBpm : 0;
  const firstBeat = interval ? Math.ceil(left / interval) : 0;
  const beatCount = interval ? Math.floor(right / interval) - firstBeat + 1 : 0;
  const x = (time: number) => (time - left) * 100 / seconds;
  const scale = useMemo(() => keyPitchClasses(signature), [signature]);
  const y = (midi: number) => (bottom + semitones - midi) * 100 / semitones;
  const firstNote = Math.floor(bottom + semitones);
  const lines = Array.from({ length: firstNote - Math.ceil(bottom) + 1 }, (_, i) => firstNote - i);
  let path = '', previous: PitchFrame | undefined;
  for (const frame of frames) {
    if (frame.midi === null) { previous = undefined; continue; }
    const position = `${x(frame.time).toFixed(2)} ${y(frame.midi).toFixed(2)}`;
    path += previous && pitchFramesConnect(previous, frame) ? `L${position} ` : `M${position}h.03 `;
    previous = frame;
  }
  return <div className="pitch-monitor-plot" role="img" aria-label={label}>
    <div className="pitch-monitor-axis" aria-hidden="true">
      {lines.filter(midi => scale.has(pitchClass(midi))).map(midi => <span key={midi}
        className={pitchClass(midi) === tonic ? 'pitch-monitor-tonic-label' : undefined}
        style={{ top: `${y(midi)}%` }}>{pitchName(midi)}</span>)}
    </div>
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      {Array.from({ length: Math.max(0, beatCount) }, (_, i) => {
        const beat = firstBeat + i, position = x(beat * interval);
        return <line className="pitch-monitor-beat" key={beat} x1={position} x2={position}
          y1="0" y2="100" vectorEffect="non-scaling-stroke" />;
      })}
      {lines.map(midi => {
        const noteClass = pitchClass(midi);
        const level = noteClass === tonic ? 'tonic' : scale.has(noteClass) ? 'scale' : 'chromatic';
        return <line key={midi} className={`pitch-monitor-${level}`} x1="0" x2="100"
          y1={y(midi)} y2={y(midi)} vectorEffect="non-scaling-stroke" />;
      })}
      <path d={path} vectorEffect="non-scaling-stroke" />
    </svg>
  </div>;
}

export default function PitchMonitorPage() {
  const t = useMessages('practice');
  const [appearance, setAppearance] = useMonitorAppearance();
  const theme = appearance.mode === 'dark' || appearance.mode === 'light' ? appearance.mode : undefined;
  const [session] = useState(() => playbackAudioSession());
  const [status, setStatus] = useState<'idle' | 'starting' | 'live'>('idle');
  const [resumeListening, setResumeListening] = useState<() => void>();
  const [key, setKey] = useState(7);
  const [mode, setMode] = useState<PitchMode>('clear');
  const liveMode = useRef<PitchMode>('clear');
  const [bpm, setBpm] = useState(120);
  const [showBeats, setShowBeats] = useState(false);
  const [held, setHeld] = useState(false);
  const [recording, setRecording] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [take, setTake] = useState<Take>();
  const [error, setError] = useState<'microphoneDenied' | 'microphoneUnavailable' | 'audioFailure'>();
  const [view, setView] = useState({ frames: [] as PitchFrame[], current: empty, center: 60 });
  const capture = useRef<AbortController | null>(null);
  const live = useRef({ frames: [] as PitchFrame[], current: empty });
  const center = useRef(60);
  const [follow] = useState(createPitchViewport);
  const [motion] = useState(() => matchMedia('(prefers-reduced-motion: reduce)'));
  const hold = useRef(false);
  const activeTake = useRef<Recording | null>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const takeUrl = useRef<string | null>(null);
  const pendingPaint = useRef(0);
  const audition = useRef(false);

  const showLive = (now = performance.now()) => {
    const { frames, current } = live.current;
    center.current = follow.step({ center: center.current, span: semitones, frames,
      through: current.time, now, reducedMotion: motion.matches });
    setView({ frames: visibleFrames(frames, current.time), current, center: center.current });
  };

  useEffect(() => () => {
    const pending = activeTake.current;
    activeTake.current = null;
    pending?.release();
    audition.current = false;
    cancelAnimationFrame(pendingPaint.current);
    capture.current?.abort();
    if (takeUrl.current) URL.revokeObjectURL(takeUrl.current);
    session.release();
  }, [session]);

  const stopRecording = () => {
    const pending = activeTake.current;
    if (!pending) return;
    activeTake.current = null;
    pending.release();
    setRecording(false);
    if (!pending.length) return;
    if (pending.source) appendRecordedFrames(pending, pending.source, pending.startTime + pending.length / pending.rate);
    if (takeUrl.current) URL.revokeObjectURL(takeUrl.current);
    const url = URL.createObjectURL(waveFile(pending.pcm, pending.length, pending.rate));
    takeUrl.current = url;
    setTake({ url, frames: pending.frames, mode: pending.mode });
  };
  const stopListening = () => {
    stopRecording();
    capture.current?.abort();
    capture.current = null;
    cancelAnimationFrame(pendingPaint.current);
    pendingPaint.current = 0;
    session.release();
    setResumeListening(undefined);
    setStatus('idle');
  };
  const record = () => {
    if (activeTake.current) return;
    setError(undefined);
    activeTake.current = { mode: liveMode.current, frames: [], pcm: [], length: 0, rate: 0, startTime: 0, release: holdUpdate() };
    setRecording(true);
  };
  const start = async (withRecording: boolean) => {
    const controller = new AbortController();
    capture.current = controller;
    hold.current = false;
    setHeld(false);
    follow.reset();
    live.current = { frames: [], current: empty };
    setView({ ...live.current, center: center.current });
    setError(undefined);
    setStatus('starting');
    session.request('play-and-record');
    try {
      await openPitchInput(controller.signal, ({ pitch, samples, rate, startTime }) => {
        const current = pitch.current(liveMode.current);
        const frames = pitch.frames(liveMode.current);
        live.current = { frames, current };
        const pending = activeTake.current;
        if (pending) {
          const source = pitch.frames(pending.mode);
          if (!pending.length) {
            pending.startTime = startTime;
            pending.source = source;
          }
          pending.pcm.push(pcm16(samples));
          pending.length += samples.length;
          pending.rate = rate;
          appendRecordedFrames(pending, source, pitch.finalTime(pending.mode));
          if (pending.length >= recordLimit * rate) stopRecording();
        }
        if (!hold.current && !pendingPaint.current) pendingPaint.current = requestAnimationFrame(now => {
          pendingPaint.current = 0;
          if (!hold.current) showLive(now);
        });
      }, () => {
        stopListening();
        setError('audioFailure');
      }, resume => setResumeListening(() => resume));
      if (controller.signal.aborted) return;
      setResumeListening(undefined);
      setStatus('live');
      if (withRecording) record();
    } catch (reason) {
      if (controller.signal.aborted) return;
      stopListening();
      const name = reason instanceof DOMException ? reason.name : '';
      setError(name === 'NotAllowedError' || name === 'SecurityError' ? 'microphoneDenied'
        : name === 'NotFoundError' || name === 'NotSupportedError' ? 'microphoneUnavailable' : 'audioFailure');
    }
  };
  const startListeningOnEntry = useEffectEvent(() => { void start(false); });
  useEffect(() => {
    // Avoid requesting the microphone during a discarded StrictMode effect.
    let mounted = true;
    queueMicrotask(() => { if (mounted) startListeningOnEntry(); });
    return () => { mounted = false; };
  }, []);
  useEffect(() => {
    if (!playing || !take) return;
    let id = 0;
    const draw = (now: number) => {
      const player = audio.current;
      if (!player || player.paused) return;
      const frames = visibleFrames(take.frames, player.currentTime);
      const current = { time: player.currentTime, midi: frames.at(-1)?.midi ?? null };
      center.current = follow.step({ center: center.current, span: semitones,
        frames, through: current.time, now, reducedMotion: motion.matches });
      setView({ frames, current, center: center.current });
      id = requestAnimationFrame(draw);
    };
    id = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(id);
  }, [follow, motion, playing, take]);

  const finishPlayback = () => {
    if (!audition.current) return;
    audition.current = false;
    setPlaying(false);
    session.release();
    void start(false);
  };
  const togglePlay = () => {
    const player = audio.current;
    if (!player) return;
    if (audition.current) { player.pause(); finishPlayback(); return; }
    if (status === 'live') stopListening();
    hold.current = false;
    follow.reset();
    setHeld(false);
    session.request();
    player.currentTime = 0;
    audition.current = true;
    setPlaying(true);
    void player.play().catch(() => {
      if (!audition.current) return;
      finishPlayback();
      setError('audioFailure');
    });
  };
  const signature = key % 15 - 7;
  const minor = key >= 15;
  const tonic = pitchClass(signature * 7 + (minor ? 9 : 0));
  const keyName = t(minor ? 'pitchMonitor.minorKey' : 'pitchMonitor.majorKey', { note: (minor ? minorKeys : majorKeys)[key % 15] });
  const note = view.current.midi !== null && (status === 'live' || held || playing) ? Math.round(view.current.midi) : null;
  const cents = note === null ? 0 : ((view.current.midi ?? note) - note) * 100;
  return <PitchMonitorShell theme={theme} colors={monitorColors(appearance)}>
    <PitchPlot {...view} signature={signature} tonic={tonic} beatBpm={showBeats ? bpm : undefined} label={t('pitchMonitor.graph')} />
    <div className="pitch-monitor-top">
      <label className="pitch-monitor-action pitch-monitor-key">
        <span aria-hidden="true">{keyName}</span>
        <ChevronDown size={12} aria-hidden="true" />
        <select aria-label={t('pitchMonitor.key')} value={key} onChange={event => setKey(Number(event.target.value))}>
          {[majorKeys, minorKeys].map((keys, mode) => <optgroup key={mode} label={t(mode ? 'pitchMonitor.minor' : 'pitchMonitor.major')}>
            {keys.map((name, index) => <option key={name} value={index + mode * 15}>
              {t(mode ? 'pitchMonitor.minorKey' : 'pitchMonitor.majorKey', { note: name })}
            </option>)}
          </optgroup>)}
        </select>
      </label>
      {note !== null && <div className="pitch-monitor-note">
        <strong>{pitchName(note)}</strong><span>{formatCents(cents)} ¢</span>
        <div className="pitch-monitor-tuner" aria-hidden="true"><i style={{ left: `${50 + cents}%` }} /></div>
      </div>}
      <button type="button" className="pitch-monitor-action pitch-monitor-hold" aria-pressed={held}
        disabled={status !== 'live'} onClick={() => {
          hold.current = !hold.current;
          follow.reset();
          setHeld(hold.current);
          if (!hold.current) showLive();
        }}>{t('pitchMonitor.hold')}</button>
    </div>
    {(status === 'starting' || error) && <div className="pitch-monitor-message">
      {error && <p className="pitch-monitor-error" role="alert">{t(`sight.${error}`)}</p>}
      {resumeListening || (error && status === 'idle')
        ? <button className="secondary-button" type="button"
            onClick={resumeListening ?? (() => { void start(false); })}>{t('pitchMonitor.listen')}</button>
        : status === 'starting' && <LoadingStatus>{t('sight.waitingMicrophone')}</LoadingStatus>}
    </div>}
    <div className="pitch-monitor-controls">
      <BeatGridSettings theme={theme} bpm={bpm} showBeats={showBeats} setBpm={setBpm} setShowBeats={setShowBeats} />
      <div className="pitch-monitor-transport">
        <button className="pitch-monitor-action pitch-monitor-icon pitch-monitor-record" type="button"
          aria-label={t(recording ? 'sight.stop' : 'pitchMonitor.record')}
          disabled={status === 'starting' || playing} onClick={() => {
            if (recording) stopRecording();
            else if (status === 'live') record();
            else void start(true);
          }}>
          {recording ? <Square size={15} aria-hidden="true" /> : <Circle size={17} aria-hidden="true" />}
        </button>
        {take && !recording && <button className="pitch-monitor-action pitch-monitor-icon" type="button"
          aria-label={t(playing ? 'sight.stop' : 'pitchMonitor.play')} disabled={status === 'starting'} onClick={togglePlay}>
          {playing ? <Square size={17} aria-hidden="true" /> : <Play size={18} aria-hidden="true" />}
        </button>}
      </div>
      <MonitorAppearanceSettings value={appearance} onChange={setAppearance} theme={theme}
        pitchMode={playing && take ? take.mode : mode} pitchModeDisabled={recording || playing || held}
        onPitchModeChange={next => { follow.reset(); liveMode.current = next; setMode(next); }} />
    </div>
    {take && <audio ref={audio} src={take.url} onPause={finishPlayback} onEnded={finishPlayback} />}
  </PitchMonitorShell>;
}
