import * as at from '@coderline/alphatab';
import { createPlaybackApi, preparePianoPlaybackMidi } from './engine.ts';
import type { PreparedMusicXml } from './musicxml-direction-timing.ts';
import { playbackMeasureLabels } from './playback-measures.ts';
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
export type DocumentPlaybackApi = Omit<Native, 'boundsLookup' | 'renderer' | 'tickCache'> & {
  readonly boundsLookup: Bounds | null;
  readonly renderer: { partialRenderFinished: Signal<at.rendering.RenderFinishedEventArgs> };
  readonly tickCache: Pick<TickCache, 'masterBars' | 'getBeatStart'> | null;
  readonly scores: at.model.Score[];
  readonly isCollection: boolean;
  readonly playbackLabels: string[];
  sourceIndex(bar: at.model.MasterBar): number;
  tempoAt(tick: number): { bpm: number; unit: number };
  renderScores(scores: at.model.Score[], prepared: PreparedMusicXml[]): void;
};

/** One native resource owner and one transport. A normal score keeps native rendering;
 * an opus supplies independent notation views and offsets into that same transport. */
export function createDocumentPlaybackApi(element: HTMLElement, settings: ConstructorParameters<typeof at.AlphaTabApi>[1]): DocumentPlaybackApi {
  const native = createPlaybackApi(element, settings);
  let pieces: Piece[] = [], active = 0, collection = false, disposed = false;
  let range: at.synth.PlaybackRange | null = null, looping = false, wantedPlaying = false;
  let cancelMidiLoad: (() => void) | undefined;
  let pending: { tick: number; resume: boolean } | null = null, switching = false, replyTick: number | null = null;
  let globalBars: TickBar[] = [], labels: string[] = [], renderer: at.rendering.ScoreRenderer | null = null;
  let renderGeneration = 0, animation = 0, rendering: Piece | null = null, cursorBeat: at.model.Beat | null = null, cursorRunning = false;
  const initialStyle = { height: element.style.height, position: element.style.position };
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
    if (!found || !hit || !beat) return;
    const running = native.playerState === at.synth.PlayerState.Playing && !native.customCursorHandler;
    if (beat === cursorBeat && !force && running === cursorRunning) return;
    cursorBeat = beat; cursorRunning = running; cancelAnimationFrame(animation);
    const bar = hit.barBounds.masterBarBounds.visualBounds;
    barCursor.hidden = false; beatCursor.hidden = false;
    Object.assign(barCursor.style, { left: `${bar.x}px`, top: `${bar.y + piece.top}px`, width: `${bar.w}px`, height: `${bar.h}px` });
    const x = hit.onNotesX;
    Object.assign(beatCursor.style, { left: '0', top: `${bar.y + piece.top}px`, width: '1px', height: `${bar.h}px`, transition: 'none', transform: `translateX(${x}px)` });
    element.querySelectorAll('.practice-score-piece .at-highlight').forEach(node => node.classList.remove('at-highlight'));
    if (running) {
      for (const highlight of found.beatLookup.highlightedBeats) piece.element.querySelectorAll(`.b${highlight.beat.id}`).forEach(node => node.classList.add('at-highlight'));
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
            const timer = setTimeout(() => { off(); cancelMidiLoad = undefined; reject(new Error('准备曲目用时过长。')); }, 30_000);
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
    if (!collection) { position.emit(event); return; }
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

  async function renderCollection(generation: number) {
    started.emit();
    // Let the native owner finish font setup before handing SVG layout to the
    // independent views. Its unused rendering worker can then be released.
    if (!renderer) {
      await new Promise<void>(resolve => {
        const off = native.postRenderFinished.on(() => { off(); resolve(); }); native.render();
      });
      if (disposed || generation !== renderGeneration) return;
      native.renderer.destroy();
      (element.querySelector('.at-surface') as HTMLElement | null)?.style.setProperty('display', 'none');
      renderer = new at.rendering.ScoreRenderer(native.settings);
      native.settings.core.enableLazyLoading = false;
      renderer.error.on(fail);
      renderer.partialRenderFinished.on(event => {
        if (!rendering || typeof event.renderResult !== 'string') return;
        const partialElement = document.createElement('div');
        partialElement.style.cssText = `position:absolute;left:${event.x}px;top:${event.y}px`;
        partialElement.innerHTML = event.renderResult; rendering.element.append(partialElement);
        rendering.height = event.totalHeight;
        partial.emit(event);
      });
    }
    let top = 0;
    const width = element.clientWidth;
    const nativeClass = element.querySelector('.at-surface')?.className ?? 'at-surface at';
    element.style.position = 'relative';
    for (const piece of pieces) {
      if (disposed || generation !== renderGeneration) return;
      piece.top = top; piece.element.replaceChildren();
      piece.element.className = `${nativeClass} practice-score-piece`;
      piece.element.style.cssText = `position:absolute;left:0;top:${top}px;width:100%`;
      if (!piece.element.parentElement) element.append(piece.element);
      rendering = piece; renderer.width = width; renderer.renderScore(piece.score, piece.score.tracks.map(track => track.index)); piece.bounds = renderer.boundsLookup; rendering = null;
      piece.element.style.height = `${piece.height}px`; top += piece.height + 24; element.style.height = `${top}px`;
      // Bounds are ready before notifying the shared annotations/follow layer.
      await yieldToBrowser();
    }
    if (disposed || generation !== renderGeneration) return;
    element.append(barCursor, beatCursor); cursorBeat = null; drawCursor(player().tickPosition - pieces[active].shift, true);
    rendered.emit();
  }
  const resize = new ResizeObserver(() => {
    if (!collection || disposed || !renderer || renderer.width === element.clientWidth) return;
    const generation = ++renderGeneration; void renderCollection(generation).catch(fail);
  });
  resize.observe(element);
  const custom = {
    get scores() { return pieces.map(piece => piece.score); },
    get isCollection() { return collection; },
    get score() { return collection ? pieces[active]?.score ?? null : native.score; },
    get boundsLookup() { return collection ? bounds : native.boundsLookup; },
    get tickCache() { return collection ? { masterBars: globalBars, getBeatStart(beat: at.model.Beat) { const piece = sourcePiece.get(beat.voice.bar.staff.track.score)!; return piece.lookup!.getBeatStart(beat) + piece.tickOffset; } } : native.tickCache; },
    get playbackLabels() { return labels; }, sourceIndex,
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
    render() { if (!collection) native.render(); else void renderCollection(++renderGeneration).catch(fail); },
    renderScores(scores: at.model.Score[], prepared: PreparedMusicXml[]) {
      collection = scores.length > 1; labels = []; sourcePiece.clear();
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
          if (!generator.tickLookup.masterBars.length || !(generator.tickLookup.masterBars.at(-1)!.end > 0)) throw new Error('合集包含没有可播放小节的曲目。');
          piece.lookup = generator.tickLookup; piece.midi = file; piece.shift = handler.tickShift; piece.transpositions = generator.transpositionPitches; piece.tickOffset = tickOffset;
          globalBars.push(...piece.lookup.masterBars.map(bar => Object.assign(Object.create(Object.getPrototypeOf(bar)), bar, { start: bar.start + tickOffset, end: bar.end + tickOffset })));
          const index = pieces.indexOf(piece);
          labels.push(...playbackMeasureLabels(piece.lookup.masterBars.map(bar => `${index + 1}-${piece.prepared.measureLabels?.[bar.masterBar.index] ?? bar.masterBar.index + 1}`)));
          tickOffset += piece.lookup.masterBars.at(-1)?.end ?? 0; await yieldToBrowser();
        }
        await renderCollection(++renderGeneration);
        if (!disposed) { pending = { tick: 0, resume: false }; void switchPending(); }
      })().catch(fail);
    },
    destroy() { disposed = true; cancelMidiLoad?.(); pending = null; wantedPlaying = false; resize.disconnect(); cancelAnimationFrame(animation); renderer?.destroy(); native.destroy(); for (const piece of pieces) piece.element.remove(); barCursor.remove(); beatCursor.remove(); element.style.height = initialStyle.height; element.style.position = initialStyle.position; },
  };
  return new Proxy(native, {
    get(target, key) { if (key in custom) return Reflect.get(custom, key); const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value; },
    set(target, key, value) { return key in custom ? Reflect.set(custom, key, value) : Reflect.set(target, key, value, target); },
  }) as unknown as DocumentPlaybackApi;
}
