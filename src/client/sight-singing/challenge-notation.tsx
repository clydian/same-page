import { AlphaTabApi, LayoutMode, NotationElement, PlayerMode, StaveProfile, type rendering } from '@coderline/alphatab';
import { ScoreFollowScroll } from '@same-page/player/score-follow';
import { memo, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { useMessages } from '../../i18n';
import type { Melody, MelodyScore, MelodyVoice } from './melody';
import { pitchName, type assessNotes } from './pitch-feedback';
import './challenge-notation.css';

export type NotationNoteHit = { midi: number; track: number; staff: number; voice: number; bar: number; beatIndex: number };
export type NotationFeedback = {
  bar: number; beatIndex: number; visit: number; midi?: number | null;
  status: ReturnType<typeof assessNotes>[number]['status'];
};
type Bounds = { x: number; y: number; w: number; h: number };
type NoteTarget = NotationNoteHit & { key: string; bounds: Bounds; label: string };
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
      parts.set(`b${beat.id}`, part);
      for (const { note, noteHeadBounds: bounds } of heads ?? []) {
        if (note.isCue || note.isPercussion || note.isDead || !note.isVisible || bounds.w <= 0 || bounds.h <= 0) continue;
        notes.push({ ...part, key: `${system.index}:${note.id}`, midi: note.realValue, bounds,
          bar: master.index, beatIndex: beat.index, label: staff.track.name });
      }
    }
  }
  return { score, min, max, lookup, notes, parts };
}

