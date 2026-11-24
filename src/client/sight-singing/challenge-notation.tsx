import { AlphaTabApi, LayoutMode, model, NotationElement, PlayerMode, StaveProfile, type rendering } from '@coderline/alphatab';
import { ScoreFollowScroll } from '@same-page/player/score-follow';
import { memo, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { useMessages } from '../../i18n';
import type { Melody, MelodyScore, MelodyVoice } from './melody';
import { formatCents, pitchName, type assessNotes, type PitchFrame } from './pitch-feedback';
import { ScorePitchTrace } from './score-pitch-trace';
import './challenge-notation.css';

export type NotationNoteHit = { midi: number; track: number; staff: number; voice: number; bar: number; beatIndex: number };
export type NotationFeedback = {
  bar: number; beatIndex: number; visit: number; midi?: number | null;
  status: ReturnType<typeof assessNotes>[number]['status']; cents: number | null;
};
type Bounds = { x: number; y: number; w: number; h: number };
type NoteTarget = NotationNoteHit & { key: string; beatClass: string; bounds: Bounds; system: Bounds; label: string; singleStem: boolean };
type Part = Pick<NotationNoteHit, 'track' | 'staff' | 'voice'>;
type Geometry = {
  score: MelodyScore['score']; min: number; max: number; lookup: rendering.BoundsLookup;
  notes: NoteTarget[]; parts: Map<string, Part>;
};

const samePart = (a: Part, b: Part) => a.track === b.track && a.staff === b.staff && a.voice === b.voice;
const centerX = (bounds: Bounds) => bounds.x + bounds.w / 2;
const centerY = (bounds: Bounds) => bounds.y + bounds.h / 2;

function buildGeometry(api: AlphaTabApi, score: Geometry['score'], min: number, max: number): Geometry | null {
  const lookup = api.boundsLookup;
  if (!lookup) return null;
  const notes: NoteTarget[] = [], parts = new Map<string, Part>();
  for (const system of lookup.staffSystems) for (const master of system.bars) for (const bar of master.bars) {
    for (const { beat, notes: heads } of bar.beats) {
      // Worker-deserialized BarBounds does not carry a bar model reference.
      const { staff } = beat.voice.bar;
      const part = { track: staff.track.index, staff: staff.index, voice: beat.voice.index };
      const singleStem = heads?.length === 1 && beat.voice.bar.voices.every(candidate =>
        candidate === beat.voice || candidate.beats.every(other => other.isRest));
      parts.set(`b${beat.id}`, part);
      for (const { note, noteHeadBounds: bounds } of heads ?? []) {
        if (note.isCue || note.isPercussion || note.isDead || !note.isVisible || bounds.w <= 0 || bounds.h <= 0) continue;
        notes.push({ ...part, key: `${system.index}:${note.id}`, beatClass: `b${beat.id}`, midi: note.realValue, bounds,
          bar: master.index, beatIndex: beat.index, label: staff.track.name, singleStem, system: system.realBounds });
      }
    }
  }
  return { score, min, max, lookup, notes, parts };
}

const NotationButtons = memo(function NotationButtons({ notes, voice, results, onNote }: {
  notes: readonly NoteTarget[]; voice: MelodyVoice; results: ReadonlyMap<string, NotationFeedback>;
  onNote(hit: NotationNoteHit): void;
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

function feedbackAtVisit(feedback: readonly NotationFeedback[] | undefined, visit?: number) {
  const beatFeedback = new Map<string, NotationFeedback>();
  for (const item of feedback ?? []) {
    const key = `${item.bar}:${item.beatIndex}`, current = beatFeedback.get(key);
    // The same printed bar can play more than once. Put the feedback for the
    // nearest selected visit on the page rather than painting several passes.
    if (!current || visit !== undefined && Math.abs(visit - item.visit) < Math.abs(visit - current.visit)) beatFeedback.set(key, item);
  }
  return beatFeedback;
}

const labelHeight = 16;
const overlaps = (a: Bounds, b: Bounds) =>
  a.x < b.x + b.w + 1 && a.x + a.w + 1 > b.x && a.y < b.y + b.h + 1 && a.y + a.h + 1 > b.y;

function placePitchLabels(notes: NoteTarget[], results: ReadonlyMap<string, NotationFeedback>) {
  if (!results.size) return [];
  const occupied = new Map<Bounds, Bounds[]>();
  for (const note of notes) {
    const existing = occupied.get(note.system) ?? [];
    existing.push(note.bounds);
    occupied.set(note.system, existing);
  }
  return notes.flatMap(note => {
    const result = results.get(note.key);
    if (!result || result.cents === null) return [];
    const text = formatCents(result.cents), width = text.length * 7 + 6;
    const { x, y, w, h } = note.system;
    const left = Math.max(x, Math.min(x + w - width, centerX(note.bounds) - width / 2));
    const below = note.bounds.y + note.bounds.h + 3, above = note.bounds.y - labelHeight - 3;
    const obstacles = occupied.get(note.system)!;
    let position: Bounds | undefined;
    for (let offset = 0; offset < h && !position; offset += labelHeight + 2) {
      for (const top of [below + offset, above - offset]) {
        if (top < y || top + labelHeight > y + h) continue;
        const candidate = { x: left, y: top, w: width, h: labelHeight };
        if (!obstacles.some(bounds => overlaps(candidate, bounds))) { position = candidate; break; }
      }
    }
    position ??= { x: left, y: Math.max(y, Math.min(y + h - labelHeight, below)), w: width, h: labelHeight };
    obstacles.push(position);
    return [{ key: note.key, status: result.status, text, position }];
  });
}

type AssessedHead = Pick<NoteTarget, 'bounds' | 'singleStem'> & { status: NotationFeedback['status'] };
type Stem = { element: SVGRectElement; bounds: DOMRect };

function tintNoteheads(group: SVGGElement, heads: AssessedHead[], sheet: DOMRect, scale: number, stems: Stem[]) {
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
    if (!head.singleStem) continue;
    const { bounds } = head;
    const matches = stems.filter(({ bounds: stem }) => {
      const sx = (stem.left + stem.width / 2 - sheet.left) / scale;
      const top = (stem.top - sheet.top) / scale, bottom = (stem.bottom - sheet.top) / scale;
      return Math.min(Math.abs(sx - bounds.x), Math.abs(sx - (bounds.x + bounds.w))) < 1.6 &&
        Math.min(Math.abs(top - y), Math.abs(bottom - y)) < 2;
    });
    if (matches.length === 1) matches[0].element.dataset.challengeFeedback = head.status;
  }
}

export function ChallengeNotation({ score, voice, melody, currentBar, currentVisit, onNote, onMeasure, feedback, pitchFrames, liveTrace = false, traceThrough, bpm }: {
  score: MelodyScore['score']; voice: MelodyVoice; melody: Melody; currentBar?: number; currentVisit?: number;
  onNote?: (note: NotationNoteHit) => void; onMeasure?: (bar: number) => void; feedback?: readonly NotationFeedback[];
  pitchFrames?: PitchFrame[]; liveTrace?: boolean;
  traceThrough?: number; bpm: number;
}) {
  const t = useMessages('practice');
  const viewport = useRef<HTMLDivElement>(null), notation = useRef<HTMLDivElement>(null);
  const follow = useRef<ScoreFollowScroll | null>(null);
  const hadPosition = useRef(false);
  const [geometry, setGeometry] = useState<Geometry | null>(null);
  const played = useMemo(() => new Set(melody.measures.map(bar => bar.bar)), [melody.measures]);
  const min = Math.min(...played), max = Math.max(...played);
  const rendered = geometry?.score === score && geometry.min === min && geometry.max === max ? geometry : null;
  const notes = useMemo(() => rendered?.notes.filter(note => played.has(note.bar)) ?? [], [played, rendered]);
  const { results, tinted, labels } = useMemo(() => {
    const visited = feedbackAtVisit(feedback, currentVisit);
    const results = new Map<string, NotationFeedback>(), tinted = new Map<string, AssessedHead[]>();
    for (const note of notes) {
      if (!samePart(note, voice)) continue;
      const result = visited.get(`${note.bar}:${note.beatIndex}`);
      if (!result || result.midi != null && result.midi !== note.midi) continue;
      results.set(note.key, result);
      if (result.status === 'insufficientData') continue;
      const heads = tinted.get(note.beatClass) ?? [];
      heads.push({ bounds: note.bounds, status: result.status, singleStem: note.singleStem });
      tinted.set(note.beatClass, heads);
    }
    return { results, tinted, labels: placePitchLabels(notes, results) };
  }, [feedback, currentVisit, notes, voice]);

  useEffect(() => {
    const host = viewport.current, element = notation.current;
    if (!host || !element) return;
    const scroller = new ScoreFollowScroll(host);
    follow.current = scroller;
    const api = new AlphaTabApi(element, {
      core: { fontDirectory: '/font/', engine: 'svg', includeNoteBounds: true },
      display: { scale: .92, startBar: min + 1, barCount: max - min + 1, justifyLastSystem: true,
        layoutMode: LayoutMode.Page, staveProfile: StaveProfile.Score },
      player: { playerMode: PlayerMode.Disabled, enableUserInteraction: false },
    });
    api.settings.notation.elements.set(NotationElement.ScoreTitle, false);
    api.settings.notation.elements.set(NotationElement.ScoreSubTitle, false);
    api.settings.notation.elements.set(NotationElement.EffectTempo, false);
    api.updateSettings();
    const update = () => setGeometry(buildGeometry(api, score, min, max));
    api.postRenderFinished.on(update);
    api.renderScore(score, score.tracks.map(track => track.index));
    return () => { scroller.cancel(); follow.current = null; api.postRenderFinished.off(update); api.destroy(); };
  }, [score, min, max]);

  useEffect(() => {
    const element = notation.current;
    if (!rendered || !element) return;
    const shade = () => {
      for (const text of element.querySelectorAll('[data-challenge-feedback]')) text.removeAttribute('data-challenge-feedback');
      const sheet = element.getBoundingClientRect();
      const scale = element.offsetWidth ? sheet.width / element.offsetWidth : 1;
      // AlphaTab emits the stems as tall, narrow rectangles alongside the beat
      // groups. Match only a unique endpoint so a shared chord stem stays neutral.
      const stems = new Map<SVGSVGElement, Stem[]>();
      // alphaTab uses .b${beat.id} groups for the rendered beat, including lyrics.
      for (const group of element.querySelectorAll<SVGGElement>('g[class^="b"]')) {
        const beat = group.getAttribute('class') ?? '';
        const part = rendered.parts.get(beat);
        if (!part) continue;
        group.dataset.challengePart = samePart(part, voice) ? 'focus' : 'context';
        const heads = tinted.get(beat);
        if (!heads || scale <= 0) continue;
        const svg = group.ownerSVGElement;
        if (svg && !stems.has(svg)) {
          stems.set(svg, [...svg.querySelectorAll<SVGRectElement>('rect')]
            .filter(rect => rect.width.baseVal.value > 0 && rect.width.baseVal.value < 1.2 && rect.height.baseVal.value >= 12)
            .map(rect => ({ element: rect, bounds: rect.getBoundingClientRect() })));
        }
        tintNoteheads(group, heads, sheet, scale, svg ? stems.get(svg) ?? [] : []);
      }
    };
    // Worker system SVGs mount lazily when they enter the viewport.
    const observer = new MutationObserver(shade);
    observer.observe(element, { childList: true, subtree: true });
    shade();
    return () => observer.disconnect();
  }, [rendered, tinted, voice]);

  useEffect(() => {
    const host = viewport.current, element = notation.current;
    if (!host || !element) return;
    if (currentBar === undefined && hadPosition.current) {
      follow.current?.move(0);
      host.scrollLeft = 0;
    }
    hadPosition.current = currentBar !== undefined;
    const master = currentBar === undefined ? null : rendered?.lookup.findMasterBarByIndex(currentBar);
    const bounds = master?.bars.find(item => {
      const staff = item.beats[0]?.beat.voice.bar.staff;
      return staff?.track.index === voice.track && staff.index === voice.staff;
    })?.realBounds;
    if (!bounds) return;
    const sheet = element.getBoundingClientRect(), view = host.getBoundingClientRect();
    const scale = element.offsetWidth ? sheet.width / element.offsetWidth : 1;
    const system = master?.staffSystemBounds?.realBounds;
    const row = system && system.h * scale + 20 <= host.clientHeight ? system : bounds;
    const top = sheet.top + row.y * scale, bottom = top + row.h * scale;
    if (top < view.top || bottom > view.bottom) follow.current?.move(host.scrollTop + top - view.top - 10);
    const left = sheet.left + bounds.x * scale;
    if (left < view.left || left > view.right - 8) host.scrollLeft += left - view.left - 20;
  }, [rendered, voice, currentBar]);

  return <div ref={viewport} className="challenge-notation challenge-ensemble-score" role="group" aria-label={t('sight.notation')}
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
    <span className="challenge-notation-tempo" aria-label={t('adjustedTempo', { beat: '♩', bpm: String(bpm) })}>♩ = {bpm}</span>
    <div className="challenge-notation-sheet">
      <div ref={notation} aria-hidden="true" />
      {rendered && pitchFrames?.length ? <ScorePitchTrace lookup={rendered.lookup} score={score} voice={voice}
        beats={melody.staffBeats} frames={pitchFrames} currentVisit={currentVisit} live={liveTrace} through={traceThrough} viewport={viewport} /> : null}
      {onNote && <NotationButtons notes={notes} voice={voice} results={results} onNote={onNote} />}
      {labels.length > 0 && <div className="challenge-pitch-labels" aria-hidden="true">
        {labels.map(({ key, position, status, text }) => <span key={key} data-status={status}
          style={{ left: position.x, top: position.y, width: position.w, height: position.h }}>{text}</span>)}
      </div>}
    </div>
  </div>;
}
