import { useEffect, useEffectEvent, useRef } from 'react';
import { useMessages } from '../../i18n';
import { targetPitches, type Melody } from './melody';
import { pitchName, type PitchFrame } from './pitch-feedback';

const windowSeconds = 12;
const inlineInset = 8;
const blockInset = 12;
const isAccidental = (midi: number) => [1, 3, 6, 8, 10].includes((midi % 12 + 12) % 12);

function timeLabel(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${String(Math.floor(remainder)).padStart(2, '0')}${remainder % 1 ? String(remainder % 1).slice(1) : ''}`;
}

export function PitchGraph({ melody, frames, elapsed, activePitch, activeTarget }: {
  melody: Melody; frames: PitchFrame[]; elapsed: number; activePitch: number | null; activeTarget?: string;
}) {
  const t = useMessages('practice');
  const canvas = useRef<HTMLCanvasElement>(null);
  const start = Math.min(Math.max(0, Math.floor(elapsed / 6) * 6 - 3), Math.max(0, melody.duration - windowSeconds));
  const end = Math.min(melody.duration, start + windowSeconds);
  const span = end - start;
  const notes = melody.notes.filter(note => note.start < end && note.end > start);
  const targets = new Set(notes.flatMap(targetPitches));
  const trace: PitchFrame[] = [];
  const pitches = targets.size ? [...targets] : melody.notes.flatMap(targetPitches);
  let bottom = Math.min(...pitches), top = Math.max(...pitches);
  for (let index = frames.length - 1; index >= 0; index--) {
    const frame = frames[index];
    if (frame.time < start) break;
    if (frame.time > end) continue;
    trace.push(frame);
    if (frame.midi !== null) {
      bottom = Math.min(bottom, Math.round(frame.midi));
      top = Math.max(top, Math.round(frame.midi));
    }
  }
  const low = bottom - 1, high = top + 1;
  const step = span >= 9 ? 3 : span >= 5 ? 2 : span >= 2 ? 1 : span >= 1 ? .5 : .25;
  const ticks: number[] = [];
  for (let time = Math.ceil(start / step) * step; time <= end; time += step) ticks.push(time);
  const midiRows = Array.from({ length: high - low + 1 }, (_, index) => low + index);
  const labelSpacing = Math.max(1, Math.ceil((high - low) / 10));
  const labelled: number[] = [];
  for (const midi of [...targets, ...midiRows]) {
    if (labelled.every(other => Math.abs(other - midi) >= labelSpacing)) labelled.push(midi);
  }

  const paint = useEffectEvent(() => {
    const element = canvas.current;
    const draw = element?.getContext('2d');
    if (!element || !draw) return;
    const width = element.clientWidth, height = element.clientHeight;
    if (!width || !height) return;
    const scale = Math.min(2, window.devicePixelRatio || 1);
    const pixelWidth = Math.round(width * scale), pixelHeight = Math.round(height * scale);
    if (element.width !== pixelWidth) element.width = pixelWidth;
    if (element.height !== pixelHeight) element.height = pixelHeight;
    draw.setTransform(pixelWidth / width, 0, 0, pixelHeight / height, 0, 0);
    draw.clearRect(0, 0, width, height);
    const styles = getComputedStyle(element);
    const tone = (name: string) => styles.getPropertyValue(`--pitch-${name}`).trim();
    const x = (time: number) => inlineInset + (time - start) / span * (width - 2 * inlineInset);
    const y = (midi: number) => blockInset + (high - midi) / (high - low) * (height - 2 * blockInset);
    for (const midi of midiRows) {
      if (isAccidental(midi)) {
        draw.fillStyle = tone('accidental');
        draw.fillRect(0, y(midi + .5), width, y(midi - .5) - y(midi + .5));
      }
      draw.fillStyle = targets.has(midi) ? tone('grid-strong') : tone('grid');
      draw.fillRect(0, Math.round(y(midi)), width, 1);
    }
    draw.fillStyle = tone('grid');
    for (const time of ticks) draw.fillRect(Math.round(x(time)), 0, 1, height);
    draw.strokeStyle = tone('target');
    draw.lineWidth = 5;
    draw.lineCap = 'round';
    draw.beginPath();
    for (const note of notes) for (const midi of targetPitches(note)) {
      const left = x(Math.max(start, note.start)), right = x(Math.min(end, note.end));
      const gap = Math.min(3, (right - left) / 3);
      draw.moveTo(left + gap, y(midi));
      draw.lineTo(right - gap, y(midi));
    }
    draw.stroke();
    if (elapsed > 0) {
      draw.fillStyle = tone('cursor');
      draw.fillRect(Math.round(x(elapsed)), 0, 1, height);
    }
    draw.strokeStyle = tone('voice');
    draw.lineWidth = 2.3;
    draw.lineJoin = 'round';
    draw.beginPath();
    let previous: number | null = null;
    for (let i = trace.length - 1; i >= 0; i--) {
      const { midi, time } = trace[i];
      if (midi === null) { previous = null; continue; }
      if (previous === null || time - previous > .09) {
        draw.moveTo(x(time), y(midi));
        draw.lineTo(x(time) + .2, y(midi));
      } else draw.lineTo(x(time), y(midi));
      previous = time;
    }
    draw.stroke();
    if (activePitch !== null) {
      draw.fillStyle = tone('voice');
      draw.beginPath();
      draw.arc(x(elapsed), y(activePitch), 3.5, 0, 2 * Math.PI);
      draw.fill();
    }
  });
  useEffect(() => { paint(); });
  useEffect(() => {
    if (!canvas.current) return;
    const resize = new ResizeObserver(() => paint());
    resize.observe(canvas.current);
    const theme = new MutationObserver(() => paint());
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-ui-theme'] });
    return () => { resize.disconnect(); theme.disconnect(); };
  }, []);

  return <figure className="challenge-graph" aria-label={t('sight.pitchGraph')}>
    <figcaption>
      <h3>{t('sight.pitchMonitor')}</h3>
      <div className="challenge-graph-legend">
        <span>{activeTarget ? t('sight.currentTarget', { pitch: activeTarget }) : t('sight.targetLegend')}</span>
        <span>{activePitch === null ? t('sight.voiceLegend') : t('sight.currentPitch', { pitch: pitchName(Math.round(activePitch)) })}</span>
      </div>
    </figcaption>
    <div className="challenge-graph-body" dir="ltr" aria-hidden="true">
      <div className="challenge-pitch-axis">
        {labelled.map(midi => <span key={midi} data-target={targets.has(midi)} style={{ top: `${(high - midi) / (high - low) * 100}%` }}>{pitchName(midi)}</span>)}
      </div>
      <div className="challenge-plot"><canvas ref={canvas} /></div>
      <div className="challenge-time-axis">
        {ticks.map(time => <span key={time} style={{ left: `${(time - start) / span * 100}%` }}>{timeLabel(time)}</span>)}
      </div>
    </div>
  </figure>;
}
