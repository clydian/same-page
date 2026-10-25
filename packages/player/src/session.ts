import { assignPlaybackChannels, createPlaybackApi, loadPreparedMusicXml } from './engine.ts';
import { solfegeDegreeLabel } from './solfege-degree.ts';
import * as alphaTab from '@coderline/alphatab';
import { applyTimbreProfile, classifyTimbreRoles } from './timbre-profile.ts';
import { ScoreFollowSession, isPointerDrag } from './score-follow.ts';
import { playbackTempo } from './practice-tempo.ts';
import { readMusicXmlTempoMeasures, type MusicXmlTempoMeasure } from './musicxml-metronome.ts';
import { playbackMeasureLabels } from './playback-measures.ts';
import type { PreparedMusicXml } from './musicxml-direction-timing.ts';
import { isCompatibleMusicXmlPreparation } from './preparation-format.ts';
export { CURRENT_IMPORT_INPUT_VERSION, isCompatibleMusicXmlPreparation } from './preparation-format.ts';

export interface PlayerPart { id: number; name: string; volume: number; baseVolume?: number; muted: boolean; solo: boolean }
export interface PlayerMeasure { index: number; label: string; startTick: number; endTick: number }
export interface PlayerState {
  status: 'preparing' | 'ready' | 'error'; message: string; playing: boolean;
  parts: PlayerPart[]; measures: PlayerMeasure[]; measure: number; speed: number;
  tempo?: { bpm: number; unit: number }; metronome?: boolean; beatVolume?: number; countIn?: boolean; countInBeat?: number; countInBeats?: number;
  notationScale: number; previewing?: boolean; solfege?: boolean; solfegePart?: number | null; focus: number | null | 'custom'; otherVolume?: number; focusVolume?: number; following?: boolean;
  loop: { start: number; end: number } | null;
}
export interface PlayerSession {
  playPause(): void; pause(): void; seek(index: number): void; seekAt(x: number, y: number): void; speed(value: number): void;
  rhythm(value: { metronome?: boolean; countIn?: boolean; volume?: number }): void;
  mix(id: number, value: Partial<Pick<PlayerPart, 'volume' | 'muted' | 'solo'>>): void;
  notationScale(value: number): void;
  solfege(visible: boolean, part?: number | null): void;
  focus(id: number | null): void; focusOther(volume: number): void; follow(): void; suspendFollow(): void;
  /** Preview notation outside the active loop without moving the audio position. Null cancels. */
  previewMeasure(index: number | null): void;
  loop(start: number | null, end?: number): void;
  getSnapshot(): PlayerState; subscribe(listener: () => void): () => void; dispose(): void;
}
export interface PlayerOptions {
  scrollElement?: HTMLElement;
  prepared?: PreparedMusicXml;
  onPrepared?(prepared: PreparedMusicXml): void;
  /** Fired once after actual notation and its first system bounds are available. */
  onFirstReadableSystem?(): void;
  /** Local timing hooks contain no source names, content or persistent identity. */
  onLoadingStage?(stage: PlayerLoadingStage): void;
}
export type PlayerLoadingStage = 'source-prepared' | 'model-ready' | 'midi-ready' | 'soundfont-ready' | 'first-system' | 'ready' | 'play-request' | 'playing';
const clamp = (value: number) => Math.min(1, Math.max(0, value));

