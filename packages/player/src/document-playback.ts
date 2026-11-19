import * as at from '@coderline/alphatab';
import { PartTimbres, type PartTimbre } from './part-timbre.ts';
import { createPlaybackApi, preparePianoPlaybackMidi } from './engine.ts';
import type { PreparedMusicXml } from './musicxml-direction-timing.ts';
import { playbackMeasureVisits, type PlaybackMeasureVisit } from './playback-measures.ts';
import { playbackTempo } from './practice-tempo.ts';
import { readMusicXmlTempoMeasures } from './musicxml-metronome.ts';

class Signal<T = void> {
  private listeners = new Set<(value: T) => void>();
  on(listener: (value: T) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  emit(value: T) { for (const listener of this.listeners) listener(value); }
}
type Native = at.AlphaTabApi;
type TickCache = NonNullable<Native['tickCache']>;
type TickBar = TickCache['masterBars'][number];
type Piece = {
  score: at.model.Score; prepared: PreparedMusicXml; sourceOffset: number; tickOffset: number;
  lookup?: TickCache; midi?: at.midi.MidiFile; shift: number; transpositions: Map<number, number>;
  element: HTMLDivElement; bounds: at.rendering.BoundsLookup | null; top: number; height: number;
};
type Bounds = Pick<at.rendering.BoundsLookup, 'findMasterBar' | 'findMasterBarByIndex' | 'findBeats' | 'getBeatAtPos' | 'staffSystems'>;
/** Private to createPlayerSession: only its notation/transport/mix calls are
 * document-aware. Other delegates (e.g. export or direct renderScore) do not
 * represent the collection; this is not a general AlphaTabApi replacement. */
export type DocumentPlaybackApi = Omit<Native, 'boundsLookup' | 'renderer' | 'tickCache'> & {
  readonly boundsLookup: Bounds | null;
  readonly renderer: { partialRenderFinished: Signal<at.rendering.RenderFinishedEventArgs> };
  readonly tickCache: Pick<TickCache, 'masterBars' | 'getBeatStart'> | null;
  readonly renderedScores: at.model.Score[];
  ensureMeasure(bar: at.model.MasterBar): void;
  captureView(): () => void;
  readonly isCollection: boolean;
  readonly playbackVisits: PlaybackMeasureVisit[];
  sourceIndex(bar: at.model.MasterBar): number;
  tempoAt(tick: number): { bpm: number; unit: number };
  partTimbre(id: number): PartTimbre;
  changePartTimbre(id: number, value: PartTimbre): Promise<boolean>;
  renderScores(scores: at.model.Score[], prepared: PreparedMusicXml[]): void;
};

export class CollectionPlaybackError extends Error {
  readonly code: "opusPieceTimeout" | "opusEmptyPiece";

