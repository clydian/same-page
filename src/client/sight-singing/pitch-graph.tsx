import { useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef } from 'react';
import { useMessages } from '../../i18n';
import { targetPitches, type Melody, type MelodyMeasure, type MelodyScore } from './melody';
import { pitchName, type PitchFrame } from './pitch-feedback';
import { firstFrameAt, octaveGuides, pitchFramesConnect } from './pitch-trace';
import { keyPitchClasses, pitchClass } from './staff-pitch';

const inlineInset = 8;
const blockInset = 12;
const semitoneHeight = 16;

export function PitchGraph({ melody, visits, measure, frames, elapsed, following, reviewing, activeTarget, attemptReset, measureSpan, onMeasureSpanChange }: {
  melody: Melody; visits: MelodyScore['visits']; measure: MelodyMeasure; frames: PitchFrame[]; elapsed: number;
  following: boolean; reviewing: boolean; activeTarget?: string; attemptReset: number;
  measureSpan: number; onMeasureSpanChange(count: number): void;
}) {
  const t = useMessages('practice');
  const canvas = useRef<HTMLCanvasElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const centeredAttempt = useRef<number | null>(null);
  const maxSpan = Math.min(8, melody.measures.length);
  const count = Math.min(measureSpan, maxSpan);
  const currentMeasure = measure.visit - melody.measures[0].visit;
  const first = Math.min(Math.floor(currentMeasure / count) * count, melody.measures.length - count);
  const measures = melody.measures.slice(first, first + count);
  const start = measures[0].start, end = measures[count - 1].end;
  const { low, high, midiRows } = useMemo(() => {
    const pitches = melody.notes.flatMap(targetPitches);
    // Cover the pitch reader's 55–1500 Hz range and the whole written part.
    const low = Math.min(33, ...pitches) - 1, high = Math.max(90, ...pitches) + 1;
    return { low, high, midiRows: Array.from({ length: high - low + 1 }, (_, index) => high - index) };
  }, [melody]);
  const noteY = (midi: number) => blockInset + (high - midi) * semitoneHeight;
  const keys = useMemo(() => melody.keyChanges.map((key, index) => ({
    start: key.start, end: melody.keyChanges[index + 1]?.start ?? melody.duration,
    scale: keyPitchClasses(key.signature),
  })), [melody]);
  const visibleKeys = keys.filter(key => key.start < end && key.end > start);
  const currentKey = keys.find(key => key.start <= elapsed && elapsed < key.end) ?? keys.at(-1);
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
  useLayoutEffect(() => {
    const view = viewport.current;
    const centered = centeredAttempt.current === attemptReset;
    if (!view?.clientHeight || (!following && centered) || anchorY === undefined) return;
    const padding = view.clientHeight * .24;
    const offset = anchorY - view.scrollTop;
    if (centered && offset >= padding && offset <= view.clientHeight - padding) return;
    view.scrollTop = anchorY - view.clientHeight / 2;
    centeredAttempt.current = attemptReset;
  }, [anchorY, following, attemptReset]);

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
    const plotWidth = width - 2 * inlineInset;
    // Give each printed measure room even when a pickup or tempo change makes
    // its duration shorter. Notes and sung samples use the same playback times.
    const x = (time: number) => {
      const index = measures.findIndex(bar => time < bar.end);
      if (index < 0) return inlineInset + plotWidth;
      const bar = measures[index];
      const fraction = Math.max(0, (time - bar.start) / (bar.end - bar.start));
      return inlineInset + (index + fraction) / count * plotWidth;
    };
    const y = (midi: number) => noteY(midi) - view.scrollTop;
    for (const midi of midiRows) {
      if (y(midi) < -semitoneHeight || y(midi) > height + semitoneHeight) continue;
      const row = Math.round(y(midi));
      draw.fillStyle = tone('grid');
      draw.fillRect(0, row, width, 1);
      for (const key of visibleKeys) {
        if (!key.scale.has(pitchClass(midi))) continue;
        const left = key.start <= start ? 0 : x(key.start);
        const right = key.end >= end ? width : x(key.end);
        draw.fillStyle = tone('grid-scale');
        draw.fillRect(left, row, right - left, 1);
      }
    }
    draw.fillStyle = tone('grid');
    for (let index = 0; index <= count; index++) draw.fillRect(Math.round(inlineInset + index / count * plotWidth), 0, 1, height);
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
    const scroll = () => paint();
    view.addEventListener('scroll', scroll, { passive: true });
    return () => { resize.disconnect(); theme.disconnect(); view.removeEventListener('scroll', scroll); };
  }, []);

  return <figure className="challenge-graph" aria-label={t('sight.pitchGraph')}>
    <figcaption>
      <h3>{t('sight.pitchMonitor')}</h3>
      <div className="challenge-graph-legend">
        <span data-kind="written">{activeTarget ? t('sight.currentTarget', { pitch: activeTarget }) : t('sight.targetLegend')}</span>
        <span data-kind="octave">{t('sight.octaveTargetLegend')}</span>
        <span data-kind="voice">{activePitch === null ? t('sight.voiceLegend') : t('sight.currentPitch', { pitch: pitchName(Math.round(activePitch)) })}</span>
      </div>
      <div className="practice-notation-size challenge-pitch-zoom" role="group" aria-label={t('sight.pitchMonitor')}>
        <button type="button" className="practice-icon" aria-label={t('sight.pitchMoreMeasures')}
          disabled={count >= maxSpan} onClick={() => onMeasureSpanChange(count + 1)}>−</button>
        <button type="button" className="practice-icon" aria-label={t('sight.pitchFewerMeasures')}
          disabled={count <= 1} onClick={() => onMeasureSpanChange(count - 1)}>+</button>
      </div>
    </figcaption>
    <div className="challenge-graph-body" dir="ltr" ref={body}>
      <div className="challenge-pitch-scroll" data-following={following} ref={viewport} role="region" aria-label={t('sight.pitchRange')} tabIndex={0}>
        <div className="challenge-pitch-field" aria-hidden="true" style={{ height: noteY(low) + blockInset }}>
          <div className="challenge-pitch-axis">
            {midiRows.map(midi => <span key={midi} data-in-key={currentKey?.scale.has(pitchClass(midi)) ?? false}
              data-target={targets.has(midi)} data-alternate={alternates.has(midi)} style={{ top: noteY(midi) }}>{pitchName(midi)}</span>)}
          </div>
          <div className="challenge-plot"><canvas ref={canvas} /></div>
        </div>
      </div>
      <ol className="challenge-measure-axis" style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}>
        {measures.map(bar => {
          const { number, visit } = visits[bar.visit];
          const label = visit === undefined ? t('printedMeasure', { measure: number }) : t('repeatedMeasure', { measure: number, visit });
          return <li key={bar.visit} aria-current={bar.visit === measure.visit ? 'step' : undefined} aria-label={label} title={label}>
            {number}{visit !== undefined && <sup aria-hidden="true">{visit}</sup>}
          </li>;
        })}
      </ol>
    </div>
  </figure>;
}
