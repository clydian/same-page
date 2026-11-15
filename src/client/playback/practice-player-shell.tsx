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
    {isXml && <header className="practice-header" aria-label="练习看谱" data-floating={!props.embedded || undefined} ref={header}>
      <div id="practice-view-controls" className="practice-header-tools" hidden={toolsCollapsed}>
      {props.embedded ? <strong>候选谱面与试听</strong> : <MenuTrigger>
        <Button className="practice-view-trigger" aria-label="显示谱面" aria-description={`当前：${view === 'pdf' ? '原始 PDF' : view === 'compare' ? '对照' : '重排谱面'}`} data-short-label={view === 'pdf' ? 'PDF' : view === 'compare' ? '对照' : '重排'}><span className="practice-view-label">{view === 'pdf' ? '原始 PDF' : view === 'compare' ? '对照' : '重排谱面'}</span><ChevronDown size={14} aria-hidden="true" /></Button>
        <Popover className="practice-view-popover" placement="bottom start" offset={6}>
          <Menu aria-label="显示谱面" selectionMode="single" selectedKeys={[view]} onAction={key => { if (key === 'pdf' || key === 'xml' || key === 'compare') selectView(key); }}>
            {([['pdf','原始 PDF'],['xml','重排谱面'],['compare','对照']] as const).map(([key,label]) => <MenuItem key={key} id={key} textValue={label} className="practice-view-option"><span>{label}</span>{view === key && <Check size={16} aria-hidden="true" />}</MenuItem>)}
          </Menu>
        </Popover>
      </MenuTrigger>}
      {props.notationZoom && <NotationZoom {...props.notationZoom} />}
      {!props.embedded && <TooltipTrigger><Button className="practice-chrome-toggle practice-fullscreen" isDisabled={focus.pending} aria-label={focus.focused ? '退出专注' : focus.supported ? '全屏看谱' : '专注看谱'} onPress={() => { toolsTrigger.current?.focus({ preventScroll: true }); void (focus.focused ? focus.exit() : focus.enter()); }}>{focus.focused ? <Minimize size={16} aria-hidden="true" /> : <Maximize size={16} aria-hidden="true" />}<span>{focus.focused ? '退出' : focus.supported ? '全屏' : '专注'}</span></Button><Tooltip className="practice-tooltip" placement="bottom">{focus.focused ? '退出专注' : focus.supported ? '全屏看谱' : '专注看谱'}</Tooltip></TooltipTrigger>}
      </div>
      {!props.embedded && <TooltipTrigger><Button ref={toolsTrigger} className="practice-chrome-toggle practice-tools-toggle" aria-label={toolsCollapsed ? '展开看谱工具' : '收起看谱工具'} aria-expanded={!toolsCollapsed} aria-controls={`practice-view-controls${view === 'compare' ? ' practice-notation-tools' : ''}`} onPress={() => { toolsTrigger.current?.focus({ preventScroll: true }); focus.setToolsCollapsed(!toolsCollapsed); }}>{toolsCollapsed ? <ChevronDown size={18} aria-hidden="true" /> : <ChevronUp size={16} aria-hidden="true" />}{!toolsCollapsed && <span aria-hidden="true">收起</span>}</Button><Tooltip className="practice-tooltip" placement="bottom">{toolsCollapsed ? '展开看谱工具' : '收起看谱工具'}</Tooltip></TooltipTrigger>}
    </header>}
    <div className="practice-dock" data-view={view} data-audio={!isXml || undefined} data-collapsed={controlsCollapsed || undefined} ref={dock}>
      {!props.ready && !props.failed && props.message
        ? <PlaybackPreparationNotice key={props.message} message={props.message} {...props.preparation} retry={props.retry} />
        : props.message && <div className="practice-notice" role="status"><span>{props.message}</span>{props.failed && <Button onPress={props.retry}>重试</Button>}</div>}
      {props.hint}
      <section className="practice-bar" aria-label={isXml ? '乐谱练习' : '音频播放'} data-testid="musicxml-player">
        <div id="practice-expanded-controls" className="practice-expanded-controls" hidden={controlsCollapsed}><PlaybackTimeline timeline={props.timeline} /></div>

        <div id="practice-bar-meta" className="practice-bar-meta" hidden={controlsCollapsed}>
          <Button ref={positionTrigger} className="practice-position" aria-label={isXml ? '定位小节' : '定位时间'} aria-expanded={panel === 'position'} isDisabled={props.timeline.disabled} onPress={() => setPanel(panel === 'position' ? null : 'position')} aria-description={props.timeline.label(props.timeline.value)}>{props.position}</Button>
          {props.setSpeed && (isXml ? <Button ref={speedTrigger} className="practice-speed" aria-label="调节速度" aria-expanded={panel === 'speed'} isDisabled={!props.ready} onPress={() => setPanel(panel === 'speed' ? null : 'speed')}>{(props.speed ?? 1).toFixed(2)}×</Button> : <select className="practice-speed" aria-label="速度" value={props.speed} disabled={!props.ready} onChange={event => props.setSpeed?.(Number(event.target.value))}>{[.5,.75,1,1.25,1.5].map(speed => <option key={speed} value={speed}>{speed}×</option>)}</select>)}
        </div>
        <div className="practice-transport">
        {!controlsCollapsed && icon(isXml ? '前一小节' : '后退 10 秒', <span className="practice-skip" aria-hidden="true"><RotateCcw size={26} /><span>{isXml ? 1 : 10}</span></span>, props.previous, !props.ready || props.previousDisabled)}
        <TooltipTrigger><Button className="practice-icon practice-play" aria-label={props.playing ? '暂停' : '播放'} isDisabled={!props.ready} onPress={props.play}>
          {!props.ready && !props.failed ? <LoaderCircle className="practice-loading-icon" size={18} aria-hidden="true" /> : props.playing ? <Pause size={18} fill="currentColor" aria-hidden="true" /> : <Play size={18} fill="currentColor" aria-hidden="true" />}
        </Button><Tooltip className="practice-tooltip" placement="top">{props.playing ? '暂停' : '播放'}</Tooltip></TooltipTrigger>
        {!controlsCollapsed && icon(isXml ? '后一小节' : '前进 10 秒', <span className="practice-skip" aria-hidden="true"><RotateCw size={26} /><span>{isXml ? 1 : 10}</span></span>, props.next, !props.ready || props.nextDisabled)}

        </div>
        <div className="practice-bar-actions">
          {props.children && <TooltipTrigger>
          <Button ref={settingsTrigger} className="practice-icon practice-settings" aria-label="练习设置" aria-description={props.loopStatus ? `片段循环：${props.loopStatus}` : undefined} data-loop={props.loopStatus ? true : undefined} aria-expanded={panel === 'settings'} data-active={panel === 'settings' || undefined} onPress={() => setPanel(panel === 'settings' ? null : 'settings')}><SlidersHorizontal size={17} aria-hidden="true" />{!controlsCollapsed && <span aria-hidden="true">练习</span>}</Button>
          <Tooltip className="practice-tooltip" placement="top">{props.loopStatus ? `片段循环：${props.loopStatus}` : "练习设置"}</Tooltip>
        </TooltipTrigger>}
        {!props.embedded && <div className="practice-session-actions">
          <TooltipTrigger><Button className="practice-chrome-toggle practice-close" aria-label={isXml ? '退出练习' : '关闭音频'} onPress={closePlayer}><X size={18} aria-hidden="true" />{!controlsCollapsed && <span aria-hidden="true">{isXml ? '退出' : '关闭'}</span>}</Button><Tooltip className="practice-tooltip" placement="top">{isXml ? '退出练习' : '关闭音频'}</Tooltip></TooltipTrigger>
          <TooltipTrigger><Button ref={controlsTrigger} className="practice-chrome-toggle practice-controls-toggle" aria-label={controlsCollapsed ? '展开练习控制' : '收起练习控制'} aria-expanded={!controlsCollapsed} aria-controls="practice-expanded-controls practice-bar-meta" onPress={() => { setPanel(null); controlsTrigger.current?.focus({ preventScroll: true }); focus.setControlsCollapsed(!controlsCollapsed); }}>{controlsCollapsed ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}{!controlsCollapsed && <span aria-hidden="true">收起</span>}</Button><Tooltip className="practice-tooltip" placement="top">{controlsCollapsed ? '展开练习控制' : '收起练习控制'}</Tooltip></TooltipTrigger>
        </div>}
        </div>
      </section>
    </div>
    <FeedbackMessage feedback={focus.feedback} className="practice-focus-notice" closeLabel="关闭全屏提示" dismissible />
    {createPortal(<div ref={setPopoverBoundary} className="practice-popover-boundary" aria-hidden="true" />, document.body)}
    {panel && popoverBoundary && <Popover ref={popover} triggerRef={panelTrigger} scrollRef={panelScroll} boundaryElement={popoverBoundary} isOpen onOpenChange={open => { if (!open) setPanel(null); }} placement="top end" className="practice-popover practice-player-popover" data-loop-previewing={props.loopPreviewing || undefined} offset={10}>
      <Dialog className="practice-panel" aria-label={panel === 'settings' ? '练习设置' : panel === 'speed' ? '调节速度' : isXml ? '定位小节' : '定位时间'}>
        <header><div><strong>{panel === 'settings' ? '练习设置' : panel === 'speed' ? '调节速度' : isXml ? '定位小节' : '定位时间'}</strong></div><Button className="practice-icon" aria-label={panel === 'settings' ? '关闭练习设置' : panel === 'speed' ? '关闭速度调节' : '关闭定位'} onPress={() => setPanel(null)}><X size={18} aria-hidden="true" /></Button></header>
        <div ref={panelScroll} className="practice-panel-content">
          {panel === 'settings' ? props.children : panel === 'speed' ? <PracticeSpeed speed={props.speed ?? 1} tempo={props.tempo} ready={props.ready} setSpeed={value => props.setSpeed?.(value)} /> : <PositionLocator timeline={props.timeline} isXml={isXml} close={() => setPanel(null)} />}
        </div>
      </Dialog>
    </Popover>}
  </>;
}