  constructor(code: "opusPieceTimeout" | "opusEmptyPiece", message: string) {
    super(message);
    this.code = code;
  }
}

/** One native resource owner and one transport. A normal score keeps native rendering;
 * an opus supplies independent notation views and offsets into that same transport. */
export function createDocumentPlaybackApi(element: HTMLElement, settings: ConstructorParameters<typeof at.AlphaTabApi>[1]): DocumentPlaybackApi {
  const native = createPlaybackApi(element, settings);
  const timbres = new WeakMap<at.model.Score, PartTimbres>();
  let timbreReplyTick: number | null = null;
  let singleMidi: at.midi.MidiFile | undefined;
  native.midiLoad.on(file => {
    singleMidi = file;
    if (native.score) timbres.get(native.score)?.apply(file);
  });
  let pieces: Piece[] = [], active = 0, collection = false, disposed = false;
  let range: at.synth.PlaybackRange | null = null, looping = false, wantedPlaying = false;
  let cancelMidiLoad: (() => void) | undefined;
  let pending: { tick: number; resume: boolean } | null = null, switching = false, replyTick: number | null = null;
  let globalBars: TickBar[] = [], visits: PlaybackMeasureVisit[] = [], renderer: at.rendering.ScoreRenderer | null = null;
  let animation = 0, rendering: Piece | null = null, cursorBeat: at.model.Beat | null = null, cursorRunning = false;
  const initialStyle = { height: element.style.height, position: element.style.position, overflowAnchor: element.style.overflowAnchor };
  const viewport = native.settings.player.scrollElement as HTMLElement;
  let viewFrame = 0, invalidated = false, layoutWidth = 0, layoutScale = native.settings.display.scale;
  type Anchor = { piece: Piece; bar?: number; offset: number; fraction?: number };
  let layoutAnchor: Anchor | null = null;
  const highlighted = new Set<Element>();
  const clearHighlights = () => { for (const node of highlighted) node.classList.remove('at-highlight'); highlighted.clear(); };
  const sourcePiece = new Map<at.model.Score, Piece>();
  const error = new Signal<Error>(), started = new Signal(), rendered = new Signal();
  const partial = new Signal<at.rendering.RenderFinishedEventArgs>();
  const position = new Signal<at.synth.PositionChangedEventArgs>(), scoreLoaded = new Signal<at.model.Score>();
  const barCursor = document.createElement('div'), beatCursor = document.createElement('div');
  barCursor.className = 'at-cursor-bar'; beatCursor.className = 'at-cursor-beat';
  for (const cursor of [barCursor, beatCursor]) { cursor.style.cssText = 'position:absolute;pointer-events:none;z-index:3'; cursor.hidden = true; }
  const player = () => native.player!;
  const yieldToBrowser = () => {
    const scheduler = (globalThis as typeof globalThis & { scheduler?: { yield(): Promise<void> } }).scheduler;
    return scheduler?.yield ? scheduler.yield() : new Promise<void>(resolve => setTimeout(resolve, 0));
  };
  const sourceIndex = (bar: at.model.MasterBar) => (sourcePiece.get(bar.score)?.sourceOffset ?? 0) + bar.index;
  const pieceAt = (tick: number) => pieces.findLastIndex(piece => piece.tickOffset <= tick);
  const translated = <T extends { y: number }>(bounds: T, top: number): T => ({ ...bounds, y: bounds.y + top });
  const beatBounds = (bounds: at.rendering.BeatBounds, top: number): at.rendering.BeatBounds => Object.assign(Object.create(Object.getPrototypeOf(bounds)), bounds, {
    realBounds: translated(bounds.realBounds, top),
    notes: bounds.notes?.map(note => ({ ...note, noteHeadBounds: translated(note.noteHeadBounds, top) })),
  });
  const masterBounds = (bounds: at.rendering.MasterBarBounds | null, piece: Piece): at.rendering.MasterBarBounds | null => bounds && Object.assign(Object.create(Object.getPrototypeOf(bounds)), bounds, {
    index: bounds.index + piece.sourceOffset,
    realBounds: translated(bounds.realBounds, piece.top), visualBounds: translated(bounds.visualBounds, piece.top),
    staffSystemBounds: bounds.staffSystemBounds && { ...bounds.staffSystemBounds, realBounds: translated(bounds.staffSystemBounds.realBounds, piece.top) },
    bars: bounds.bars.map(bar => ({ ...bar, realBounds: translated(bar.realBounds, piece.top), beats: bar.beats.map(beat => beatBounds(beat, piece.top)) })),
  });
  const bounds: Bounds = {
    get staffSystems() { return pieces.flatMap(piece => (piece.bounds?.staffSystems ?? []).map(system => Object.assign(Object.create(Object.getPrototypeOf(system)), system, { realBounds: translated(system.realBounds, piece.top), visualBounds: translated(system.visualBounds, piece.top), bars: system.bars.map(bar => masterBounds(bar, piece)!) }))); },
    findMasterBar(bar) { const piece = sourcePiece.get(bar.score); return piece ? masterBounds(piece.bounds?.findMasterBar(bar) ?? null, piece) : null; },
    findMasterBarByIndex(index) { const piece = pieces.findLast(piece => piece.sourceOffset <= index); return piece ? masterBounds(piece.bounds?.findMasterBarByIndex(index - piece.sourceOffset) ?? null, piece) : null; },
    findBeats(beat) { const piece = sourcePiece.get(beat.voice.bar.staff.track.score); return (piece?.bounds?.findBeats(beat) ?? []).map(bounds => beatBounds(bounds, piece!.top)); },
    getBeatAtPos(x, y) { const piece = pieces.find(piece => y >= piece.top && y <= piece.top + piece.height); return piece?.bounds?.getBeatAtPos(x, y - piece.top) ?? null; },
  };
  const fail = (reason: unknown) => { wantedPlaying = false; pending = null; error.emit(reason instanceof Error ? reason : new Error(String(reason))); };
  native.error.on(reason => error.emit(reason));
  native.renderStarted.on(() => { if (!collection) started.emit(); });
  native.postRenderFinished.on(() => { if (!collection) rendered.emit(); });
  native.renderer.partialRenderFinished.on(event => { if (!collection) partial.emit(event); });
  native.scoreLoaded.on(score => { if (!collection) scoreLoaded.emit(score); });

  function drawCursor(tick: number, force = false) {
    if (!collection || disposed) return;
    const piece = pieces[active];
    const found = piece?.lookup?.findBeat(new Set(piece.score.tracks.map(track => track.index)), tick);
    const beat = found?.beat, hit = beat && piece.bounds?.findBeat(beat);
    if (!found || !hit || !beat) { barCursor.hidden = true; beatCursor.hidden = true; clearHighlights(); return; }
    const running = native.playerState === at.synth.PlayerState.Playing && !native.customCursorHandler;
    if (beat === cursorBeat && !force && running === cursorRunning) return;
    cursorBeat = beat; cursorRunning = running; cancelAnimationFrame(animation);
    const bar = hit.barBounds.masterBarBounds.visualBounds;
    barCursor.hidden = false; beatCursor.hidden = false;
    Object.assign(barCursor.style, { left: `${bar.x}px`, top: `${bar.y + piece.top}px`, width: `${bar.w}px`, height: `${bar.h}px` });
    const x = hit.onNotesX;
    Object.assign(beatCursor.style, { left: '0', top: `${bar.y + piece.top}px`, width: '1px', height: `${bar.h}px`, transition: 'none', transform: `translateX(${x}px)` });
    clearHighlights();
    if (running) {
      for (const highlight of found.beatLookup.highlightedBeats) piece.element.querySelectorAll(`.b${highlight.beat.id}`).forEach(node => { node.classList.add('at-highlight'); highlighted.add(node); });
      const next = found.nextBeat && piece.bounds?.findBeat(found.nextBeat.beat);
      const end = next?.barBounds.masterBarBounds.staffSystemBounds === hit.barBounds.masterBarBounds.staffSystemBounds ? next.onNotesX : bar.x + bar.w;
      animation = requestAnimationFrame(() => { if (!disposed) Object.assign(beatCursor.style, { transition: `transform ${found.duration / native.playbackSpeed}ms linear`, transform: `translateX(${end}px)` }); });
    }
  }
  function localRange() {
    const piece = pieces[active], end = piece.tickOffset + (piece.lookup?.masterBars.at(-1)?.end ?? 0);
    return { startTick: Math.max(0, (range?.startTick ?? 0) - piece.tickOffset) + piece.shift, endTick: Math.min(end, range?.endTick ?? end) - piece.tickOffset + piece.shift };
  }
  function configureRange() {
    if (!collection || !pieces[active]?.lookup) return;
    const next = localRange();
    if (next.startTick >= next.endTick) { player().playbackRange = null; player().isLooping = false; return; }
    player().playbackRange = next;
    const first = pieceAt(range?.startTick ?? 0), last = pieceAt(Math.max(0, (range?.endTick ?? Infinity) - 1));
    player().isLooping = looping && first === last;
  }
  async function switchPending() {
    if (switching || disposed || !collection) return;
    switching = true;
    try {
      while (pending && !disposed) {
        const request = pending; pending = null;
        const index = Math.max(0, pieceAt(request.tick)), piece = pieces[index];
        player().pause();
        if (active !== index || !player().loadedMidiInfo) {
          // Native wrapper events replay the previous MIDI on subscription. Only
          // the asynchronous reply to this serialized load may complete it.
          await new Promise<void>((resolve, reject) => {
            let armed = false, off: () => void = () => {};
            const finish = () => { clearTimeout(timer); off(); cancelMidiLoad = undefined; resolve(); };
            const timer = setTimeout(() => { off(); cancelMidiLoad = undefined; reject(new CollectionPlaybackError('opusPieceTimeout', '准备曲目用时过长。')); }, 30_000);
            cancelMidiLoad = finish;
            off = player().midiLoaded.on(() => { if (armed) finish(); });
            armed = true; player().resetChannelStates(); player().loadMidiFile(piece.midi!);
          });
          if (disposed) return;
          active = index; player().applyTranspositionPitches(piece.transpositions); scoreLoaded.emit(piece.score);
        }
        if (pending) continue;
        configureRange();
        const tick = request.tick - piece.tickOffset + piece.shift;
        replyTick = tick; player().tickPosition = tick; cursorBeat = null; drawCursor(tick - piece.shift, true);
        wantedPlaying = request.resume;
        if (wantedPlaying) player().play();
      }
    } catch (reason) { fail(reason); } finally { switching = false; if (pending && !disposed) void switchPending(); }
  }
  native.playerPositionChanged.on(event => {
    if (switching) return;
    if (!collection) {
      if (timbreReplyTick !== null) {
        if (!event.isSeek || Math.abs(event.currentTick - timbreReplyTick) > 1) return;
        timbreReplyTick = null;
      }
      position.emit(event); return;
    }
    if (disposed || switching || pending || !pieces[active]?.lookup) return;
    const piece = pieces[active];
    if (replyTick !== null && event.countInBeats === 0) {
      if (!event.isSeek || Math.abs(event.currentTick - replyTick) > 1) return;
      replyTick = null;
    }
    const local = event.currentTick - piece.shift;
    if (!event.countInBeats) drawCursor(local, event.isSeek);
    position.emit({ ...event, currentTick: local + piece.tickOffset });
  });
  native.playerStateChanged.on(() => { if (!disposed && collection && pieces[active]?.lookup) drawCursor(player().tickPosition - pieces[active].shift, true); });
  native.playerFinished.on(() => {
    if (!collection || disposed || switching || !wantedPlaying || player().isLooping) return;
    const piece = pieces[active], end = piece.tickOffset + piece.lookup!.masterBars.at(-1)!.end;
    const last = range?.endTick ?? globalBars.at(-1)!.end;
    const next = end < last ? end : looping ? range?.startTick ?? 0 : null;
    if (next === null) { wantedPlaying = false; pending = { tick: 0, resume: false }; queueMicrotask(() => { void switchPending(); }); return; }
    pending = { tick: next, resume: true }; queueMicrotask(() => { void switchPending(); });
  });

  // Playback addresses measures. Notation keeps only the viewport and a small
  // surrounding window; off-screen heights are estimates until visited.
  const visualScale = () => {
    const width = parseFloat(getComputedStyle(element).width), screenWidth = element.getBoundingClientRect().width;
    return width > 0 && screenWidth > 0 ? screenWidth / width : 1;
  };
  const visibleTop = () => (viewport.getBoundingClientRect().top - element.getBoundingClientRect().top) / visualScale();
  function readAnchor(): Anchor | null {
    const top = visibleTop(), piece = pieces.find(piece => piece.top + piece.height > top) ?? pieces.at(-1);
    if (!piece) return null;
    const bar = piece.bounds?.staffSystems.find(system => piece.top + system.realBounds.y + system.realBounds.h > top)?.bars[0];
    if (!bar && top > piece.top) return { piece, offset: 0, fraction: Math.min(1, (top - piece.top) / piece.height) };
    return { piece, bar: bar?.index, offset: piece.top + (bar?.realBounds.y ?? 0) - top };
  }
  function placePieces(anchor: Anchor | null) {
    let top = 0;
    for (const piece of pieces) {
      piece.top = top;
      Object.assign(piece.element.style, { top: `${top}px`, height: `${piece.height}px` });
      top += piece.height + 24;
    }
    element.style.height = `${top}px`;
    if (anchor) {
      const bar = anchor.bar === undefined ? null : anchor.piece.bounds?.findMasterBarByIndex(anchor.bar);
      const local = bar?.realBounds.y ?? (anchor.fraction ?? 0) * anchor.piece.height;
      viewport.scrollTop += (anchor.piece.top + local - visibleTop() - anchor.offset) * visualScale();
    }
  }
  function renderPiece(piece: Piece) {
    if (piece.bounds || !renderer || disposed) return false;
    piece.element.replaceChildren();
    rendering = piece; renderer.width = element.clientWidth;
    renderer.renderScore(piece.score, piece.score.tracks.map(track => track.index));
    piece.bounds = renderer.boundsLookup; rendering = null;
    return true;
  }
  function updateViews() {
    if (disposed || !renderer) return;
    let changed = invalidated;
    if (invalidated) {
      const scale = native.settings.display.scale, ratio = scale / layoutScale;
      clearHighlights();
      for (const piece of pieces) { piece.bounds = null; piece.element.replaceChildren(); piece.height *= ratio; }
      layoutScale = scale; layoutWidth = element.clientWidth; invalidated = false;
      // Reflow the reading anchor first, before correcting the document's
      // estimated offsets. Its source measure stays at the same screen position.
      if (layoutAnchor) renderPiece(layoutAnchor.piece);
      placePieces(layoutAnchor); layoutAnchor = null;
    }
    const anchor = readAnchor(), top = visibleTop(), height = viewport.clientHeight / visualScale(), margin = height / 2;
    const visible = new Set(pieces.filter(piece => piece.top + piece.height >= top - margin && piece.top <= top + height + margin));
    for (const piece of pieces) {
      if (visible.has(piece)) changed = renderPiece(piece) || changed;
      else if (piece.bounds) { piece.element.replaceChildren(); piece.bounds = null; changed = true; }
    }
    if (!changed) return;
    placePieces(anchor); cursorBeat = null; drawCursor(player().tickPosition - pieces[active].shift, true);
    rendered.emit();
    // A measured height may expose another neighboring placeholder.
    scheduleViews();
  }
  function scheduleViews() {
    if (disposed || !collection || viewFrame) return;
    viewFrame = requestAnimationFrame(() => { viewFrame = 0; try { updateViews(); } catch (reason) { fail(reason); } });
  }
  function invalidateLayout() {
    if (!renderer || disposed) return;
    if (!invalidated) { layoutAnchor = readAnchor(); started.emit(); }
    invalidated = true; scheduleViews();
  }
  function ensureMeasure(bar: at.model.MasterBar) {
    if (!collection || disposed || !renderer) return;
    if (invalidated) updateViews();
    const piece = sourcePiece.get(bar.score);
    if (piece && renderPiece(piece)) { placePieces(readAnchor()); rendered.emit(); }
  }
  async function prepareViews() {
    // Bootstrap native font resources once; the otherwise-unused render worker
    // can then be released. One renderer serves the bounded notation window.
    await new Promise<void>(resolve => {
      const off = native.postRenderFinished.on(() => { off(); resolve(); }); native.render();
    });
    if (disposed) return;
    native.renderer.destroy();
    const surface = element.querySelector('.at-surface') as HTMLElement | null;
    surface?.style.setProperty('display', 'none');
    native.settings.core.enableLazyLoading = false;
    renderer = new at.rendering.ScoreRenderer(native.settings);
    renderer.error.on(fail);
    renderer.partialRenderFinished.on(event => {
      if (!rendering || typeof event.renderResult !== 'string') return;
      const partialElement = document.createElement('div');
      partialElement.style.cssText = `position:absolute;left:${event.x}px;top:${event.y}px`;
      partialElement.innerHTML = event.renderResult; rendering.element.append(partialElement);
      rendering.height = event.totalHeight; partial.emit(event);
    });
    Object.assign(element.style, { position: 'relative', overflowAnchor: 'none' });
    layoutWidth = element.clientWidth; layoutScale = native.settings.display.scale;
    const barsPerRow = Math.max(1, Math.floor((layoutWidth - 60) / (80 * layoutScale / .6)));
    for (const piece of pieces) {
      const staves = piece.score.tracks.reduce((sum, track) => sum + track.staves.length, 0);
      piece.height = (100 + Math.ceil(piece.score.masterBars.length / barsPerRow) * (40 + staves * 45)) * layoutScale / .6;
      piece.element.className = `${surface?.className ?? 'at-surface at'} practice-score-piece`;
      piece.element.style.cssText = 'position:absolute;left:0;width:100%';
      element.append(piece.element);
    }
    element.append(barCursor, beatCursor); placePieces(null); started.emit(); updateViews();
  }
  viewport.addEventListener('scroll', scheduleViews, { passive: true });
  const resize = new ResizeObserver(() => {
    if (collection && renderer && layoutWidth !== element.clientWidth) invalidateLayout();
  });
  resize.observe(element);
  const custom = {
    get renderedScores() { return pieces.filter(piece => !collection || piece.bounds).map(piece => piece.score); },
    ensureMeasure,
    captureView() {
      const anchor = collection ? readAnchor() : null, top = viewport.scrollTop;
      return () => {
        if (disposed) return;
        if (!anchor) { viewport.scrollTop = top; return; }
        if (invalidated) updateViews();
        renderPiece(anchor.piece); placePieces(null); rendered.emit();
        // Restore after host annotations/follow callbacks have run.
        placePieces(anchor); scheduleViews();
      };
    },
    get isCollection() { return collection; },
    get score() { return collection ? pieces[active]?.score ?? null : native.score; },
    get boundsLookup() { return collection ? bounds : native.boundsLookup; },
    get tickCache() { return collection ? { masterBars: globalBars, getBeatStart(beat: at.model.Beat) { const piece = sourcePiece.get(beat.voice.bar.staff.track.score)!; return piece.lookup!.getBeatStart(beat) + piece.tickOffset; } } : native.tickCache; },
    get playbackVisits() { return visits; }, sourceIndex,
    tempoAt(tick: number) { const index = collection ? Math.max(0, pieceAt(tick)) : 0, piece = pieces[index]; return playbackTempo(collection ? piece?.lookup?.masterBars ?? [] : native.tickCache?.masterBars ?? [], tick - (piece?.tickOffset ?? 0), piece?.prepared.tempoMeasures ?? []); },
    error, renderStarted: started, postRenderFinished: rendered, renderer: { partialRenderFinished: partial }, playerPositionChanged: position, scoreLoaded,
    get tickPosition() { return collection ? player().tickPosition - pieces[active].shift + pieces[active].tickOffset : native.tickPosition; },
    set tickPosition(tick: number) { if (!collection) { native.tickPosition = tick; return; } pending = { tick, resume: wantedPlaying }; void switchPending(); },
    get isLooping() { return collection ? looping : native.isLooping; },
    set isLooping(value: boolean) { if (!collection) native.isLooping = value; else { looping = value; configureRange(); } },
    get playbackRange() { return collection ? range : native.playbackRange; },
    set playbackRange(value: at.synth.PlaybackRange | null) { if (!collection) native.playbackRange = value; else { range = value; configureRange(); } },
    play() { if (!collection) return native.play(); wantedPlaying = true; if (pending) pending.resume = true; if (!switching) return player().play(); return true; },
    pause() { if (!collection) { native.pause(); return; } wantedPlaying = false; if (pending) pending.resume = false; player().pause(); },
    render() { if (!collection) native.render(); else invalidateLayout(); },
    partTimbre(id: number) { const score = collection ? pieces[active]?.score : native.score; return score ? timbres.get(score)?.get(id) ?? 'score' : 'score'; },
    async changePartTimbre(id: number, value: PartTimbre) {
      if (disposed || switching || pending) return false;
      const score = collection ? pieces[active]?.score : native.score;
      const file = collection ? pieces[active]?.midi : singleMidi;
      if (!score || !file || !player().isReadyForPlayback) return false;
      const selection = timbres.get(score)!;
      if (selection.get(id) === value) return true;
      // No score mutation or MIDI regeneration: tick lookup, notation, source
      // preparation and the other pieces' MIDI keep their exact identities.
      const tick = player().tickPosition;
      const notationTick = native.tickPosition;
      const savedRange = player().playbackRange, savedLooping = player().isLooping;
      switching = true;
      try {
        selection.set(id, value); selection.apply(file);
        player().pause();
        await new Promise<void>((resolve, reject) => {
          let armed = false, off: () => void = () => {};
          const finish = () => { clearTimeout(timer); off(); cancelMidiLoad = undefined; resolve(); };
          const timer = setTimeout(() => { off(); cancelMidiLoad = undefined; reject(new Error('更换音色用时过长，请重新打开乐谱。')); }, 30_000);
          cancelMidiLoad = finish;
          off = player().midiLoaded.on(() => { if (armed) finish(); });
          armed = true; player().loadMidiFile(file);
        });
        if (disposed) return false;
        player().playbackRange = savedRange; player().isLooping = savedLooping;
        player().tickPosition = tick;
        if (collection) replyTick = tick; else timbreReplyTick = notationTick;
        return true;
      } finally { switching = false; }
    },
    renderScores(scores: at.model.Score[], prepared: PreparedMusicXml[]) {
      for (const score of scores) timbres.set(score, new PartTimbres(score));
      collection = scores.length > 1; visits = []; sourcePiece.clear();
      let sourceOffset = 0;
      pieces = scores.map((score, index) => {
        const source = prepared[index];
        const piece: Piece = { score, prepared: { ...source, tempoMeasures: source.tempoMeasures ?? readMusicXmlTempoMeasures(source.bytes) }, sourceOffset, tickOffset: 0, shift: 0, transpositions: new Map(), element: document.createElement('div'), bounds: null, top: 0, height: 0 };
        sourceOffset += score.masterBars.length; sourcePiece.set(score, piece); return piece;
      });
      if (!collection) { native.renderScore(scores[0], scores[0].tracks.map(track => track.index)); return; }
      native.settings.player.enableCursor = false; native.settings.player.enableElementHighlighting = false; native.updateSettings();
      void (async () => {
        let tickOffset = 0; globalBars = [];
        for (const piece of pieces) {
          if (disposed) return;
          const file = new at.midi.MidiFile(), handler = new at.midi.AlphaSynthMidiFileHandler(file), generator = new at.midi.MidiFileGenerator(piece.score, native.settings, handler);
          generator.applyTranspositionPitches = false; generator.generate(); preparePianoPlaybackMidi(piece.score, file, native.settings);
          if (!generator.tickLookup.masterBars.length || !(generator.tickLookup.masterBars.at(-1)!.end > 0)) throw new CollectionPlaybackError('opusEmptyPiece', '合集包含没有可播放小节的曲目。');
          piece.lookup = generator.tickLookup; piece.midi = file; piece.shift = handler.tickShift; piece.transpositions = generator.transpositionPitches; piece.tickOffset = tickOffset;
          globalBars.push(...piece.lookup.masterBars.map(bar => Object.assign(Object.create(Object.getPrototypeOf(bar)), bar, { start: bar.start + tickOffset, end: bar.end + tickOffset })));
          const index = pieces.indexOf(piece);
          visits.push(...playbackMeasureVisits(piece.lookup.masterBars.map(bar => `${index + 1}-${piece.prepared.measureLabels?.[bar.masterBar.index] ?? bar.masterBar.index + 1}`)));
          tickOffset += piece.lookup.masterBars.at(-1)?.end ?? 0; await yieldToBrowser();
        }
        await prepareViews();
        if (!disposed) { pending = { tick: 0, resume: false }; void switchPending(); }
      })().catch(fail);
    },
    destroy() { disposed = true; cancelMidiLoad?.(); pending = null; wantedPlaying = false; resize.disconnect(); viewport.removeEventListener('scroll', scheduleViews); cancelAnimationFrame(viewFrame); cancelAnimationFrame(animation); clearHighlights(); renderer?.destroy(); native.destroy(); for (const piece of pieces) piece.element.remove(); barCursor.remove(); beatCursor.remove(); element.style.height = initialStyle.height; element.style.position = initialStyle.position; element.style.overflowAnchor = initialStyle.overflowAnchor; },
  };
  return new Proxy(native, {
    get(target, key) { if (key in custom) return Reflect.get(custom, key); const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value; },
    set(target, key, value) { return key in custom ? Reflect.set(custom, key, value) : Reflect.set(target, key, value, target); },
  }) as unknown as DocumentPlaybackApi;
}
