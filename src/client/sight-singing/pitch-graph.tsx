import { model } from '@coderline/alphatab';
import { solfegeDegreeLabel } from '@same-page/player/solfege-degree';
import { ZoomIn } from 'lucide-react';
import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Button, DialogTrigger, Popover } from 'react-aria-components';
import { useMessages } from '../../i18n';
import { Dialog } from '../navigation/overlays';
import { targetPitches, type Melody, type MelodyMeasure, type MelodyScore } from './melody';
import { pitchName, sightSingingMaxMidi, type PitchFrame } from './pitch-feedback';
import { firstFrameAt, lastFrameThrough, octaveGuides, pitchFramesConnect } from './pitch-trace';
import { createPitchViewport } from './pitch-viewport';
import { keyPitchClasses, pitchClass } from './staff-pitch';

const inlineInset = 8;
const blockInset = 12;
const chartGrowth = 1.2;
const minRangeZoom = -2;
const maxRangeZoom = 2;
const solfege = ['Do', 'Re', 'Mi', 'Fa', 'Sol', 'La', 'Ti'];

export function PitchGraph({ melody, visits, measure, frames, elapsed, following, reviewing, activeTarget, attemptReset,
  measureSpan, onMeasureSpanChange, rangeZoom, onRangeZoomChange }: {
  melody: Melody; visits: MelodyScore['visits']; measure: MelodyMeasure; frames: PitchFrame[]; elapsed: number;
  following: boolean; reviewing: boolean; activeTarget?: string; attemptReset: number;
  measureSpan: number; onMeasureSpanChange(count: number): void;
  rangeZoom: number; onRangeZoomChange(zoom: number): void;
}) {
  const t = useMessages('practice');
  const canvas = useRef<HTMLCanvasElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const centeredAttempt = useRef<number | null>(null);
  const manualUntil = useRef(0);
  const zoomCenter = useRef<number | null>(null);
  const lastPaintTop = useRef(-1);
  const [follow] = useState(createPitchViewport);
  // Grow the row and plot by the same factor to preserve the default visible range.
  const semitoneHeight = 16 * chartGrowth * 1.2 ** rangeZoom;
  const holdFollow = useCallback(() => { manualUntil.current = performance.now() + 1100; follow.reset(); }, [follow]);
  const zoomRange = (step: number) => {
    const view = viewport.current;
    if (!view?.clientHeight) return;
    zoomCenter.current = (view.scrollTop + view.clientHeight / 2 - blockInset) / semitoneHeight;
    holdFollow();
    onRangeZoomChange(rangeZoom + step);
  };
  const maxSpan = Math.min(8, melody.measures.length);
  const count = Math.min(measureSpan, maxSpan);
  const currentMeasure = measure.visit - melody.measures[0].visit;
  const first = Math.min(Math.floor(currentMeasure / count) * count, melody.measures.length - count);
  const measures = melody.measures.slice(first, first + count);
  const start = measures[0].start, end = measures[count - 1].end;
  const { low, high, midiRows } = useMemo(() => {
    const pitches = melody.notes.flatMap(targetPitches);
    // Cover the pitch reader's range and the whole written part.
    const low = Math.min(33, ...pitches) - 1, high = Math.ceil(Math.max(sightSingingMaxMidi, ...pitches)) + 1;
    return { low, high, midiRows: Array.from({ length: high - low + 1 }, (_, index) => high - index) };
  }, [melody]);
  const noteY = (midi: number) => blockInset + (high - midi) * semitoneHeight;
  const keys = useMemo(() => melody.keyChanges.map((key, index) => ({
    ...key, end: melody.keyChanges[index + 1]?.start ?? melody.duration,
    scale: keyPitchClasses(key.signature),
  })), [melody]);
  const visibleKeys = keys.filter(key => key.start < end && key.end > start);
  const currentKey = keys.find(key => key.start <= elapsed && elapsed < key.end) ?? keys.at(-1);
  const solfegeRows = useMemo(() => {
    const labels = new Map<number, string>();
    if (!currentKey || !Number.isInteger(currentKey.signature) || Math.abs(currentKey.signature) > 7) return labels;
    // Grid rows know pitch class, without a written accidental spelling.
    for (const pitch of currentKey.scale) {
      const degree = Number(solfegeDegreeLabel(pitch, currentKey.signature, model.NoteAccidentalMode.Default));
      if (solfege[degree - 1]) labels.set(pitch, solfege[degree - 1]);
    }
    return labels;
  }, [currentKey]);
  const { notes, targets, alternates } = useMemo(() => {
    const notes = melody.notes.filter(note => note.start < end && note.end > start).map(note => {
      const written = targetPitches(note);
      return { ...note, written, guides: octaveGuides(written, low, high) };
    });
    return { notes, targets: new Set(notes.flatMap(note => note.written)), alternates: new Set(notes.flatMap(note => note.guides)) };
  }, [melody, start, end, low, high]);
  const recording = following && !reviewing;
  // Calibrated voice frames may trail the live playhead. In review the
  // playhead determines which part of the finished recording is current.
  const through = recording ? Math.min(elapsed, frames.at(-1)?.time ?? elapsed) : elapsed;
  const latest = lastFrameThrough(frames, through);
  const endFrame = lastFrameThrough(frames, end) + 1;
  const startFrame = firstFrameAt(frames, start);
  const trace = frames.slice(startFrame, recording ? Math.min(endFrame, latest + 1) : endFrame);
  const index = Math.min(latest, endFrame - 1) - startFrame;
  let current: PitchFrame | undefined;
  for (let cursor = index; cursor >= 0; cursor--) {
    if (trace[cursor].midi !== null) { current = trace[cursor]; break; }
  }
  const active = current && through - current.time <= (recording ? .025 : .065) ? current : undefined;
  const anchor = notes[0]?.midi ?? melody.notes[0]?.midi;
  useLayoutEffect(() => {
    const view = viewport.current;
    if (!view?.clientHeight || centeredAttempt.current === attemptReset || anchor === undefined) return;
    view.scrollTop = blockInset + (high - anchor) * semitoneHeight - view.clientHeight / 2;
    centeredAttempt.current = attemptReset;
    manualUntil.current = 0;
    follow.reset();
  }, [anchor, attemptReset, follow, high, semitoneHeight]);

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
    const top = view.scrollTop;
    lastPaintTop.current = top;
    const y = (midi: number) => noteY(midi) - top;
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
    if (active && active.midi !== null) {
      draw.fillStyle = tone('voice');
      draw.beginPath();
      draw.arc(x(active.time), y(active.midi), 3.5, 0, 2 * Math.PI);
      draw.fill();
    }
  });
  useLayoutEffect(() => {
    const view = viewport.current, center = zoomCenter.current;
    if (!view || center === null) return;
    zoomCenter.current = null;
    view.scrollTop = blockInset + center * semitoneHeight - view.clientHeight / 2;
    paint();
  }, [semitoneHeight]);
  const advance = useEffectEvent((now: number, reducedMotion: boolean) => {
    const view = viewport.current;
    if (!view?.clientHeight || now < manualUntil.current) return;
    const halfHeight = view.clientHeight / 2;
    const center = high + (blockInset - view.scrollTop - halfHeight) / semitoneHeight;
    const topCenter = high + (blockInset - halfHeight) / semitoneHeight;
    const min = topCenter - (view.scrollHeight - view.clientHeight) / semitoneHeight;
    const next = follow.step({ center, span: view.clientHeight / semitoneHeight, frames, through, now, reducedMotion,
      min, max: topCenter });
    if (next === center) return;
    const scrollTop = view.scrollTop;
    view.scrollTop = (topCenter - next) * semitoneHeight;
    if (view.scrollTop !== scrollTop) paint();
  });

  useEffect(() => {
    if (!following) { follow.reset(); return; }
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    let request = 0;
    const animate = (now: number) => {
      advance(now, motion.matches);
      request = requestAnimationFrame(animate);
    };
    request = requestAnimationFrame(animate);
    return () => { cancelAnimationFrame(request); follow.reset(); };
  }, [follow, following]);

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
    const key = (event: KeyboardEvent) => {
      if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '].includes(event.key)) holdFollow();
    };
    const scroll = () => {
      if (performance.now() < manualUntil.current) holdFollow();
      if (view.scrollTop !== lastPaintTop.current) paint();
    };
    const gestures = ['wheel', 'pointerdown', 'touchmove'] as const;
    for (const event of gestures) view.addEventListener(event, holdFollow, { passive: true });
    view.addEventListener('keydown', key);
    view.addEventListener('scroll', scroll, { passive: true });
    return () => {
      resize.disconnect();
      theme.disconnect();
      for (const event of gestures) view.removeEventListener(event, holdFollow);
      view.removeEventListener('keydown', key);
      view.removeEventListener('scroll', scroll);
    };
  }, [holdFollow]);

  return <figure className="challenge-graph" aria-label={t('sight.pitchGraph')}>
    <figcaption>
      <h3>{t('sight.pitchMonitor')}</h3>
      <div className="challenge-graph-legend">
        <span data-kind="written">{activeTarget ? t('sight.currentTarget', { pitch: activeTarget }) : t('sight.targetLegend')}</span>
        <span data-kind="octave">{t('sight.octaveTargetLegend')}</span>
        <span data-kind="voice">{active?.midi == null ? t('sight.voiceLegend') : t('sight.currentPitch', { pitch: pitchName(Math.round(active.midi)) })}</span>
      </div>
    </figcaption>
    <DialogTrigger>
      <Button className="challenge-pitch-zoom-trigger"><ZoomIn size={17} aria-hidden="true" />{t('sight.pitchZoom')}</Button>
      <Popover isNonModal placement="top end" shouldFlip={false} offset={4} className="challenge-pitch-zoom-popover">
        <Dialog aria-label={t('sight.pitchZoom')} className="challenge-pitch-zoom-dialog">
          <div role="group" aria-label={t('sight.pitchZoomMeasures')} className="practice-notation-size">
            <span>{t('sight.pitchZoomMeasures')}</span>
            <Button className="practice-icon" aria-label={t('sight.pitchMoreMeasures')}
              isDisabled={count >= maxSpan} onPress={() => onMeasureSpanChange(count + 1)}>−</Button>
            <Button className="practice-icon" aria-label={t('sight.pitchFewerMeasures')}
              isDisabled={count <= 1} onPress={() => onMeasureSpanChange(count - 1)}>+</Button>
          </div>
          <div role="group" aria-label={t('sight.pitchZoomRange')} className="practice-notation-size">
            <span>{t('sight.pitchZoomRange')}</span>
            <Button className="practice-icon" aria-label={t('sight.pitchWiderRange')}
              isDisabled={rangeZoom <= minRangeZoom} onPress={() => zoomRange(-1)}>−</Button>
            <Button className="practice-icon" aria-label={t('sight.pitchNarrowerRange')}
              isDisabled={rangeZoom >= maxRangeZoom} onPress={() => zoomRange(1)}>+</Button>
          </div>
        </Dialog>
      </Popover>
    </DialogTrigger>
    <div className="challenge-graph-body" dir="ltr" ref={body} style={{ '--pitch-chart-growth': chartGrowth } as CSSProperties}>
      <div className="challenge-pitch-scroll" data-following={following} ref={viewport} role="region" aria-label={t('sight.pitchRange')} tabIndex={0}>
        <div className="challenge-pitch-field" aria-hidden="true" style={{ height: noteY(low) + blockInset }}>
          <div className="challenge-pitch-axis">
            {midiRows.map(midi => <span key={midi} data-in-key={currentKey?.scale.has(pitchClass(midi)) ?? false}
              data-target={targets.has(midi)} data-alternate={alternates.has(midi)} style={{ top: noteY(midi) }}>{pitchName(midi)}</span>)}
          </div>
          <div className="challenge-plot"><canvas ref={canvas} /></div>
          <div className="challenge-pitch-axis challenge-solfege-axis">
            {midiRows.map(midi => {
              const label = solfegeRows.get(pitchClass(midi));
              return label && <span key={midi} style={{ top: noteY(midi) }}>{label}</span>;
            })}
          </div>
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