/** The host owns source authorization, bounded preparation reuse and navigation. */
export function createPlayerSession(element: HTMLElement, bytes: Uint8Array, options: PlayerOptions = {}): PlayerSession {
  let disposed = false;
  const loadingStages = new Set<PlayerLoadingStage>();
  const loadingStage = (stage: PlayerLoadingStage) => {
    if (disposed || state.status === 'error' || loadingStages.has(stage)) return;
    if (stage !== 'play-request' && stage !== 'playing') loadingStages.add(stage);
    try { options.onLoadingStage?.(stage); } catch { /* A timing sink cannot affect practice playback. */ }
  };
  let state: PlayerState = { status: 'preparing', message: '正在读取乐谱…', playing: false, parts: [], measures: [], measure: 0, speed: 1, notationScale: .6, solfegePart: null, focus: null, otherVolume: .25, following: true, loop: null };
  const listeners = new Set<() => void>();
  const update = (next: Partial<PlayerState>) => {
    if (disposed) return;
    state = { ...state, ...next };
    listeners.forEach(listener => listener());
  };
  const viewport = options.scrollElement;
  const follow = new ScoreFollowSession();
  let pointer: { x: number; y: number } | null = null, dragged = false;
  const api = createPlaybackApi(element, {
    core: { fontDirectory: '/font/', engine: 'svg', includeNoteBounds: true },
    importer: { mergePartGroupsInMusicXml: false },
    display: { scale: .6, resources: { secondaryGlyphColor: '#000000', barNumberColor: '#78867b' } },
    player: { playerMode: alphaTab.PlayerMode.EnabledSynthesizer, soundFont: '/soundfont/sonivox.sf2', enableCursor: true,
      enableAnimatedBeatCursor: true, enableElementHighlighting: true, enableUserInteraction: false,
      scrollElement: viewport ?? element, scrollMode: viewport ? alphaTab.ScrollMode.OffScreen : alphaTab.ScrollMode.Off, scrollOffsetY: -28 },
  });
  api.masterVolume = .72;
  api.metronomeVolume = 0; api.countInVolume = 0;
  let pendingCountIn = false;
  let pauseRequested = false;
  let playRequested = false;
  let pendingSeek: { tick: number; resume: boolean } | null = null;
  let awaitingPause = false;
  let seekReplyTick: number | null = null;
  let countInActive = false;
  let countInRequest = 0;
  let tempoMeasures: MusicXmlTempoMeasure[] = [];
  const tempoAt = (tick: number) => playbackTempo(api.tickCache?.masterBars ?? [], tick, tempoMeasures);
  const stopCountIn = () => {
    countInActive = false; api.countInVolume = 0;
    update({ countInBeat: 0, countInBeats: 0 });
  };
  const start = () => {
    pauseRequested = false;
    if (pendingSeek) { pendingSeek.resume = true; return; }
    playRequested = true;
    const count = pendingCountIn && state.countIn && (state.beatVolume ?? .5) > 0;
    pendingCountIn = false; countInActive = Boolean(count); if (count) countInRequest++;
    api.countInVolume = count ? state.beatVolume ?? .5 : 0;
    if (count) update({ countInBeat: 1, countInBeats: api.tickCache?.masterBars[state.measure]?.masterBar.timeSignatureNumerator ?? 4 });
    loadingStage('play-request'); api.play();
  };
  let previewOverlay: HTMLDivElement | null = null;
  let preview: { playing: boolean; scrollTop: number; index: number } | null = null;
  const scrollToMeasure = (index: number, clearance = 16) => {
    const masterBar = api.tickCache?.masterBars[index]?.masterBar;
    const measureBounds = masterBar && api.boundsLookup?.findMasterBar(masterBar);
    const bounds = measureBounds?.realBounds ?? measureBounds?.staffSystemBounds?.realBounds;
    if (viewport && bounds) viewport.scrollTop += element.getBoundingClientRect().top + bounds.y - viewport.getBoundingClientRect().top - clearance;
  };
  let measureLabels: string[] = [];
  let customMeasureLabels = false;
  let readableSystemReported = false;
  let musicalSystemRendered = false;
  const reportReadableSystem = () => {
    if (disposed || state.status === 'error' || readableSystemReported || !musicalSystemRendered || !(options.onFirstReadableSystem || options.onLoadingStage)) return;
    const system = api.boundsLookup?.staffSystems[0];
    if (!system?.bars.some(master => master.bars.some(bar => bar.beats.length > 0)) || !element.querySelector('.at-surface svg')) return;
    readableSystemReported = true; notationObserver?.disconnect(); loadingStage('first-system');
    try { options.onFirstReadableSystem?.(); } catch { /* Optional host scheduling cannot fail the session. */ }
  };
  // The native API installs this partial's DOM before notifying this listener.
  // Header/footer SVGs have no master bars; notation may use text/rect with no paths.
  api.renderer.partialRenderFinished.on(result => {
    if (disposed || result.firstMasterBarIndex < 0 || typeof result.renderResult !== 'string' || !/<svg(?:\s|>)/.test(result.renderResult)) return;
    musicalSystemRendered = true; reportReadableSystem();
  });
  const notationObserver = options.onFirstReadableSystem || options.onLoadingStage ? new MutationObserver(reportReadableSystem) : null;
  notationObserver?.observe(element, { childList: true, subtree: true });
  let measureOverlay: HTMLDivElement | null = null;
  let degreeOverlay: HTMLDivElement | null = null;
  const renderDegrees = () => {
    degreeOverlay?.remove(); degreeOverlay = null;
    if (disposed || !state.solfege || !api.score || !api.boundsLookup) return;
    const overlay = document.createElement('div');
    overlay.className = 'solfege-overlay'; overlay.setAttribute('aria-hidden', 'true');
    const seen = new Set<string>();
    for (const track of api.score.tracks.filter(track => state.solfegePart === null || track.index === (state.solfegePart ?? 0))) for (const staff of track.staves) for (const bar of staff.bars)
      for (const voice of bar.voices) for (const beat of voice.beats)
        for (const bounds of api.boundsLookup.findBeats(beat) ?? []) for (const item of bounds.notes ?? []) {
          const note = item.note, head = item.noteHeadBounds;
          if (!note.isVisible || note.isPercussion || note.isDead) continue;
          const text = solfegeDegreeLabel(note.displayValue, bar.keySignature, note.accidentalMode);
          const key = `${Math.round(head.x * 2)}:${Math.round(head.y * 2)}:${text}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const label = document.createElement('span'); label.className = 'solfege-degree-label'; label.textContent = text;
          const gap = 2 * state.notationScale / .8;
          label.style.fontSize = `${Math.max(5, 11.25 * state.notationScale)}px`;
          label.style.left = `${head.x + head.w + gap}px`; label.style.top = `${head.y - gap}px`;
          overlay.append(label);
        }
    element.append(overlay); degreeOverlay = overlay;
  };
  const renderMeasureLabels = () => {
    measureOverlay?.remove(); measureOverlay = null;
    if (disposed || !customMeasureLabels || !api.boundsLookup) return;
    const overlay = document.createElement('div');
    overlay.className = 'practice-measure-overlay'; overlay.setAttribute('aria-hidden', 'true');
    measureLabels.forEach((text, index) => {
      const bar = api.boundsLookup?.findMasterBarByIndex(index)?.bars[0];
      if (!bar) return;
      const label = document.createElement('span'); label.className = 'practice-measure-label'; label.textContent = text;
      label.style.left = `${bar.beats[0]?.realBounds.x ?? bar.realBounds.x}px`;
      label.style.top = `${bar.realBounds.y - 2}px`;
      label.style.fontSize = `${11 * state.notationScale}px`;
      overlay.append(label);
    });
    element.append(overlay); measureOverlay = overlay;
  };
  // Worker bounds arrive after renderFinished. Never use the previous layout's coordinates.
  // Keep the visible system in place after reflow, including viewport resizes.
  let anchor: { bar: number; offset: number } | null = null;
  const captureAnchor = () => {
    if (!viewport || !api.boundsLookup || state.following || anchor) return;
    const top = viewport.getBoundingClientRect().top;
    const origin = element.getBoundingClientRect().top;
    const system = api.boundsLookup.staffSystems.find(system => origin + system.realBounds.y + system.realBounds.h > top);
    if (system?.bars[0]) anchor = { bar: system.bars[0].index, offset: origin + system.realBounds.y - top };
  };
  api.renderStarted.on(() => { musicalSystemRendered = false; captureAnchor(); degreeOverlay?.remove(); degreeOverlay = null; measureOverlay?.remove(); measureOverlay = null; });
  api.postRenderFinished.on(() => {
    renderDegrees(); renderMeasureLabels();
    if (preview) markMeasure(preview.index); else highlightLoop();
    reportReadableSystem();
    if (disposed || !viewport) return;
    if (preview) { anchor = null; showPreview(preview.index); return; }
    if (anchor) {
      const bounds = api.boundsLookup?.findMasterBarByIndex(anchor.bar)?.staffSystemBounds?.realBounds;
      if (bounds) viewport.scrollTop += element.getBoundingClientRect().top + bounds.y - viewport.getBoundingClientRect().top - anchor.offset;
      anchor = null;
    } else if (state.following && state.status === 'ready' && (state.measure > 0 || state.playing)) scrollToMeasure(state.measure);
  });

  const setFollow = (enabled: boolean) => {
    if (enabled) follow.restore(); else follow.suspend();
    api.settings.player.scrollMode = enabled && viewport ? alphaTab.ScrollMode.OffScreen : alphaTab.ScrollMode.Off;
    api.updateSettings(); update({ following: enabled });
    if (enabled && state.status === 'ready') scrollToMeasure(state.measure);
  };
  const intent = () => { anchor = null; follow.noteManualScrollIntent(performance.now()); };
  const keyDown = (event: KeyboardEvent) => {
    if (!event.defaultPrevented && !event.altKey && !event.ctrlKey && !event.metaKey && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) intent();
  };
  const pointerDown = (event: PointerEvent) => { pointer = { x: event.clientX, y: event.clientY }; dragged = false; };
  const pointerMove = (event: PointerEvent) => { if (pointer && isPointerDrag(pointer, { x: event.clientX, y: event.clientY })) { dragged = true; intent(); } };
  const pointerUp = () => { pointer = null; dragged = false; };
  const scroll = () => { if (follow.shouldSuspendForScroll(performance.now(), dragged)) setFollow(false); };
  viewport?.addEventListener('wheel', intent, { passive: true });
  viewport?.addEventListener('touchmove', intent, { passive: true });
  viewport?.addEventListener('keydown', keyDown);
  viewport?.addEventListener('pointerdown', pointerDown);
  viewport?.addEventListener('pointermove', pointerMove);
  viewport?.addEventListener('pointerup', pointerUp);
  viewport?.addEventListener('pointercancel', pointerUp);
  viewport?.addEventListener('scroll', scroll, { passive: true });
  let worker: Worker | null = null;
  const fail = (message: string) => {
    if (disposed) return;
    clearTimeout(deadline); worker?.terminate(); notationObserver?.disconnect(); stopCountIn(); api.pause(); update({ status: 'error', message, playing: false });
  };
  const deadline = setTimeout(() => fail('准备播放超时，请重试。'), 60000);
  api.error.on(error => fail(error instanceof Error ? error.message : '播放资源加载失败，请重试。'));
  const applyMix = (parts: PlayerPart[], focus = state.focus, otherVolume = state.otherVolume ?? .25, focusVolume = state.focusVolume) => {
    const effective = parts.map(part => ({ ...part, volume: typeof focus === 'number' ? part.id !== focus ? otherVolume : focusVolume ?? part.baseVolume ?? part.volume : part.baseVolume ?? part.volume }));
    if (api.score) for (const part of effective) {
      const track = api.score.tracks[part.id];
      api.changeTrackVolume([track], part.volume); api.changeTrackMute([track], part.muted); api.changeTrackSolo([track], part.solo);
    }
    update({ parts: effective, focus, otherVolume, focusVolume });
  };
  const ready = () => {
    if (disposed || state.status === 'error' || state.status === 'ready' || !api.isReadyForPlayback || !api.score) return;
    const bars = api.tickCache?.masterBars ?? [];
    const labels = playbackMeasureLabels(bars.map(item => String(measureLabels[item.masterBar.index] ?? item.masterBar.index + 1)));
    const measures = bars.map((item,index) => {
      const label = labels[index];
      return { index, label, startTick: item.start, endTick: item.end };
    });
    clearTimeout(deadline); applyMix(state.parts); update({ status: 'ready', message: '', measures, tempo: tempoAt(0), metronome: false, beatVolume: .5, countIn: false }); loadingStage('ready');
  };
  element.addEventListener('alphaTab.midiFileLoaded', ready);
  api.playerReady.on(ready);
  api.midiLoaded.on(() => loadingStage('midi-ready'));
  api.soundFontLoaded.on(() => loadingStage('soundfont-ready'));
  api.playerStateChanged.on(event => {
    const playing = event.state === alphaTab.synth.PlayerState.Playing;
    if (disposed || state.status === 'error') return;
    playRequested = playing;
    update({ playing }); if (playing) loadingStage('playing');
    if (!playing && awaitingPause) {
      awaitingPause = false;
      const seek = pendingSeek; pendingSeek = null;
      if (seek) {
        // alphaTab's earlier pause listener queues a rewind to the old beat.
        // Queue our destination after that rewind, then resume from this seek.
        seekReplyTick = seek.tick; api.tickPosition = seek.tick;
        if (seek.resume) start();
      }
    }
  });
  api.playerPositionChanged.on(event => {
    if (disposed || pendingSeek) return;
    if (event.countInBeats > 0) {
      if (countInActive && event.countInId === countInRequest) { update({ countInBeat: event.countInBeat, countInBeats: event.countInBeats }); }
      return;
    }
    if (countInActive) {
      if (event.countInFinished && event.countInId === countInRequest) {
        // The synthesizer may already have buffered beyond the exact start tick.
        seekReplyTick = null; stopCountIn();
      } else return; // Ignore old main-position replies while the new target is counting in.
    }
    if (seekReplyTick !== null) {
      if (event.isSeek && Math.abs(event.currentTick - seekReplyTick) > 1) return;
      seekReplyTick = null;
    }
    const index = state.measures.findLastIndex(item => item.startTick <= event.currentTick);
    const tempo = tempoAt(event.currentTick);
    if (index >= 0 && (index !== state.measure || tempo.bpm !== state.tempo?.bpm || tempo.unit !== state.tempo?.unit)) update({ measure: index, tempo });
  });
  const render = (prepared: PreparedMusicXml) => {
    if (disposed || state.status === 'error') return;
    try {
      loadingStage('source-prepared');
      tempoMeasures = prepared.tempoMeasures ?? readMusicXmlTempoMeasures(prepared.bytes);
      if (prepared.measureLabels !== undefined) measureLabels = prepared.measureLabels;
      else {
        const document = new DOMParser().parseFromString(new TextDecoder().decode(prepared.bytes), 'application/xml');
        const part = Array.from(document.documentElement.children).find(node => node.localName === 'part');
        measureLabels = Array.from(part?.children ?? []).filter(node => node.localName === 'measure').map((node, index) => node.getAttribute('number')?.trim() || String(index + 1));
      }
      customMeasureLabels = measureLabels.some((label, index) => label !== String(index + 1));
      const score = loadPreparedMusicXml(prepared, api.settings);
      // Reflow follows the viewport rather than print-system/page breaks from the source.
      for (const track of score.tracks) track.lineBreaks?.clear();
      // alphaTab 1.8 prints ordinal numbers only. For custom source numbering,
      // replace those glyphs with labels positioned from the same post-render bounds.
      if (customMeasureLabels) for (const track of score.tracks) for (const staff of track.staves) for (const bar of staff.bars) bar.barNumberDisplay = alphaTab.model.BarNumberDisplay.Hide;
      assignPlaybackChannels(score.tracks);
      applyTimbreProfile(score.tracks, 'choir', classifyTimbreRoles(score.tracks, []));
      const names = score.tracks.map((track, index) => track.name || `声部 ${index + 1}`);
      const occurrences = new Map<string, number>();
      update({ message: '正在准备音色与谱面…', parts: score.tracks.map((track, id) => {
        const name = names[id], key = name.trim().toLowerCase(), occurrence = (occurrences.get(key) ?? 0) + 1;
        occurrences.set(key, occurrence);
        return { id, name: names.filter(value => value.trim().toLowerCase() === key).length > 1 ? `${name} ${occurrence}` : name, volume: .75, baseVolume: .75, muted: false, solo: false };
      }) });
      loadingStage('model-ready'); api.renderScore(score, score.tracks.map(track => track.index));
    } catch (error) { fail(error instanceof Error ? error.message : '无法播放此乐谱。'); }
  };
  if (options.prepared && isCompatibleMusicXmlPreparation(options.prepared)) queueMicrotask(() => render(options.prepared!));
  else {
    worker = new Worker(new URL('./prepare.worker.js', import.meta.url), { type: 'module' });
    worker.onerror = () => fail('无法准备乐谱，请重试。');
    worker.onmessage = (event: MessageEvent<{ error?: string; prepared?: PreparedMusicXml }>) => {
      worker?.terminate();
      if (disposed || state.status === 'error') return;
      if (event.data.error || !event.data.prepared) { fail(event.data.error ?? '读取失败。'); return; }
      options.onPrepared?.(event.data.prepared); render(event.data.prepared);
    };
    const copy = bytes.slice(); worker.postMessage(copy, [copy.buffer]);
  }
  const highlight = (start: number, end: number) => {
    const first = api.tickCache?.masterBars[start]?.masterBar.index;
    const last = api.tickCache?.masterBars[end]?.masterBar.index;
    const bars = api.score?.tracks[0]?.staves?.[0]?.bars;
    const from = first === undefined ? undefined : bars?.[first]?.voices[0]?.beats[0];
    const to = last === undefined ? undefined : bars?.[last]?.voices[0]?.beats.at(-1);
    if (from && to) api.highlightPlaybackRange(from, to);
  };
  const markMeasure = (index: number) => {
    previewOverlay?.remove(); previewOverlay = null;
    const master = api.tickCache?.masterBars[index]?.masterBar;
    const bounds = master && api.boundsLookup?.findMasterBar(master)?.realBounds;
    if (bounds && bounds.w > 0 && bounds.h > 0) {
      const marker = document.createElement('div'); marker.className = 'practice-measure-preview'; marker.setAttribute('aria-hidden', 'true');
      Object.assign(marker.style, { left: `${bounds.x}px`, top: `${bounds.y}px`, width: `${bounds.w}px`, height: `${bounds.h}px` });
      element.append(marker); previewOverlay = marker;
    }
  };
  const showPreview = (index: number) => {
    markMeasure(index); scrollToMeasure(index, Math.max(72, (viewport?.clientHeight ?? 0) * .18));
  };
  const highlightLoop = () => {
    api.clearPlaybackRangeHighlight?.();
    previewOverlay?.remove(); previewOverlay = null;
    if (state.loop) {
      if (state.loop.start === state.loop.end) markMeasure(state.loop.start);
      else highlight(state.loop.start, state.loop.end);
    }
  };
  const restoreScrollMode = () => {
    api.settings.player.scrollMode = state.following && viewport ? alphaTab.ScrollMode.OffScreen : alphaTab.ScrollMode.Off;
    api.updateSettings();
  };
  const finishPreview = () => {
    if (!preview) return;
    const previous = preview; preview = null; previewOverlay?.remove(); previewOverlay = null; update({ previewing: false }); restoreScrollMode(); highlightLoop();
    if (viewport) viewport.scrollTop = previous.scrollTop;
    if (previous.playing) api.play();
  };
  const seekTick = (requested: number, manual = true) => {
    if (!Number.isFinite(requested) || preview) return;
    const first = state.measures[state.loop?.start ?? 0], last = state.measures[state.loop?.end ?? state.measures.length - 1];
    if (!first || !last) return;
    const tick = requested < first.startTick ? first.startTick : requested >= last.endTick ? last.startTick : requested;
    const index = state.measures.findLastIndex(item => item.startTick <= tick);
    const resume = manual && (pendingSeek?.resume ?? ((state.playing || playRequested) && !pauseRequested || countInActive));
    const pauseFirst = manual && (awaitingPause || state.playing || playRequested || countInActive);
    if (manual) {
      stopCountIn();
      pendingCountIn = Boolean(state.countIn);
    }
    const startTick = state.measures[index].startTick;
    update({ measure: index, tempo: tempoAt(startTick) });
    if (pauseFirst) {
      pendingSeek = { tick: startTick, resume };
      if (!awaitingPause) { awaitingPause = true; api.pause(); }
    } else {
      seekReplyTick = startTick; api.tickPosition = startTick;
      if (resume) start();
    }
    if (state.following) scrollToMeasure(index);
  };
  return {
    getSnapshot: () => state,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    playPause() { if (!disposed && state.status === 'ready' && !preview) {
      if (pendingSeek) { pendingSeek.resume = !pendingSeek.resume; pauseRequested = !pendingSeek.resume; if (pauseRequested) pendingCountIn = false; }
      else if ((state.playing || playRequested) && !pauseRequested || countInActive) { pauseRequested = true; stopCountIn(); api.pause(); } else start();
    } },
    pause() { if (!disposed) { pauseRequested = true; if (pendingSeek) { pendingSeek.resume = false; pendingCountIn = false; } stopCountIn(); if (!awaitingPause) api.pause(); } },
    seek(index) { if (!disposed && state.status === 'ready' && Number.isInteger(index)) {
      const bounded = Math.max(state.loop?.start ?? 0, Math.min(state.loop?.end ?? state.measures.length - 1, index));
      if (state.measures[bounded]) seekTick(state.measures[bounded].startTick);
    } },
    // Hosts normalize transformed viewport coordinates before crossing this seam.
    seekAt(x, y) {
      if (disposed || state.status !== 'ready' || !Number.isFinite(x) || !Number.isFinite(y)) return;
      const beat = api.boundsLookup?.getBeatAtPos(x, y);
      if (beat && api.tickCache) {
        const sourceIndex = beat.voice?.bar.masterBar.index;
        const occurrences = api.tickCache.masterBars.map((bar, index) => ({ bar, index })).filter(item => item.bar.masterBar.index === sourceIndex);
        const inside = occurrences.filter(item => !state.loop || item.index >= state.loop.start && item.index <= state.loop.end);
        const nearest = (inside.length ? inside : occurrences).sort((a, b) => Math.abs(a.index - state.measure) - Math.abs(b.index - state.measure))[0];
        seekTick(nearest ? nearest.bar.start : api.tickCache.getBeatStart(beat));
      }
    },
    speed(value) { if (!disposed && Number.isFinite(value)) {
      const speed = Math.max(.5, Math.min(2, Math.round(value * 100) / 100));
      const restart = countInActive;
      api.playbackSpeed = speed; update({ speed });
      if (restart) seekTick(state.measures[state.measure].startTick);
    } },
    rhythm(value) {
      if (disposed || state.status !== 'ready' || value.volume !== undefined && !Number.isFinite(value.volume)) return;
      const beatVolume = value.volume === undefined ? state.beatVolume ?? .5 : clamp(value.volume);
      update({ metronome: value.metronome ?? state.metronome, countIn: value.countIn ?? state.countIn, beatVolume });
      api.metronomeVolume = state.metronome ? beatVolume : 0;
      if (!state.countIn) pendingCountIn = false;
      // During count-in keep its volume independent from the sustained metronome.
      api.countInVolume = countInActive ? beatVolume : 0;
    },
    mix(id, value) {
      if (disposed || state.status !== 'ready' || !api.score?.tracks[id] || value.volume !== undefined && !Number.isFinite(value.volume)) return;
      const parts = state.parts.map(part => part.id === id ? { ...part, ...value, baseVolume: value.volume === undefined || typeof state.focus === 'number' ? part.baseVolume : clamp(value.volume) } : part);
      applyMix(parts, typeof state.focus === 'number' ? state.focus : 'custom', state.otherVolume, typeof state.focus === 'number' && id === state.focus && value.volume !== undefined ? clamp(value.volume) : state.focusVolume);
    },
    focus(id) { if (!disposed && state.status === 'ready' && (id === null || state.parts.some(part => part.id === id))) applyMix(state.parts, id, state.otherVolume, id === null ? undefined : state.parts.find(part => part.id === id)?.baseVolume); },
    focusOther(volume) { if (!disposed && state.status === 'ready' && Number.isFinite(volume)) applyMix(state.parts, state.focus, clamp(volume)); },
    notationScale(value) {
      if (disposed || state.status !== 'ready' || !Number.isFinite(value)) return;
      const notationScale = Math.max(.3, Math.min(1.2, Math.round(value * 10) / 10));
      if (notationScale === state.notationScale) return;
      captureAnchor();
      api.settings.display.scale = notationScale;
      api.updateSettings();
      update({ notationScale });
      api.render();
    },
    solfege(visible, part) { if (!disposed && (part === undefined || part === null || state.parts.some(item => item.id === part))) {
      update({ solfege: visible, solfegePart: part === undefined ? state.solfegePart : part }); renderDegrees();
    } },
    follow() { if (!disposed) setFollow(true); },
    suspendFollow() { if (!disposed && state.following) setFollow(false); },
    previewMeasure(index) {
      if (disposed || state.status !== 'ready') return;
      if (index === null) { finishPreview(); return; }
      if (!state.measures[index]) return;
      if (!preview) {
        const wasPlaying = state.playing || countInActive; stopCountIn();
        preview = { playing: wasPlaying, scrollTop: viewport?.scrollTop ?? 0, index };
        update({ previewing: true });
        api.settings.player.scrollMode = alphaTab.ScrollMode.Off; api.updateSettings(); api.pause();
      }
      preview.index = index;
      showPreview(index);
    },
    loop(start, end) {
      if (disposed || state.status !== 'ready') return;
      if (start !== null && (end === undefined || end < start || !state.measures[start] || !state.measures[end])) return;
      const resume = preview?.playing ?? false; preview = null; previewOverlay?.remove(); previewOverlay = null; update({ previewing: false }); restoreScrollMode();
      if (start === null) { api.isLooping = false; api.playbackRange = null; update({ loop: null }); }
      else {
        api.playbackRange = { startTick: state.measures[start].startTick, endTick: state.measures[end!].endTick };
        api.isLooping = true; update({ loop: { start, end: end! } }); seekTick(state.measures[start].startTick, false);
      }
      highlightLoop(); if (resume) api.play();
    },
    dispose() {
      if (disposed) return; stopCountIn(); disposed = true; clearTimeout(deadline); worker?.terminate(); notationObserver?.disconnect(); element.removeEventListener('alphaTab.midiFileLoaded', ready); listeners.clear(); degreeOverlay?.remove(); previewOverlay?.remove();
      viewport?.removeEventListener('wheel', intent); viewport?.removeEventListener('touchmove', intent); viewport?.removeEventListener('pointerdown', pointerDown); viewport?.removeEventListener('pointermove', pointerMove);
      viewport?.removeEventListener('keydown', keyDown);
      viewport?.removeEventListener('pointerup', pointerUp); viewport?.removeEventListener('pointercancel', pointerUp); viewport?.removeEventListener('scroll', scroll); api.destroy();
    },
  };
}
