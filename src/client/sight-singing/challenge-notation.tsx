import { AlphaTabApi, LayoutMode, model, NotationElement, PlayerMode, StaveProfile, type rendering } from '@coderline/alphatab';
import { isPointerDrag, ScoreFollowSession, type PointerPosition } from '@same-page/player/score-follow';
import { memo, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { useMessages } from '../../i18n';
import { notationFontDirectory } from '../../shared/asset-url';
import { NotationZoom } from '../playback/notation-zoom';
import type { Melody, MelodyMeasure, MelodyScore, MelodyVoice } from './melody';
import { shadeContext } from './notation-crop';
import { notationScore, samePart, type Part } from './notation-score';
import { matchesNotationResult, notationFeedbackAtVisit, type NotationFeedback, type NotationResult } from './notation-feedback';
import { tintBeams } from './notation-beams';
import { measureAnchors, positionAt } from './notation-timing';
import { formatCents, pitchName, type PitchFrame } from './pitch-feedback';
import { RhythmReviewMarks, type RhythmMark } from '../rhythm-practice/review-marks';
import { ScorePitchTrace } from './score-pitch-trace';
import './challenge-notation.css';

export type NotationNoteHit = { midi: number; track: number; staff: number; voice: number; bar: number; beatIndex: number };
type Bounds = { x: number; y: number; w: number; h: number };
type ScrollDirection = 'vertical' | 'horizontal';
type NoteTarget = NotationNoteHit & { key: string; beatClass: string; bounds: Bounds; system: Bounds; label: string; singleStem: boolean };
type Geometry = {
  score: MelodyScore['score']; direction: ScrollDirection; scale: number; lookup: rendering.BoundsLookup; notes: NoteTarget[];
};

const defaultScale = .9;
const centerX = (bounds: Bounds) => bounds.x + bounds.w / 2;
const centerY = (bounds: Bounds) => bounds.y + bounds.h / 2;

function buildGeometry(api: AlphaTabApi, score: Geometry['score'], direction: ScrollDirection, scale: number): Geometry | null {
  const lookup = api.boundsLookup;
  if (!lookup) return null;
  const notes: NoteTarget[] = [];
  // Horizontal rendering reports the same system for each lazy SVG partial.
  const systems = direction === 'horizontal' ? lookup.staffSystems.slice(0, 1) : lookup.staffSystems;
  for (const system of systems) for (const master of system.bars) for (const bar of master.bars) {
    for (const { beat, notes: heads } of bar.beats) {
      // Worker-deserialized BarBounds does not carry a bar model reference.
      const { staff } = beat.voice.bar;
      const part = { track: staff.track.index, staff: staff.index, voice: beat.voice.index };
      const singleStem = heads?.length === 1 && beat.voice.bar.voices.every(candidate =>
        candidate === beat.voice || candidate.beats.every(other => other.isRest));
      for (const { note, noteHeadBounds: bounds } of heads ?? []) {
        if (note.isCue || note.isPercussion || note.isDead || !note.isVisible || bounds.w <= 0 || bounds.h <= 0) continue;
        notes.push({ ...part, key: `${system.index}:${note.id}`, beatClass: `b${beat.id}`, midi: note.realValue, bounds,
          bar: master.index, beatIndex: beat.index, label: staff.track.name, singleStem, system: system.realBounds });
      }
    }
  }
  return { score, direction, scale, lookup, notes };
}

const NotationButtons = memo(function NotationButtons({ notes, voice, results, onNote }: {
  notes: readonly NoteTarget[]; voice: Part; results: ReadonlyMap<string, NotationFeedback>;
  onNote(hit: NoteTarget): void;
}) {
  const t = useMessages('practice');
  const [focusKey, setFocusKey] = useState('');
  const buttons = useRef<HTMLDivElement>(null);
  const focused = notes.find(note => note.key === focusKey) ?? notes.find(note => samePart(note, voice)) ?? notes[0];
  const activate = (event: MouseEvent<HTMLButtonElement>, target: NoteTarget) => {
    if (!event.detail || !buttons.current) { onNote(target); return; }
    const rect = buttons.current.getBoundingClientRect();
    const x = (event.clientX - rect.left) * buttons.current.offsetWidth / rect.width;
    const y = (event.clientY - rect.top) * buttons.current.offsetHeight / rect.height;
    // Nearby chord noteheads can share a touch target. Resolve the pointer to
    // the closest actual head while a keyboard activation keeps its own note.
    let selected = target, distance = Math.hypot(x - centerX(target.bounds), y - centerY(target.bounds));
    for (const note of notes) {
      const deltaX = Math.abs(x - centerX(note.bounds)), deltaY = Math.abs(y - centerY(note.bounds));
      if (deltaX > 13 || deltaY > 13) continue;
      const next = Math.hypot(deltaX, deltaY);
      if (next < distance) { selected = note; distance = next; }
    }
    onNote(selected);
  };
  return <div ref={buttons} className="challenge-note-layer">
    {notes.map((note, index) => {
      const result = results.get(note.key);
      const description = result ? [
        t(`sight.${result.status}`),
        ...(result.cents === null ? [] : [`${t('sight.pitchError')} ${formatCents(result.cents)}`]),
      ].join(' · ') : undefined;
      return <button key={note.key} type="button" className="challenge-notation-note"
      style={{ left: centerX(note.bounds), top: centerY(note.bounds) }}
      data-midi={note.midi} data-bar={note.bar} data-track={note.track} data-staff={note.staff} data-voice={note.voice}
      data-beat-index={note.beatIndex} data-focused-part={samePart(note, voice)} tabIndex={focused === note ? 0 : -1}
      aria-label={t('sight.notationNote', { part: note.label || t('sight.voice'), pitch: pitchName(note.midi), measure: note.bar + 1 })}
      aria-description={description}
      aria-keyshortcuts="ArrowLeft ArrowRight Home End" onFocus={() => setFocusKey(note.key)} onClick={event => activate(event, note)}
      onKeyDown={event => {
        const next = event.key === 'ArrowRight' ? index + 1 : event.key === 'ArrowLeft' ? index - 1
          : event.key === 'Home' ? 0 : event.key === 'End' ? notes.length - 1 : null;
        if (next === null) return;
        event.preventDefault();
        const target = buttons.current?.children.item(next);
        if (target instanceof HTMLButtonElement) target.focus();
      }} />;
    })}
  </div>;
});

const labelHeight = 16;
const overlaps = (a: Bounds, b: Bounds) =>
  a.x < b.x + b.w + 1 && a.x + a.w + 1 > b.x && a.y < b.y + b.h + 1 && a.y + a.h + 1 > b.y;

function engravingObstacles(element: HTMLDivElement) {
  const sheet = element.getBoundingClientRect();
  const scale = element.offsetWidth ? sheet.width / element.offsetWidth : 0;
  if (!scale) return [];
  const canvas = document.createElement('canvas').getContext('2d');
  return [...element.querySelectorAll('svg :is(text, path, rect, polygon, line, polyline, ellipse, circle, use)')].flatMap(glyph => {
    let { left, top, width, height } = glyph.getBoundingClientRect();
    // AlphaTab's music-font text boxes span the full font metrics (130 px
    // at normal zoom), not the drawn clef, notehead, or accidental.
    if (canvas && glyph instanceof SVGTextElement && glyph.matches('g.at > text') && glyph.getNumberOfChars()) {
      const matrix = glyph.getScreenCTM();
      if (matrix) {
        const style = getComputedStyle(glyph);
        canvas.font = `${style.fontSize} ${style.fontFamily}`;
        const ink = canvas.measureText(glyph.textContent ?? '');
        const start = glyph.getStartPositionOfChar(0).matrixTransform(matrix);
        left = start.x - ink.actualBoundingBoxLeft * matrix.a;
        top = start.y - ink.actualBoundingBoxAscent * matrix.d;
        width = (ink.actualBoundingBoxLeft + ink.actualBoundingBoxRight) * matrix.a;
        height = (ink.actualBoundingBoxAscent + ink.actualBoundingBoxDescent) * matrix.d;
      }
    }
    // Do not reserve the entire length of thin staff rules.
    if (!width || !height || glyph.tagName !== 'text' && width / scale >= 24 && height / scale <= 1.5) return [];
    return [{ x: (left - sheet.left) / scale, y: (top - sheet.top) / scale, w: width / scale, h: height / scale }];
  });
}

function placePitchLabels(notes: NoteTarget[], results: ReadonlyMap<string, NotationResult>, engraving: Bounds[]) {
  const ordered = notes.flatMap(note => {
    const result = results.get(note.key);
    return result && !result.continuation && result.cents !== null ? [{ note, cents: result.cents, status: result.status }] : [];
  }).sort((a, b) => Math.abs(b.cents) - Math.abs(a.cents));
  engraving.sort((a, b) => b.y - a.y);
  const occupied = [...engraving, ...notes.map(note => note.bounds)];
  return ordered.flatMap(({ note, cents, status }) => {
    const text = formatCents(cents), w = text.length * 8 + 4;
    const { bounds, system } = note;
    const above = centerY(bounds) - labelHeight - 3;
    // A beam or stem can sit right above the notehead. Prefer moving just
    // beyond the engraving to piling numbers in the middle of the staff.
    const position = [0, 14].map(offset => {
      const candidate = { x: centerX(bounds) - w / 2 + offset, y: above, w, h: labelHeight };
      for (const obstacle of engraving) {
        if (overlaps(candidate, obstacle)) candidate.y = obstacle.y - labelHeight - 2;
      }
      return candidate;
    }).find(candidate =>
      candidate.x >= system.x && candidate.x + w <= system.x + system.w &&
      candidate.y >= Math.max(0, above - 38) && candidate.y + labelHeight <= system.y + system.h &&
      !occupied.some(bounds => overlaps(candidate, bounds)));
    if (!position) return [];
    occupied.push(position);
    return [{ key: note.key, status, text, position }];
  });
}

type AssessedHead = Pick<NoteTarget, 'bounds' | 'singleStem'> & { status: NotationFeedback['status'] };
type Stem = { element: SVGRectElement; bounds: DOMRect };

function findStem(bounds: Bounds, stems: Stem[], sheet: DOMRect, scale: number) {
  const y = centerY(bounds);
  const matches = stems.filter(({ bounds: stem }) => {
    const x = (stem.left + stem.width / 2 - sheet.left) / scale;
    const top = (stem.top - sheet.top) / scale, bottom = (stem.bottom - sheet.top) / scale;
    return Math.min(Math.abs(x - bounds.x), Math.abs(x - (bounds.x + bounds.w))) < 1.6 &&
      Math.min(Math.abs(top - y), Math.abs(bottom - y)) < 2;
  });
  return matches.length === 1 ? matches[0].element : undefined;
}

function tintNoteheads(group: SVGGElement, heads: AssessedHead[], sheet: DOMRect, scale: number, stems: Stem[], marked: Set<SVGElement>) {
  // SVG music symbols carry the same translated origin as AlphaTab's notehead
  // lookup. Match inside the beat so chord tones do not color their neighbors.
  for (const glyph of group.querySelectorAll<SVGGElement>('g.at')) {
    const text = glyph.querySelector<SVGTextElement>('text');
    if (text?.textContent?.length !== 1) continue;
    const symbol = text.textContent.charCodeAt(0);
    if (!model.MusicFontSymbol[symbol]?.startsWith('Notehead') || symbol === model.MusicFontSymbol.NoteheadParenthesis) continue;
    const origin = glyph.getScreenCTM();
    if (!origin) continue;
    const x = (origin.e - sheet.left) / scale, y = (origin.f - sheet.top) / scale;
    const head = heads.find(({ bounds }) => Math.abs(centerY(bounds) - y) < 1.5 &&
      Math.min(Math.abs(bounds.x - x), Math.abs(centerX(bounds) - x)) < 1.5);
    if (!head) continue;
    text.dataset.challengeFeedback = head.status;
    marked.add(text);
    if (!head.singleStem) continue;
    const stem = findStem(head.bounds, stems, sheet, scale);
    if (stem) {
      stem.dataset.challengeFeedback = head.status;
      marked.add(stem);
    }
  }
}

export function ChallengeNotation({ score, voice, melody, measure, elapsed, positioned, followRun, attemptReset, onNote, onMeasure, feedback, pitchFrames, traceMode, traceThrough, bpm, tempoBeat = '♩', rhythm, rhythmMarks }: {
  score: MelodyScore['score']; voice: MelodyVoice; melody: Pick<Melody, 'measures' | 'staffBeats'>; measure: MelodyMeasure; elapsed: number; positioned: boolean; followRun: number;
  attemptReset: number;
  onNote?: (note: NotationNoteHit) => void; onMeasure?: (bar: number) => void; feedback?: readonly NotationFeedback[];
  pitchFrames?: PitchFrame[]; traceMode?: 'recording' | 'replaying';
  traceThrough?: number; bpm: number; tempoBeat?: string; rhythm?: boolean; rhythmMarks?: readonly RhythmMark[];
}) {
  const t = useMessages('practice');
  const viewport = useRef<HTMLDivElement>(null), notation = useRef<HTMLDivElement>(null);
  const hadPosition = useRef(false);
  const browseAnchor = useRef<number | null>(null);
  const pointer = useRef<PointerPosition | null>(null);
  const autoScroll = useRef<PointerPosition | null>(null);
  const [scrollIntent] = useState(() => new ScoreFollowSession());
  const [paused, setPaused] = useState<string>();
  const [scope, setScope] = useState<'part' | 'full'>(rhythm ? 'part' : 'full');
  const [direction, setDirection] = useState<ScrollDirection>('vertical');
  const [scale, setScale] = useState(defaultScale);
  const horizontal = direction === 'horizontal';
  const followKey = `${attemptReset}:${followRun}`;
  const manual = paused === followKey;
  const [geometry, setGeometry] = useState<Geometry | null>(null);
  const played = useMemo(() => new Set(melody.measures.map(bar => bar.bar)), [melody.measures]);
  const min = Math.min(...played), max = Math.max(...played);
  const cropped = useMemo(() => melody.measures.some(bar => bar.clip), [melody.measures]);
  const display = useMemo(() => {
    const layout = notationScore(score, voice, scope === 'full', min, max);
    if (cropped) shadeContext(layout.score, layout.part, melody.measures, min, max);
    return layout;
  }, [score, voice, scope, min, max, cropped, melody.measures]);
  const rendered = geometry?.score === display.score && geometry.direction === direction && geometry.scale === scale ? geometry : null;
  const notes = useMemo(() => rendered?.notes.filter(note => played.has(note.bar)) ?? [], [played, rendered]);
  const currentVisit = measure.visit;
  const [labels, setLabels] = useState<ReturnType<typeof placePitchLabels>>([]);
  const [selection, select] = useState<{ note: NoteTarget; attempt: number; voice: string; visit: number }>();
  const { results, tinted } = useMemo(() => {
    const visited = notationFeedbackAtVisit(melody, feedback, currentVisit);
    const results = new Map<string, NotationResult>(), tinted = new Map<string, AssessedHead[]>();
    for (const note of notes) {
      if (!samePart(note, display.part)) continue;
      const result = visited.get(`${note.bar}:${note.beatIndex}`);
      if (!matchesNotationResult(result, note.midi)) continue;
      results.set(note.key, result);
      if (result.status === 'insufficientData') continue;
      const heads = tinted.get(note.beatClass) ?? [];
      heads.push({ bounds: note.bounds, status: result.status, singleStem: note.singleStem });
      tinted.set(note.beatClass, heads);
    }
    return { results, tinted };
  }, [melody, feedback, currentVisit, notes, display.part]);

  const selected = feedback && selection?.attempt === attemptReset && selection.voice === voice.id ? selection : undefined;
  const detail = useMemo(() => {
    if (!selected) return;
    const { note, visit } = selected;
    const result = notationFeedbackAtVisit(melody, feedback, visit).get(`${note.bar}:${note.beatIndex}`);
    if (!matchesNotationResult(result, note.midi)) return;
    return result;
  }, [melody, feedback, selected]);

  useLayoutEffect(() => {
    const element = notation.current;
    if (!rendered || !element || !results.size) {
      setLabels(previous => previous.length ? [] : previous);
      return;
    }
    const layout = () => setLabels(placePitchLabels(rendered.notes, results, engravingObstacles(element)));
    // AlphaTab mounts and detaches SVG partials as they enter the viewport.
    const observer = new MutationObserver(layout);
    observer.observe(element, { childList: true, subtree: true });
    layout();
    return () => observer.disconnect();
  }, [rendered, results]);

  const rememberAnchor = () => {
    const host = viewport.current, element = notation.current;
    if (!host || !element || !rendered || (positioned && !manual) || browseAnchor.current !== null ||
      (!host.scrollTop && !host.scrollLeft)) return;
    const frame = host.getBoundingClientRect(), sheet = element.getBoundingClientRect();
    const x = frame.left + host.clientWidth * .32 - sheet.left;
    const y = frame.top + Math.min(32, host.clientHeight * .25) - sheet.top;
    const system = rendered.lookup.staffSystems.find(item => item.realBounds.y + item.realBounds.h > y);
    const bar = system?.findBarAtPos(x) ?? system?.bars[0];
    browseAnchor.current = bar?.index ?? null;
  };
  const rememberResizeAnchor = useEffectEvent(rememberAnchor);

  useEffect(() => {
    const element = notation.current;
    if (!element) return;
    const api = new AlphaTabApi(element, {
      core: { fontDirectory: notationFontDirectory, engine: 'svg', includeNoteBounds: true },
      display: { scale, startBar: min + 1, barCount: max - min + 1, justifyLastSystem: true,
        layoutMode: horizontal ? LayoutMode.Horizontal : LayoutMode.Page, stretchForce: horizontal ? 1.5 : 1,
        staveProfile: StaveProfile.Score,
        resources: { secondaryGlyphColor: '#000000' } },
      player: { playerMode: PlayerMode.Disabled, enableUserInteraction: false },
    });
    api.settings.notation.elements.set(NotationElement.ScoreTitle, false);
    api.settings.notation.elements.set(NotationElement.ScoreSubTitle, false);
    api.settings.notation.elements.set(NotationElement.EffectTempo, false);
    api.updateSettings();
    const update = () => setGeometry(buildGeometry(api, display.score, direction, scale));
    // AlphaTab doesn't reflow the horizontal layout on resize.
    const resize = () => { if (!horizontal) rememberResizeAnchor(); };
    api.resize.on(resize);
    api.postRenderFinished.on(update);
    api.renderScore(display.score, display.tracks);
    return () => { api.resize.off(resize); api.postRenderFinished.off(update); api.destroy(); };
  }, [display, min, max, direction, horizontal, scale]);

  useLayoutEffect(() => {
    const element = notation.current;
    if (!rendered || !element || !tinted.size) return;
    // AlphaTab caches detached SVGs for offscreen systems. Clear marks on the
    // nodes we painted, including those that are no longer in the viewport.
    const marked = new Set<SVGElement>();
    const clear = () => {
      for (const glyph of marked) glyph.removeAttribute('data-challenge-feedback');
      marked.clear();
    };
    const engravingRatio = rendered.scale / defaultScale;
    const shade = () => {
      clear();
      const sheet = element.getBoundingClientRect();
      const scale = element.offsetWidth ? sheet.width / element.offsetWidth : 1;
      // AlphaTab emits the stems as tall, narrow rectangles alongside the beat
      // groups. Match only a unique endpoint so a shared chord stem stays neutral.
      const stems = new Map<SVGSVGElement, Stem[]>();
      for (const group of element.querySelectorAll<SVGGElement>('g[class^="b"]')) {
        const heads = tinted.get(group.getAttribute('class') ?? '');
        if (!heads || scale <= 0) continue;
        const svg = group.ownerSVGElement;
        if (svg && !stems.has(svg)) {
          stems.set(svg, [...svg.querySelectorAll<SVGRectElement>('rect')]
            .filter(rect => rect.width.baseVal.value > 0 && rect.width.baseVal.value < 1.2 * engravingRatio &&
              rect.height.baseVal.value >= 12 * engravingRatio)
            .map(rect => ({ element: rect, bounds: rect.getBoundingClientRect() })));
        }
        const candidates = svg ? stems.get(svg) ?? [] : [];
        tintNoteheads(group, heads, sheet, scale, candidates, marked);
      }
      for (const [svg, candidates] of stems) tintBeams(svg, candidates.map(stem => stem.element), engravingRatio, marked);
    };
    // Worker system SVGs mount lazily when they enter the viewport.
    const observer = new MutationObserver(shade);
    observer.observe(element, { childList: true, subtree: true });
    shade();
    return () => {
      observer.disconnect();
      clear();
    };
  }, [rendered, tinted]);

  useLayoutEffect(() => {
    scrollIntent.restore();
    browseAnchor.current = null;
    pointer.current = null;
    autoScroll.current = null;
    viewport.current?.scrollTo(0, 0);
  }, [attemptReset, scrollIntent]);

  useLayoutEffect(() => {
    const host = viewport.current, element = notation.current, index = browseAnchor.current;
    if (!host || !element || !rendered || index === null) return;
    browseAnchor.current = null;
    const bar = rendered.lookup.findMasterBarByIndex(index);
    if (!bar) return;
    const bounds = bar.realBounds;
    const frame = host.getBoundingClientRect(), sheet = element.getBoundingClientRect();
    host.scrollTo(horizontal ? host.scrollLeft + sheet.left + bounds.x - frame.left : 0,
      host.scrollTop + sheet.top + bounds.y - frame.top);
  }, [rendered, horizontal]);

  const { row, anchors } = useMemo(() => {
    if (!positioned || !rendered) return {};
    const master = rendered.lookup.findMasterBarByIndex(measure.bar);
    const row = master?.bars.find(item => {
      const staff = item.beats[0]?.beat.voice.bar.staff;
      return staff?.track.index === display.part.track && staff.index === display.part.staff;
    })?.realBounds;
    if (!row || !horizontal && !cropped && !rhythm) return { row };
    return { row, anchors: measureAnchors(rendered.lookup, display.score, display.part, measure, melody.staffBeats) };
  }, [positioned, rendered, measure, display, horizontal, cropped, rhythm, melody.staffBeats]);
  const cursor = anchors && positionAt(anchors, elapsed);

  const followScore = useEffectEvent(() => {
    const host = viewport.current, element = notation.current;
    if (!host || !element) return;
    if (!positioned && hadPosition.current) host.scrollTo(0, 0);
    hadPosition.current = positioned;
    if (!row || manual || pointer.current || scrollIntent.shouldSuspendForScroll(performance.now(), false)) return;
    const sheet = element.getBoundingClientRect(), frame = host.getBoundingClientRect();
    const scale = element.offsetWidth ? sheet.width / element.offsetWidth : 1;
    if (cursor !== undefined) {
      const left = sheet.left + cursor * scale - frame.left - host.clientWidth * .32;
      host.scrollLeft = Math.max(0, host.scrollLeft + left);
    }
    const system = rendered?.lookup.findMasterBarByIndex(measure.bar)?.staffSystemBounds?.realBounds;
    const vertical = system && system.h * scale + 20 <= host.clientHeight ? system : row;
    const top = sheet.top + vertical.y * scale, bottom = top + vertical.h * scale;
    if (top < frame.top || bottom > frame.bottom) host.scrollTop += top - frame.top - 10;
    autoScroll.current = { x: host.scrollLeft, y: host.scrollTop };
  });
  useLayoutEffect(() => {
    followScore();
  }, [cursor, followKey, manual, measure.bar, positioned, rendered, row]);
  useEffect(() => {
    const host = viewport.current;
    if (!host) return;
    const observer = new ResizeObserver(() => followScore());
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  const noteScrollIntent = () => scrollIntent.noteManualScrollIntent(performance.now());

  return <div className="challenge-score-view" data-score-scope={scope} data-scroll-direction={direction}>
    <div className="challenge-notation-tools">
      <span className="challenge-notation-tempo" aria-label={t('adjustedTempo', { beat: tempoBeat, bpm: String(bpm) })}>{tempoBeat} = {bpm}</span>
      <NotationZoom ready={Boolean(rendered)} scale={scale} defaultScale={defaultScale} pinchHint={false} onChange={value => {
        if (value === scale) return;
        rememberAnchor();
        setScale(value);
      }} />
      <select aria-label={t('sight.scoreScope')} value={scope} onChange={event => {
        rememberAnchor();
        setScope(event.target.value === 'full' ? 'full' : 'part');
      }}>
        <option value="part">{t('sight.scorePart')}</option>
        <option value="full">{t('sight.scoreFull')}</option>
      </select>
      <select aria-label={t('sight.scoreScroll')} value={direction} onChange={event => {
        rememberAnchor();
        setDirection(event.target.value === 'horizontal' ? 'horizontal' : 'vertical');
      }}>
        <option value="vertical">{t('sight.scrollVertical')}</option>
        <option value="horizontal">{t('sight.scrollHorizontal')}</option>
      </select>
    </div>
    <div ref={viewport} className="challenge-notation" role="group" aria-label={t('sight.notation')} tabIndex={0}
    onWheel={noteScrollIntent}
    onKeyDown={event => {
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) noteScrollIntent();
    }}
    onPointerDown={event => { pointer.current = { x: event.clientX, y: event.clientY }; }}
    onPointerMove={event => {
      const start = pointer.current;
      if (start && isPointerDrag(start, { x: event.clientX, y: event.clientY })) noteScrollIntent();
    }}
    onPointerCancel={() => { pointer.current = null; noteScrollIntent(); }}
    onPointerUp={() => { pointer.current = null; }} onPointerLeave={() => { pointer.current = null; }}
    onScroll={event => {
      const host = event.currentTarget, automatic = autoScroll.current;
      if (automatic?.x === host.scrollLeft && automatic.y === host.scrollTop) return;
      if (positioned && scrollIntent.shouldSuspendForScroll(performance.now(), false)) {
        scrollIntent.restore();
        setPaused(followKey);
      }
    }}
    onClick={onMeasure ? event => {
      if (!rendered || !(event.target instanceof Element) || event.target.closest('button')) return;
      const element = notation.current;
      if (!element?.offsetWidth) return;
      const sheet = element.getBoundingClientRect(), scale = sheet.width / element.offsetWidth;
      if (!scale) return;
      const x = (event.clientX - sheet.left) / scale, y = (event.clientY - sheet.top) / scale;
      for (const system of rendered.lookup.staffSystems) for (const bar of system.bars) {
        const bounds = bar.realBounds;
        if (played.has(bar.index) && x >= bounds.x && x < bounds.x + bounds.w && y >= bounds.y && y < bounds.y + bounds.h) {
          onMeasure(bar.index);
          return;
        }
      }
    } : undefined}>
    <div className="challenge-notation-sheet">
      <div ref={notation} aria-hidden="true" />
      {row && <div className={cursor === undefined ? 'challenge-current-measure' : 'challenge-score-cursor'} aria-hidden="true"
        style={{ left: cursor ?? row.x, top: row.y, width: cursor === undefined ? row.w : 2, height: row.h }} />}
      {rendered && rhythmMarks && <RhythmReviewMarks marks={rhythmMarks} visit={currentVisit} lookup={rendered.lookup}
        score={display.score} voice={display.part} measures={melody.measures} staffBeats={melody.staffBeats} />}
      {rendered && pitchFrames?.length ? <ScorePitchTrace lookup={rendered.lookup} score={display.score} voice={display.part}
        beats={melody.staffBeats} measures={melody.measures} frames={pitchFrames} currentVisit={currentVisit} mode={traceMode} through={traceThrough} viewport={viewport} /> : null}
      {onNote && <NotationButtons notes={notes} voice={display.part} results={results}
        onNote={hit => {
          select(feedback && results.has(hit.key) ? { note: hit, attempt: attemptReset, voice: voice.id, visit: currentVisit } : undefined);
          onNote(scope === 'part' ? { ...hit, voice: voice.voice } : hit);
        }} />}
      {labels.length > 0 && <div className="challenge-pitch-labels" aria-hidden="true">
        {labels.map(({ key, position, status, text }) => <span key={key} data-status={status}
          style={{ left: position.x, top: position.y, width: position.w, height: position.h }}>{text}</span>)}
      </div>}
    </div>
    </div>
    {selected && detail && <output className="challenge-note-detail">
      <b dir="ltr">{pitchName(selected.note.midi)}</b>
      <span>{detail.cents === null ? t(`sight.${detail.status}`) : <>{t('sight.pitchError')} <bdi>{formatCents(detail.cents)}</bdi></>}</span>
    </output>}
    {manual && positioned && <button type="button" className="secondary-button challenge-resume-follow" onClick={() => {
      scrollIntent.restore();
      setPaused(undefined);
    }}>{t('resumeFollowing')}</button>}
  </div>;
}
