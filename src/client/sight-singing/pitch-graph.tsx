import { useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useMessages } from '../../i18n';
import { targetPitches, type Melody } from './melody';
import { pitchName, type PitchFrame } from './pitch-feedback';
import { firstFrameAt, octaveGuides, pitchFramesConnect } from './pitch-trace';

const windowSeconds = 12;
const inlineInset = 8;
const blockInset = 12;
const semitoneHeight = 16;
const isAccidental = (midi: number) => [1, 3, 6, 8, 10].includes((midi % 12 + 12) % 12);

function timeLabel(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${String(Math.floor(remainder)).padStart(2, '0')}${remainder % 1 ? String(remainder % 1).slice(1) : ''}`;
}

export function PitchGraph({ melody, frames, elapsed, reviewing, activeTarget }: {
  melody: Melody; frames: PitchFrame[]; elapsed: number; reviewing: boolean; activeTarget?: string;
}) {
  const t = useMessages('practice');
  const canvas = useRef<HTMLCanvasElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const autoScrollTop = useRef(0), recenter = useRef(true);
  const [following, setFollowing] = useState(true);
  const { low, high, midiRows } = useMemo(() => {
    const pitches = melody.notes.flatMap(targetPitches);
    // Cover the pitch reader's 55–1500 Hz range and the whole written part.
    const low = Math.min(33, ...pitches) - 1, high = Math.max(90, ...pitches) + 1;
    return { low, high, midiRows: Array.from({ length: high - low + 1 }, (_, index) => high - index) };
  }, [melody]);
  const noteY = (midi: number) => blockInset + (high - midi) * semitoneHeight;
  const start = Math.min(Math.max(0, Math.floor(elapsed / 6) * 6 - 3), Math.max(0, melody.duration - windowSeconds));
  const end = Math.min(melody.duration, start + windowSeconds);
  const span = end - start;
  const { notes, targets, alternates } = useMemo(() => {
    const notes = melody.notes.filter(note => note.start < end && note.end > start).map(note => {
      const written = targetPitches(note);
      return { ...note, written, guides: octaveGuides(written, low, high) };
    });
    return { notes, targets: new Set(notes.flatMap(note => note.written)), alternates: new Set(notes.flatMap(note => note.guides)) };
  }, [melody, start, end, low, high]);
  const endFrame = firstFrameAt(frames, end + 1e-6);
  const startFrame = firstFrameAt(frames, start);
  const trace = frames.slice(startFrame, endFrame);
  const index = firstFrameAt(trace, elapsed + 1e-6) - 1;
  const current = trace[index];
  const activePitch = current && elapsed - current.time <= .065 ? current.midi : null;
  let focusPitch = current?.midi ?? null;
  for (let cursor = index - 1; focusPitch === null && cursor >= 0; cursor--) focusPitch = trace[cursor].midi;
  if (focusPitch === null && reviewing) focusPitch = trace.find(frame => frame.midi !== null)?.midi ?? null;
  const anchor = focusPitch ?? notes[0]?.midi ?? melody.notes[0]?.midi;
  const anchorY = anchor === undefined ? undefined : noteY(anchor);
  const step = span >= 9 ? 3 : span >= 5 ? 2 : span >= 2 ? 1 : span >= 1 ? .5 : .25;
  const ticks: number[] = [];
  for (let time = Math.ceil(start / step) * step; time <= end; time += step) ticks.push(time);
  useLayoutEffect(() => {
    const view = viewport.current;
    if (!view?.clientHeight || !following || anchorY === undefined) return;
    const padding = view.clientHeight * .24;
    const offset = anchorY - view.scrollTop;
    if (!recenter.current && offset >= padding && offset <= view.clientHeight - padding) return;
    view.scrollTop = anchorY - view.clientHeight / 2;
    autoScrollTop.current = view.scrollTop;
    recenter.current = false;
  }, [anchorY, following]);

  const paint = useEffectEvent(() => {
    const element = canvas.current;
    const view = viewport.current;
    const draw = element?.getContext('2d');
    if (!view || !element || !draw) return;
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
    const y = (midi: number) => noteY(midi) - view.scrollTop;
    for (const midi of midiRows) {
      if (y(midi) < -semitoneHeight || y(midi) > height + semitoneHeight) continue;
      if (isAccidental(midi)) {
        draw.fillStyle = tone('accidental');
        draw.fillRect(0, y(midi + .5), width, y(midi - .5) - y(midi + .5));
      }
      draw.fillStyle = targets.has(midi) ? tone('grid-strong') : tone('grid');
      draw.fillRect(0, Math.round(y(midi)), width, 1);
    }
    draw.fillStyle = tone('grid');
    for (const time of ticks) draw.fillRect(Math.round(x(time)), 0, 1, height);
    const drawTargets = (kind: 'written' | 'guides') => {
      draw.beginPath();
      for (const note of notes) for (const midi of note[kind]) {
        const row = y(midi);
        if (row < -3 || row > height + 3) continue;
        const left = x(Math.max(start, note.start)), right = x(Math.min(end, note.end));
        const gap = Math.min(3, (right - left) / 3);
        draw.moveTo(left + gap, row);
        draw.lineTo(right - gap, row);
      }
      draw.stroke();
    };
    draw.lineCap = 'round';
    draw.strokeStyle = tone('octave');
    draw.lineWidth = 2;
    draw.setLineDash([4, 4]);
    drawTargets('guides');
    draw.setLineDash([]);
    draw.strokeStyle = tone('target');
    draw.lineWidth = 5;
    drawTargets('written');
    if (elapsed > 0) {
      draw.fillStyle = tone('cursor');
      draw.fillRect(Math.round(x(elapsed)), 0, 1, height);
    }
    draw.strokeStyle = tone('voice');
    draw.lineWidth = 2.3;
    draw.lineJoin = 'round';
    draw.beginPath();
    let previous: PitchFrame | undefined;
    for (const frame of trace) {
      const { midi, time } = frame;
      if (midi === null) { previous = undefined; continue; }
      if (!previous || !pitchFramesConnect(previous, frame)) {
        draw.moveTo(x(time), y(midi));
        draw.lineTo(x(time) + .2, y(midi));
      } else draw.lineTo(x(time), y(midi));
      previous = frame;
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
    const view = viewport.current, container = body.current;
    if (!view || !container || !canvas.current) return;
    const resize = new ResizeObserver(() => {
      container.style.setProperty('--pitch-scrollbar', `${view.offsetWidth - view.clientWidth}px`);
      paint();
    });
    resize.observe(canvas.current);
    const theme = new MutationObserver(() => paint());
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-ui-theme'] });
    const scroll = () => {
      if (Math.abs(view.scrollTop - autoScrollTop.current) > 1) setFollowing(false);
      paint();
    };
    view.addEventListener('scroll', scroll, { passive: true });
    return () => { resize.disconnect(); theme.disconnect(); view.removeEventListener('scroll', scroll); };
  }, []);

  return <figure className="challenge-graph" aria-label={t('sight.pitchGraph')}>
    <figcaption>
      <h3>{t('sight.pitchMonitor')}</h3>
      <button className="challenge-pitch-follow" type="button" aria-pressed={following} onClick={() => {
        recenter.current = !following;
        setFollowing(!following);
      }}>{t('sight.followPitch')}</button>
      <div className="challenge-graph-legend">
        <span data-kind="written">{activeTarget ? t('sight.currentTarget', { pitch: activeTarget }) : t('sight.targetLegend')}</span>
        <span data-kind="octave">{t('sight.octaveTargetLegend')}</span>
        <span data-kind="voice">{activePitch === null ? t('sight.voiceLegend') : t('sight.currentPitch', { pitch: pitchName(Math.round(activePitch)) })}</span>
      </div>
    </figcaption>
    <div className="challenge-graph-body" dir="ltr" ref={body}>
      <div className="challenge-pitch-scroll" ref={viewport} role="region" aria-label={t('sight.pitchRange')} tabIndex={0}>
        <div className="challenge-pitch-field" aria-hidden="true" style={{ height: noteY(low) + blockInset }}>
          <div className="challenge-pitch-axis">
            {midiRows.filter(midi => !isAccidental(midi) || targets.has(midi) || alternates.has(midi)).map(midi =>
              <span key={midi} data-target={targets.has(midi)} style={{ top: noteY(midi) }}>{pitchName(midi)}</span>)}
          </div>
          <div className="challenge-plot"><canvas ref={canvas} /></div>
        </div>
      </div>
      <div className="challenge-time-axis" aria-hidden="true">
        {ticks.map(time => <span key={time} style={{ left: `${(time - start) / span * 100}%` }}>{timeLabel(time)}</span>)}
      </div>
    </div>
  </figure>;
}