const NotationButtons = memo(function NotationButtons({ notes, voice, onNote }: {
  notes: readonly NoteTarget[]; voice: MelodyVoice; onNote(hit: NotationNoteHit): void;
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
    {notes.map((note, index) => <button key={note.key} type="button" className="challenge-notation-note"
      style={{ left: centerX(note.bounds), top: centerY(note.bounds) }}
      data-midi={note.midi} data-bar={note.bar} data-track={note.track} data-staff={note.staff} data-voice={note.voice}
      data-beat-index={note.beatIndex} data-focused-part={samePart(note, voice)} tabIndex={focused === note ? 0 : -1}
      aria-label={t('sight.notationNote', { part: note.label || t('sight.voice'), pitch: pitchName(note.midi), measure: note.bar + 1 })}
      aria-keyshortcuts="ArrowLeft ArrowRight Home End" onFocus={() => setFocusKey(note.key)} onClick={event => activate(event, note)}
      onKeyDown={event => {
        const next = event.key === 'ArrowRight' ? index + 1 : event.key === 'ArrowLeft' ? index - 1
          : event.key === 'Home' ? 0 : event.key === 'End' ? notes.length - 1 : null;
        if (next === null) return;
        event.preventDefault();
        const target = buttons.current?.children.item(next);
        if (target instanceof HTMLButtonElement) target.focus();
      }} />)}
  </div>;
});

const feedbackSymbols: Record<NotationFeedback['status'], string> = {
  inTune: '✓', sharp: '↑', flat: '↓', wrongNote: '×', missed: '–', insufficientData: '?',
};

const FeedbackMarkers = memo(function FeedbackMarkers({ feedback, notes, voice, visit }: {
  feedback: readonly NotationFeedback[]; notes: readonly NoteTarget[]; voice: MelodyVoice; visit?: number;
}) {
  const beatFeedback = new Map<string, NotationFeedback>();
  for (const item of feedback) {
    const key = `${item.bar}:${item.beatIndex}`, current = beatFeedback.get(key);
    // The same printed bar can play more than once. Put the feedback for the
    // nearest selected visit on the page rather than painting several passes.
    if (!current || visit !== undefined && Math.abs(visit - item.visit) < Math.abs(visit - current.visit)) beatFeedback.set(key, item);
  }
  return <div className="challenge-score-feedback-layer" aria-hidden="true">
    {notes.flatMap(note => {
      if (!samePart(note, voice)) return [];
      const key = `${note.bar}:${note.beatIndex}`, item = beatFeedback.get(key);
      if (!item || item.midi != null && item.midi !== note.midi) return [];
      beatFeedback.delete(key);
      return <span key={key} className="challenge-notation-feedback" data-status={item.status} data-visit={item.visit}
        style={{ left: centerX(note.bounds), top: note.bounds.y + note.bounds.h + 6 }}>{feedbackSymbols[item.status]}</span>;
    })}
  </div>;
});

export function ChallengeNotation({ score, voice, melody, currentBar, currentVisit, beatIndex, onNote, feedback }: {
  score: MelodyScore['score']; voice: MelodyVoice; melody: Melody; currentBar?: number; currentVisit?: number; beatIndex?: number;
  onNote?: (note: NotationNoteHit) => void; feedback?: readonly NotationFeedback[];
}) {
  const t = useMessages('practice');
  const viewport = useRef<HTMLDivElement>(null), notation = useRef<HTMLDivElement>(null);
  const cursor = useRef<HTMLDivElement>(null), beatCursor = useRef<HTMLDivElement>(null);
  const follow = useRef<ScoreFollowScroll | null>(null);
  const hadPosition = useRef(false);
  const [geometry, setGeometry] = useState<Geometry | null>(null);
  const played = useMemo(() => new Set(melody.measures.map(bar => bar.bar)), [melody.measures]);
  const min = Math.min(...played), max = Math.max(...played);
  const rendered = geometry?.score === score && geometry.min === min && geometry.max === max ? geometry : null;
  const notes = useMemo(() => rendered?.notes.filter(note => played.has(note.bar)) ?? [], [played, rendered]);

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
      // alphaTab uses .b${beat.id} groups for the rendered beat, including lyrics.
      for (const group of element.querySelectorAll<SVGGElement>('g[class^="b"]')) {
        const part = rendered.parts.get(group.getAttribute('class') ?? '');
        if (part) group.dataset.challengePart = samePart(part, voice) ? 'focus' : 'context';
      }
    };
    // Worker system SVGs mount lazily when they enter the viewport.
    const observer = new MutationObserver(shade);
    observer.observe(element, { childList: true, subtree: true });
    shade();
    return () => observer.disconnect();
  }, [rendered, voice]);

  useEffect(() => {
    const host = viewport.current, element = notation.current, marker = cursor.current, noteMarker = beatCursor.current;
    if (!host || !element || !marker || !noteMarker) return;
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
    const beat = currentBar === undefined || beatIndex === undefined ? undefined
      : score.tracks[voice.track]?.staves[voice.staff]?.bars[currentBar]?.voices[voice.voice]?.beats[beatIndex];
    const hit = beat && rendered?.lookup.findBeat(beat);
    marker.hidden = !bounds;
    noteMarker.hidden = !bounds || !hit;
    if (!bounds) return;
    Object.assign(marker.style, { left: `${bounds.x}px`, top: `${bounds.y}px`, width: `${bounds.w}px`, height: `${bounds.h}px` });
    if (hit) Object.assign(noteMarker.style, { left: `${hit.onNotesX - 1}px`, top: `${bounds.y}px`, height: `${bounds.h}px` });
    const sheet = element.getBoundingClientRect(), view = host.getBoundingClientRect();
    const scale = element.offsetWidth ? sheet.width / element.offsetWidth : 1;
    const system = master?.staffSystemBounds?.realBounds;
    const row = system && system.h * scale + 20 <= host.clientHeight ? system : bounds;
    const top = sheet.top + row.y * scale, bottom = top + row.h * scale;
    if (top < view.top || bottom > view.bottom) follow.current?.move(host.scrollTop + top - view.top - 10);
    const left = sheet.left + (hit?.onNotesX ?? bounds.x) * scale;
    if (left < view.left || left > view.right - 8) host.scrollLeft += left - view.left - 20;
  }, [rendered, score, voice, currentBar, beatIndex]);

  return <div ref={viewport} className="challenge-notation challenge-ensemble-score" role="group" aria-label={t('sight.notation')}>
    <div className="challenge-notation-sheet">
      <div ref={notation} aria-hidden="true" />
      <div ref={cursor} className="challenge-notation-cursor" hidden aria-hidden="true" />
      <div ref={beatCursor} className="challenge-notation-beat" hidden aria-hidden="true" />
      {feedback && <FeedbackMarkers feedback={feedback} notes={notes} voice={voice} visit={currentVisit} />}
      {onNote && <NotationButtons notes={notes} voice={voice} onNote={onNote} />}
    </div>
  </div>;
}
