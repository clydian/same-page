import { useMessages } from "../../i18n";
import { PlaybackPreparationNotice } from './playback-preparation-notice';
import { createPortal } from 'react-dom';
import { FeedbackMessage } from '../components/feedback-message';
import { readerHref } from "../reader/reader-entry";
import { useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button, MenuItem, MenuTrigger, Popover, Tooltip, TooltipTrigger } from 'react-aria-components';
import { Pause, Play, RotateCcw, RotateCw, ChevronDown, Check, SlidersHorizontal, X, LoaderCircle, ChevronUp, Maximize, Minimize } from 'lucide-react';
import { Dialog, Menu } from '../navigation/overlays';
import { useAppNavigation, useExitLayer } from '../navigation/navigation-context';
import { playbackStore, playbackViewStore, setPlaybackView, stopPlayback, type PlaybackSource, type PlaybackView } from './playback-store';
import './practice-player.css';
import { NotationZoom, type NotationZoomProps } from './notation-zoom';
import type { PracticeFocus } from './use-practice-focus';
import { PracticeSplit } from './practice-split';
import { PlaybackTimeline, type Timeline } from './playback-timeline';
import { usePracticePopoverHeight } from './use-practice-popover-height';

type Props = {
  source?: PlaybackSource; embedded?: boolean; focus: PracticeFocus; notationZoom?: NotationZoomProps; ready: boolean; playing: boolean; message?: string; failed?: boolean;
  preparation?: { loaded: number; total: number };
  hint?: ReactNode;
  loopPreviewing?: boolean; position: string; loopStatus?: string; timeline: Timeline; tempo?: { bpm: number; unit: number }; speed?: number; setSpeed?(value: number): void; previousDisabled: boolean; nextDisabled: boolean;
  play(): void; previous(): void; next(): void; retry(): void; children?: ReactNode;
};

