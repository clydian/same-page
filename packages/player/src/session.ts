import { assignPlaybackChannels, createPlaybackApi, loadPreparedMusicXml } from './engine.ts';
import { solfegeDegreeLabel } from './solfege-degree.ts';
import * as alphaTab from '@coderline/alphatab';
import { applyTimbreProfile, classifyTimbreRoles } from './timbre-profile.ts';
import { ScoreFollowSession, isPointerDrag } from './score-follow.ts';
import { playbackMeasureLabels } from './playback-measures.ts';
import type { PreparedMusicXml } from './musicxml-direction-timing.ts';

export interface PlayerPart { id: number; name: string; volume: number; baseVolume?: number; muted: boolean; solo: boolean }
export interface PlayerMeasure { index: number; label: string; startTick: number; endTick: number }
export interface PlayerState {
  status: 'preparing' | 'ready' | 'error'; message: string; playing: boolean;
  parts: PlayerPart[]; measures: PlayerMeasure[]; measure: number; speed: number;
  notationScale: number; solfege?: boolean; solfegePart?: number | null; focus: number | null | 'custom'; otherVolume?: number; focusVolume?: number; following?: boolean;
  loop: { start: number; end: number } | null;
}
export interface PlayerSession {
  playPause(): void; pause(): void; seek(index: number): void; seekAt(x: number, y: number): void; speed(value: number): void;
  mix(id: number, value: Partial<Pick<PlayerPart, 'volume' | 'muted' | 'solo'>>): void;
  notationScale(value: number): void;
  solfege(visible: boolean, part?: number | null): void;
  focus(id: number | null): void; focusOther(volume: number): void; follow(): void; suspendFollow(): void;
  loop(start: number | null, end?: number): void;
  getSnapshot(): PlayerState; subscribe(listener: () => void): () => void; dispose(): void;
}
export interface PlayerOptions {
  scrollElement?: HTMLElement;
  prepared?: PreparedMusicXml;
  onPrepared?(prepared: PreparedMusicXml): void;
}
const clamp = (value: number) => Math.min(1, Math.max(0, value));

/** The host owns source authorization, bounded preparation reuse and navigation. */
export function createPlayerSession(element: HTMLElement, bytes: Uint8Array, options: PlayerOptions = {}): PlayerSession {
  let disposed = false;
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
      enableAnimatedBeatCursor: true, enableElementHighlighting: true, enableUserInteraction: true,
      scrollElement: viewport ?? element, scrollMode: viewport ? alphaTab.ScrollMode.OffScreen : alphaTab.ScrollMode.Off, scrollOffsetY: -28 },
  });
  api.masterVolume = .72;
  const scrollToMeasure = (index: number) => {
    const masterBar = api.tickCache?.masterBars[index]?.masterBar;
    const bounds = masterBar && api.boundsLookup?.findMasterBar(masterBar)?.staffSystemBounds?.realBounds;
    if (viewport && bounds) viewport.scrollTop += element.getBoundingClientRect().top + bounds.y - viewport.getBoundingClientRect().top - 16;
  };
  let measureLabels: string[] = [];
  let customMeasureLabels = false;
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
  api.renderStarted.on(() => { captureAnchor(); degreeOverlay?.remove(); degreeOverlay = null; measureOverlay?.remove(); measureOverlay = null; });
  api.postRenderFinished.on(() => {
    renderDegrees(); renderMeasureLabels();
    if (disposed || !viewport) return;
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
  const fail = (message: string) => { clearTimeout(deadline); worker?.terminate(); api.pause(); update({ status: 'error', message, playing: false }); };
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
    clearTimeout(deadline); applyMix(state.parts); update({ status: 'ready', message: '', measures });
  };
  element.addEventListener('alphaTab.midiFileLoaded', ready);
  api.playerReady.on(ready);
  api.playerStateChanged.on(event => update({ playing: event.state === alphaTab.synth.PlayerState.Playing }));
  api.playerPositionChanged.on(event => {
    const index = state.measures.findLastIndex(item => item.startTick <= event.currentTick);
    if (index >= 0 && index !== state.measure) update({ measure: index });
  });
  const render = (prepared: PreparedMusicXml) => {
    if (disposed) return;
    try {
      const document = new DOMParser().parseFromString(new TextDecoder().decode(prepared.bytes), 'application/xml');
      const part = Array.from(document.documentElement.children).find(node => node.localName === 'part');
      measureLabels = Array.from(part?.children ?? []).filter(node => node.localName === 'measure').map((node, index) => node.getAttribute('number')?.trim() || String(index + 1));
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
      api.renderScore(score, score.tracks.map(track => track.index));
    } catch (error) { fail(error instanceof Error ? error.message : '无法播放此乐谱。'); }
  };
  if (options.prepared) queueMicrotask(() => render(options.prepared!));
  else {
    worker = new Worker(new URL('./prepare.worker.js', import.meta.url), { type: 'module' });
    worker.onerror = () => fail('无法准备乐谱，请重试。');
    worker.onmessage = (event: MessageEvent<{ error?: string; prepared?: PreparedMusicXml }>) => {
      worker?.terminate();
      if (disposed) return;
      if (event.data.error || !event.data.prepared) { fail(event.data.error ?? '读取失败。'); return; }
      options.onPrepared?.(event.data.prepared); render(event.data.prepared);
    };
    const copy = bytes.slice(); worker.postMessage(copy, [copy.buffer]);
  }
  return {
    getSnapshot: () => state,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    playPause() { if (!disposed && state.status === 'ready') api.playPause(); },
    pause() { if (!disposed) api.pause(); },
    seek(index) { if (!disposed && state.status === 'ready' && state.measures[index]) { api.tickPosition = state.measures[index].startTick; if (state.following) scrollToMeasure(index); } },
    // Hosts normalize transformed viewport coordinates before crossing this seam.
    seekAt(x, y) {
      if (disposed || state.status !== 'ready' || !Number.isFinite(x) || !Number.isFinite(y)) return;
      const beat = api.boundsLookup?.getBeatAtPos(x, y);
      if (beat && api.tickCache) api.tickPosition = api.tickCache.getBeatStart(beat);
    },
    speed(value) { if (!disposed && Number.isFinite(value)) { const speed = Math.max(.5, Math.min(1.5, value)); api.playbackSpeed = speed; update({ speed }); } },
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
    loop(start, end) {
      if (disposed || state.status !== 'ready') return;
      if (start === null) { api.isLooping = false; api.playbackRange = null; update({ loop: null }); return; }
      if (end === undefined || end < start || !state.measures[start] || !state.measures[end]) return;
      api.playbackRange = { startTick: state.measures[start].startTick, endTick: state.measures[end].endTick };
      api.isLooping = true; api.tickPosition = state.measures[start].startTick; update({ loop: { start, end } });
    },
    dispose() {
      if (disposed) return; disposed = true; clearTimeout(deadline); worker?.terminate(); element.removeEventListener('alphaTab.midiFileLoaded', ready); listeners.clear(); degreeOverlay?.remove();
      viewport?.removeEventListener('wheel', intent); viewport?.removeEventListener('touchmove', intent); viewport?.removeEventListener('pointerdown', pointerDown); viewport?.removeEventListener('pointermove', pointerMove);
      viewport?.removeEventListener('keydown', keyDown);
      viewport?.removeEventListener('pointerup', pointerUp); viewport?.removeEventListener('pointercancel', pointerUp); viewport?.removeEventListener('scroll', scroll); api.destroy();
    },
  };
}