function PositionLocator({ timeline, isXml, close }: { timeline: Timeline; isXml: boolean; close(): void }) {
  const [value, setValue] = useState(timeline.value);
  return <>
    <label className="practice-field"><span>{timeline.label(value)}</span>
      <input aria-label={isXml ? '目标小节' : '目标时间'} type="range" min={timeline.min ?? 0} max={timeline.max} step={timeline.step ?? 1} value={value} aria-valuetext={timeline.label(value)} disabled={timeline.disabled} onChange={event => setValue(Number(event.target.value))} />
    </label>
    <Button className="practice-action" isDisabled={timeline.disabled} onPress={() => { timeline.seek(value); close(); }}>跳转</Button>
  </>;
}

const tempoUnits = new Map<number, string>([[4, '全音符'], [3, '附点二分音符'], [2, '二分音符'], [1.5, '附点四分音符'], [1, '♩'], [.75, '附点八分音符'], [.5, '♪'], [.25, '十六分音符']]);
const tempoUnitLabel = (unit: number) => tempoUnits.get(unit) ?? `${unit} 个四分音符`;
function PracticeSpeed({ speed, tempo, ready, setSpeed }: { speed: number; tempo?: { bpm: number; unit: number }; ready: boolean; setSpeed(value: number): void }) {
  const unit = tempo?.unit ?? 1;
  const bpm = tempo ? tempo.bpm / unit : undefined;
  const rate = (value: number) => Number(value.toFixed(1)).toString();
  return <section className="practice-speed-panel" aria-label="播放速度">
    <label className="practice-field"><span>速度 <output>{speed.toFixed(2)}×</output></span>
      <input aria-label="播放速度" aria-valuetext={`${speed.toFixed(2)} 倍${bpm ? `，当前速度 ${rate(bpm * speed)}` : ''}`} type="range" min="0.5" max="2" step="0.01" value={speed} disabled={!ready} onChange={event => setSpeed(Number(event.target.value))} />
    </label>
    {bpm !== undefined && <p className="practice-tempo" aria-live="polite">当前位置原速 {tempoUnitLabel(unit)} = {rate(bpm)}<br />调整后 {tempoUnitLabel(unit)} = {rate(bpm * speed)}</p>}
    <div className="practice-speed-actions">
      <Button className="practice-action" aria-label="速度减少 0.01 倍" isDisabled={!ready || speed <= .5} onPress={() => setSpeed(speed - .01)}>− 0.01</Button>
      <Button className="practice-action" isDisabled={!ready} onPress={() => setSpeed(1)}>恢复 1.00×</Button>
      <Button className="practice-action" aria-label="速度增加 0.01 倍" isDisabled={!ready || speed >= 2} onPress={() => setSpeed(speed + .01)}>＋ 0.01</Button>
    </div>
  </section>;
}