export function PracticePlayerShell(props: Props) {
  const t = useMessages("practice");
  const { source, focus } = props;
  const { controlsCollapsed, toolsCollapsed } = focus;
  useExitLayer(focus.focused, 'overlay', destination => {
    // View changes also pass navigation admission; keep focus until a real
    // route departure unmounts this session. Back closes focus explicitly.
    if (destination) return true;
    return focus.exit().then(() => true);
  });
  const readerView = useSyncExternalStore(playbackViewStore.subscribe, playbackViewStore.getSnapshot);
  const view = props.embedded ? 'xml' : readerView;
  const viewLabels = { pdf: t("originalPdf"), xml: t("reflowedScore"), compare: t("compare") };
  const [panel, setPanel] = useState<'settings' | 'position' | 'speed' | null>(null);
  const positionTrigger = useRef<HTMLButtonElement>(null);
  const settingsTrigger = useRef<HTMLButtonElement>(null);
  const controlsTrigger = useRef<HTMLButtonElement>(null);
  const toolsTrigger = useRef<HTMLButtonElement>(null);
  const speedTrigger = useRef<HTMLButtonElement>(null);
  const panelTrigger = panel === 'settings' ? settingsTrigger : panel === 'speed' ? speedTrigger : positionTrigger;
  const popover = useRef<HTMLElement>(null);
  const panelScroll = useRef<HTMLDivElement>(null);
  const [popoverBoundary, setPopoverBoundary] = useState<HTMLDivElement | null>(null);
  usePracticePopoverHeight(popover, panelTrigger, panel !== null, popoverBoundary);
  const dock = useRef<HTMLDivElement>(null), header = useRef<HTMLElement>(null);
  const location = useLocation(), navigate = useNavigate(), navigation = useAppNavigation();
  const isXml = props.embedded || source?.attachment.kind === 'musicxml';
  useExitLayer(panel !== null, 'overlay', () => { setPanel(null); return true; });
  useLayoutEffect(() => {
    if (props.embedded) return;
    const element = dock.current, top = header.current;
    if (!element) return;
    const measure = () => {
      document.documentElement.style.setProperty('--practice-float-bottom', controlsCollapsed ? '64px' : '0px');
      document.documentElement.style.setProperty('--practice-inset', controlsCollapsed && isXml ? 'env(safe-area-inset-bottom, 0px)' : `${Math.ceil(window.innerHeight - element.getBoundingClientRect().top)}px`);
      document.documentElement.style.setProperty('--practice-top-inset', isXml ? 'var(--safe-top, 0px)' : '0px');
      document.documentElement.style.setProperty('--practice-tools-clearance', `${(top ? Math.ceil(top.getBoundingClientRect().height) : 0) + 16}px`);
    };
    measure();
    // Insets resize both score viewports. Commit outside the observer delivery
    // cycle so WebKit can finish the current layout before measuring them again.
    let frame = 0;
    const observer = new ResizeObserver(() => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); }); observer.observe(element); if (top) observer.observe(top);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); document.documentElement.style.removeProperty('--practice-inset'); document.documentElement.style.removeProperty('--practice-top-inset'); document.documentElement.style.removeProperty('--practice-float-bottom'); document.documentElement.style.removeProperty('--practice-tools-clearance'); };
  }, [props.embedded, controlsCollapsed, toolsCollapsed, isXml]);
  const selectView = (next: PlaybackView) => navigation.afterEditing(() => {
    if (!source || playbackStore.getSnapshot() !== source) return;
    setPanel(null);
    setPlaybackView(next);
    const path = `/choirs/${source.choirId}/scores/${source.score.id}`;
    if (location.pathname !== path) void navigate(readerHref({ choirId: source.choirId, scoreId: source.score.id, experience: source.experience === true || source.ownerKey.startsWith("experience:") }, location.search));
  });
  const closePlayer = () => {
    stopPlayback();
    requestAnimationFrame(() => document.querySelector<HTMLElement>('.reader-shell')?.focus({ preventScroll: true }));
  };

  const icon = (label: string, children: ReactNode, action: () => void, disabled = false) => <TooltipTrigger>
    <Button className="practice-icon" aria-label={label} isDisabled={disabled} onPress={action}>{children}</Button>
    <Tooltip className="practice-tooltip" placement="top">{label}</Tooltip>
  </TooltipTrigger>;
  return <>
    {!props.embedded && isXml && source && <PracticeSplit active={view === 'compare'} ownerKey={source.ownerKey} />}
    {isXml && <header className="practice-header" aria-label={t("practiceReading")} data-no-native-selection data-floating={!props.embedded || undefined} ref={header}>
      <div id="practice-view-controls" className="practice-header-tools" hidden={toolsCollapsed}>
      {props.embedded ? <strong>{t("candidatePreview")}</strong> : <MenuTrigger>
        <Button className="practice-view-trigger" aria-label={t("showScore")} aria-description={t("currentView", { view: viewLabels[view] })} data-short-label={view === 'pdf' ? 'PDF' : view === 'compare' ? t("compare") : t("reflow")}><span className="practice-view-label">{viewLabels[view]}</span><ChevronDown size={14} aria-hidden="true" /></Button>
        <Popover className="practice-view-popover" placement="bottom start" offset={6}>
          <Menu aria-label={t("showScore")} selectionMode="single" selectedKeys={[view]} onAction={key => { if (key === 'pdf' || key === 'xml' || key === 'compare') selectView(key); }}>
            {(["pdf", "xml", "compare"] as const).map(key => <MenuItem key={key} id={key} textValue={viewLabels[key]} className="practice-view-option"><span>{viewLabels[key]}</span>{view === key && <Check size={16} aria-hidden="true" />}</MenuItem>)}
          </Menu>
        </Popover>
      </MenuTrigger>}
      {props.notationZoom && <NotationZoom {...props.notationZoom} />}
      {!props.embedded && <TooltipTrigger><Button className="practice-chrome-toggle practice-fullscreen" isDisabled={focus.pending} aria-label={focus.focused ? t("exitFocus") : focus.supported ? t("fullScreenScore") : t("focusScore")} onPress={() => { toolsTrigger.current?.focus({ preventScroll: true }); void (focus.focused ? focus.exit() : focus.enter()); }}>{focus.focused ? <Minimize size={16} aria-hidden="true" /> : <Maximize size={16} aria-hidden="true" />}<span>{focus.focused ? t("exit") : focus.supported ? t("fullScreen") : t("focus")}</span></Button><Tooltip className="practice-tooltip" placement="bottom">{focus.focused ? t("exitFocus") : focus.supported ? t("fullScreenScore") : t("focusScore")}</Tooltip></TooltipTrigger>}
      </div>
      {!props.embedded && <TooltipTrigger><Button ref={toolsTrigger} className="practice-chrome-toggle practice-tools-toggle" aria-label={toolsCollapsed ? t("readingToolsExpand") : t("readingToolsCollapse")} aria-expanded={!toolsCollapsed} aria-controls={`practice-view-controls${view === 'compare' ? ' practice-notation-tools' : ''}`} onPress={() => { toolsTrigger.current?.focus({ preventScroll: true }); focus.setToolsCollapsed(!toolsCollapsed); }}>{toolsCollapsed ? <ChevronDown size={18} aria-hidden="true" /> : <ChevronUp size={16} aria-hidden="true" />}{!toolsCollapsed && <span aria-hidden="true">{t("collapse")}</span>}</Button><Tooltip className="practice-tooltip" placement="bottom">{toolsCollapsed ? t("readingToolsExpand") : t("readingToolsCollapse")}</Tooltip></TooltipTrigger>}
    </header>}
    <div className="practice-dock" data-view={view} data-audio={!isXml || undefined} data-collapsed={controlsCollapsed || undefined} ref={dock}>
      {!props.ready && !props.failed && props.message
        ? <PlaybackPreparationNotice key={props.message} message={props.message} {...props.preparation} retry={props.retry} />
        : props.message && <div className="practice-notice" role="status"><span>{props.message}</span>{props.failed && <Button onPress={props.retry}>{t("retry")}</Button>}</div>}
      {props.hint}
      <section className="practice-bar" aria-label={isXml ? t("scorePractice") : t("audioPlayback")} data-no-native-selection data-testid="musicxml-player">
        <div id="practice-expanded-controls" className="practice-expanded-controls" hidden={controlsCollapsed}><PlaybackTimeline timeline={props.timeline} /></div>

        <div id="practice-bar-meta" className="practice-bar-meta" hidden={controlsCollapsed}>
          <Button ref={positionTrigger} className="practice-position" aria-label={isXml ? t("findMeasure") : t("findTime")} aria-expanded={panel === 'position'} isDisabled={props.timeline.disabled} onPress={() => setPanel(panel === 'position' ? null : 'position')} aria-description={props.timeline.label(props.timeline.value)}>{props.position}</Button>
          {props.setSpeed && (isXml ? <Button ref={speedTrigger} className="practice-speed" aria-label={t("adjustSpeed")} aria-expanded={panel === 'speed'} isDisabled={!props.ready} onPress={() => setPanel(panel === 'speed' ? null : 'speed')}>{(props.speed ?? 1).toFixed(2)}×</Button> : <select className="practice-speed" aria-label={t("speed")} value={props.speed} disabled={!props.ready} onChange={event => props.setSpeed?.(Number(event.target.value))}>{[.5,.75,1,1.25,1.5].map(speed => <option key={speed} value={speed}>{speed}×</option>)}</select>)}
        </div>
        <div className="practice-transport">
        {!controlsCollapsed && icon(isXml ? t("previousMeasure") : t("rewindTen"), <span className="practice-skip" aria-hidden="true"><RotateCcw size={26} /><span>{isXml ? 1 : 10}</span></span>, props.previous, !props.ready || props.previousDisabled)}
        <TooltipTrigger><Button className="practice-icon practice-play" aria-label={props.playing ? t("pause") : t("play")} isDisabled={!props.ready} onPress={props.play}>
          {!props.ready && !props.failed ? <LoaderCircle className="practice-loading-icon" size={18} aria-hidden="true" /> : props.playing ? <Pause size={18} fill="currentColor" aria-hidden="true" /> : <Play size={18} fill="currentColor" aria-hidden="true" />}
        </Button><Tooltip className="practice-tooltip" placement="top">{props.playing ? t("pause") : t("play")}</Tooltip></TooltipTrigger>
        {!controlsCollapsed && icon(isXml ? t("nextMeasure") : t("forwardTen"), <span className="practice-skip" aria-hidden="true"><RotateCw size={26} /><span>{isXml ? 1 : 10}</span></span>, props.next, !props.ready || props.nextDisabled)}

        </div>
        <div className="practice-bar-actions">
          {props.children && <TooltipTrigger>
          <Button ref={settingsTrigger} className="practice-icon practice-settings" aria-label={t("settings")} aria-description={props.loopStatus ? t("loopSummary", { range: props.loopStatus }) : undefined} data-loop={props.loopStatus ? true : undefined} aria-expanded={panel === 'settings'} data-active={panel === 'settings' || undefined} onPress={() => setPanel(panel === 'settings' ? null : 'settings')}><SlidersHorizontal size={17} aria-hidden="true" />{!controlsCollapsed && <span aria-hidden="true">{t("practice")}</span>}</Button>
          <Tooltip className="practice-tooltip" placement="top">{props.loopStatus ? t("loopSummary", { range: props.loopStatus }) : t("settings")}</Tooltip>
        </TooltipTrigger>}
        {!props.embedded && <div className="practice-session-actions">
          <TooltipTrigger><Button className="practice-chrome-toggle practice-close" aria-label={isXml ? t("exitPractice") : t("closeAudio")} onPress={closePlayer}><X size={18} aria-hidden="true" />{!controlsCollapsed && <span aria-hidden="true">{isXml ? t("exit") : t("close")}</span>}</Button><Tooltip className="practice-tooltip" placement="top">{isXml ? t("exitPractice") : t("closeAudio")}</Tooltip></TooltipTrigger>
          <TooltipTrigger><Button ref={controlsTrigger} className="practice-chrome-toggle practice-controls-toggle" aria-label={controlsCollapsed ? t("practiceControlsExpand") : t("practiceControlsCollapse")} aria-expanded={!controlsCollapsed} aria-controls="practice-expanded-controls practice-bar-meta" onPress={() => { setPanel(null); controlsTrigger.current?.focus({ preventScroll: true }); focus.setControlsCollapsed(!controlsCollapsed); }}>{controlsCollapsed ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}{!controlsCollapsed && <span aria-hidden="true">{t("collapse")}</span>}</Button><Tooltip className="practice-tooltip" placement="top">{controlsCollapsed ? t("practiceControlsExpand") : t("practiceControlsCollapse")}</Tooltip></TooltipTrigger>
        </div>}
        </div>
      </section>
    </div>
    <FeedbackMessage feedback={focus.feedback} className="practice-focus-notice" closeLabel={t("dismissFullScreenNotice")} dismissible />
    {createPortal(<div ref={setPopoverBoundary} className="practice-popover-boundary" aria-hidden="true" />, document.body)}
    {panel && popoverBoundary && <Popover ref={popover} triggerRef={panelTrigger} scrollRef={panelScroll} boundaryElement={popoverBoundary} isOpen onOpenChange={open => { if (!open) setPanel(null); }} placement="top end" className="practice-popover practice-player-popover" data-loop-previewing={props.loopPreviewing || undefined} offset={10}>
      <Dialog className="practice-panel" data-no-native-selection aria-label={panel === 'settings' ? t("settings") : panel === 'speed' ? t("adjustSpeed") : isXml ? t("findMeasure") : t("findTime")}>
        <header><div><strong>{panel === 'settings' ? t("settings") : panel === 'speed' ? t("adjustSpeed") : isXml ? t("findMeasure") : t("findTime")}</strong></div><Button className="practice-icon" aria-label={panel === 'settings' ? t("closeSettings") : panel === 'speed' ? t("closeSpeed") : t("closeLocator")} onPress={() => setPanel(null)}><X size={18} aria-hidden="true" /></Button></header>
        <div ref={panelScroll} className="practice-panel-content">
          {panel === 'settings' ? props.children : panel === 'speed' ? <PracticeSpeed speed={props.speed ?? 1} tempo={props.tempo} ready={props.ready} setSpeed={value => props.setSpeed?.(value)} /> : <PositionLocator timeline={props.timeline} isXml={isXml} close={() => setPanel(null)} />}
        </div>
      </Dialog>
    </Popover>}
  </>;
}

function PositionLocator({ timeline, isXml, close }: { timeline: Timeline; isXml: boolean; close(): void }) {
  const t = useMessages("practice");
  const [value, setValue] = useState(timeline.value);
  return <>
    <label className="practice-field"><span>{timeline.label(value)}</span>
      <input aria-label={isXml ? t("targetMeasure") : t("targetTime")} type="range" min={timeline.min ?? 0} max={timeline.max} step={timeline.step ?? 1} value={value} aria-valuetext={timeline.label(value)} disabled={timeline.disabled} onChange={event => setValue(Number(event.target.value))} />
    </label>
    <Button className="practice-action" isDisabled={timeline.disabled} onPress={() => { timeline.seek(value); close(); }}>{t("goTo")}</Button>
  </>;
}

const tempoUnits = { 4: 'wholeNote', 3: 'dottedHalfNote', 2: 'halfNote', 1.5: 'dottedQuarterNote', .75: 'dottedEighthNote', .25: 'sixteenthNote' } as const;
function PracticeSpeed({ speed, tempo, ready, setSpeed }: { speed: number; tempo?: { bpm: number; unit: number }; ready: boolean; setSpeed(value: number): void }) {
  const t = useMessages("practice");
  const unit = tempo?.unit ?? 1;
  const notationSymbol = unit === 1 ? '♩' : unit === .5 ? '♪' : undefined;
  const unitName = tempoUnits[unit as keyof typeof tempoUnits];
  const beat = notationSymbol ?? (unitName ? t(unitName) : t("quarterNoteUnits", { count: unit }));
  const bpm = tempo ? tempo.bpm / unit : undefined;
  const rate = (value: number) => Number(value.toFixed(1)).toString();
  return <section className="practice-speed-panel" aria-label={t("playbackSpeed")}>
    <label className="practice-field"><span>{t("speed")} <output>{speed.toFixed(2)}×</output></span>
      <input aria-label={t("playbackSpeed")} aria-valuetext={bpm ? t("currentSpeedWithTempo", { speed: speed.toFixed(2), bpm: rate(bpm * speed) }) : t("currentSpeed", { speed: speed.toFixed(2) })} type="range" min="0.5" max="2" step="0.01" value={speed} disabled={!ready} onChange={event => setSpeed(Number(event.target.value))} />
    </label>
    {bpm !== undefined && <p className="practice-tempo" aria-live="polite">{t("originalTempo", { beat, bpm: rate(bpm) })}<br />{t("adjustedTempo", { beat, bpm: rate(bpm * speed) })}</p>}
    <div className="practice-speed-actions">
      <Button className="practice-action" aria-label={t("decreaseSpeed")} isDisabled={!ready || speed <= .5} onPress={() => setSpeed(speed - .01)}>− 0.01</Button>
      <Button className="practice-action" isDisabled={!ready} onPress={() => setSpeed(1)}>{t("resetSpeed")}</Button>
      <Button className="practice-action" aria-label={t("increaseSpeed")} isDisabled={!ready || speed >= 2} onPress={() => setSpeed(speed + .01)}>＋ 0.01</Button>
    </div>
  </section>;
}
