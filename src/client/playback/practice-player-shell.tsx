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
import { usePracticeFocus } from './use-practice-focus';
import { PracticeSplit } from './practice-split';
import { PlaybackTimeline, type Timeline } from './playback-timeline';

type Props = {
  source?: PlaybackSource; embedded?: boolean; notationZoom?: NotationZoomProps; ready: boolean; playing: boolean; message?: string; failed?: boolean;
  position: string; loopStatus?: string; timeline: Timeline; speed?: number; setSpeed?(value: number): void; previousDisabled: boolean; nextDisabled: boolean;
  play(): void; previous(): void; next(): void; retry(): void; children: ReactNode;
};

export function PracticePlayerShell(props: Props) {
  const { source } = props;
  const focus = usePracticeFocus(props.embedded);
  const { bottomCollapsed } = focus;
  useExitLayer(focus.focused, 'overlay', destination => {
    // View changes also pass navigation admission; keep focus until a real
    // route departure unmounts this session. Back closes focus explicitly.
    if (destination) return true;
    return focus.exit().then(() => true);
  });
  const readerView = useSyncExternalStore(playbackViewStore.subscribe, playbackViewStore.getSnapshot);
  const view = props.embedded ? 'xml' : readerView;
  const [panel, setPanel] = useState<'settings' | 'position' | null>(null);
  const positionTrigger = useRef<HTMLButtonElement>(null);
  const settingsTrigger = useRef<HTMLButtonElement>(null);
  const dock = useRef<HTMLDivElement>(null), header = useRef<HTMLElement>(null);
  const location = useLocation(), navigate = useNavigate(), navigation = useAppNavigation();
  const isXml = props.embedded || source?.attachment.kind === 'musicxml';
  useExitLayer(panel !== null, 'overlay', () => { setPanel(null); return true; });
  useLayoutEffect(() => {
    if (props.embedded) return;
    const element = dock.current, top = header.current;
    if (!element || !top) return;
    const measure = () => {
      document.documentElement.style.setProperty('--practice-float-bottom', bottomCollapsed ? '64px' : '0px');
      document.documentElement.style.setProperty('--practice-inset', bottomCollapsed ? 'env(safe-area-inset-bottom, 0px)' : `${Math.ceil(element.getBoundingClientRect().height)}px`);
      document.documentElement.style.setProperty('--practice-top-inset', 'var(--safe-top, 0px)');
      document.documentElement.style.setProperty('--practice-tools-clearance', `${Math.ceil(top.getBoundingClientRect().height) + 16}px`);
    };
    measure();
    // Insets resize both score viewports. Commit outside the observer delivery
    // cycle so WebKit can finish the current layout before measuring them again.
    let frame = 0;
    const observer = new ResizeObserver(() => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); }); observer.observe(element); observer.observe(top);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); document.documentElement.style.removeProperty('--practice-inset'); document.documentElement.style.removeProperty('--practice-top-inset'); document.documentElement.style.removeProperty('--practice-float-bottom'); document.documentElement.style.removeProperty('--practice-tools-clearance'); };
  }, [props.embedded, bottomCollapsed]);
  const selectView = (next: PlaybackView) => navigation.afterEditing(() => {
    if (!source || playbackStore.getSnapshot() !== source) return;
    setPanel(null);
    setPlaybackView(next);
    const path = `/choirs/${source.choirId}/scores/${source.score.id}`;
    if (location.pathname !== path) void navigate(readerHref({ choirId: source.choirId, scoreId: source.score.id, experience: source.experience === true || source.ownerKey.startsWith("experience:") }, location.search));
  });
  const icon = (label: string, children: ReactNode, action: () => void, disabled = false) => <TooltipTrigger>
    <Button className="practice-icon" aria-label={label} isDisabled={disabled} onPress={action}>{children}</Button>
    <Tooltip className="practice-tooltip" placement="top">{label}</Tooltip>
  </TooltipTrigger>;
  return <>
    {!props.embedded && isXml && source && <PracticeSplit active={view === 'compare'} ownerKey={source.ownerKey} />}
    <header className="practice-header" aria-label="练习看谱" data-floating={!props.embedded || undefined} ref={header}>
      {props.embedded ? <strong>候选谱面与试听</strong> : isXml ? <MenuTrigger>
        <Button className="practice-view-trigger" aria-label="显示谱面" aria-description={`当前：${view === 'pdf' ? '原始 PDF' : view === 'compare' ? '对照' : '重排谱面'}`} data-short-label={view === 'pdf' ? 'PDF' : view === 'compare' ? '对照' : '重排'}><span className="practice-view-label">{view === 'pdf' ? '原始 PDF' : view === 'compare' ? '对照' : '重排谱面'}</span><ChevronDown size={14} aria-hidden="true" /></Button>
        <Popover className="practice-view-popover" placement="bottom start" offset={6}>
          <Menu aria-label="显示谱面" selectionMode="single" selectedKeys={[view]} onAction={key => { if (key === 'pdf' || key === 'xml' || key === 'compare') selectView(key); }}>
            {([['pdf','原始 PDF'],['xml','重排谱面'],['compare','对照']] as const).map(([key,label]) => <MenuItem key={key} id={key} textValue={label} className="practice-view-option"><span>{label}</span>{view === key && <Check size={16} aria-hidden="true" />}</MenuItem>)}
          </Menu>
        </Popover>
      </MenuTrigger> : <span className="practice-source-name" title={source?.attachment.name}>{source?.attachment.name}</span>}
      {props.notationZoom && <NotationZoom {...props.notationZoom} />}
      {!props.embedded && <TooltipTrigger><Button className="practice-chrome-toggle practice-fullscreen" isDisabled={focus.pending} aria-label={focus.focused ? '退出专注' : focus.supported ? '全屏看谱' : '专注看谱'} onPress={() => { void (focus.focused ? focus.exit() : focus.enter()); }}>{focus.focused ? <Minimize size={16} aria-hidden="true" /> : <Maximize size={16} aria-hidden="true" />}<span>{focus.focused ? '退出' : focus.supported ? '全屏' : '专注'}</span></Button><Tooltip className="practice-tooltip" placement="bottom">{focus.focused ? '退出专注' : focus.supported ? '全屏看谱' : '专注看谱'}</Tooltip></TooltipTrigger>}
      {!props.embedded && <Button className="practice-end-playback" aria-label="结束练习" onPress={stopPlayback}>结束<span>练习</span></Button>}
    </header>
    <div className="practice-dock" data-view={view} data-collapsed={bottomCollapsed || undefined} ref={dock}>
      {props.message && <div className="practice-notice" role="status"><span>{props.message}</span>{props.failed && <Button onPress={props.retry}>重试</Button>}</div>}
      <section className="practice-bar" aria-label="乐谱练习" data-testid="musicxml-player">
        <div id="practice-expanded-controls" className="practice-expanded-controls" hidden={bottomCollapsed}><PlaybackTimeline timeline={props.timeline} /></div>

        <div className="practice-bar-meta" hidden={bottomCollapsed}>
          <Button ref={positionTrigger} className="practice-position" aria-label={isXml ? '定位小节' : '定位时间'} aria-expanded={panel === 'position'} isDisabled={props.timeline.disabled} onPress={() => setPanel(panel === 'position' ? null : 'position')} aria-description={props.timeline.label(props.timeline.value)}>{props.position}</Button>
          {props.setSpeed && <select className="practice-speed" aria-label="速度" value={props.speed} disabled={!props.ready} onChange={event => props.setSpeed?.(Number(event.target.value))}>{[.5,.75,1,1.25,1.5].map(speed => <option key={speed} value={speed}>{speed}×</option>)}</select>}
        </div>
        <div className="practice-transport">
        {!bottomCollapsed && icon(isXml ? '前一小节' : '后退 10 秒', <span className="practice-skip" aria-hidden="true"><RotateCcw size={26} /><span>{isXml ? 1 : 10}</span></span>, props.previous, !props.ready || props.previousDisabled)}
        <TooltipTrigger><Button className="practice-icon practice-play" aria-label={props.playing ? '暂停' : '播放'} isDisabled={!props.ready} onPress={props.play}>
          {!props.ready && !props.failed ? <LoaderCircle className="practice-loading-icon" size={18} aria-hidden="true" /> : props.playing ? <Pause size={18} fill="currentColor" aria-hidden="true" /> : <Play size={18} fill="currentColor" aria-hidden="true" />}
        </Button><Tooltip className="practice-tooltip" placement="top">{props.playing ? '暂停' : '播放'}</Tooltip></TooltipTrigger>
        {!bottomCollapsed && icon(isXml ? '后一小节' : '前进 10 秒', <span className="practice-skip" aria-hidden="true"><RotateCw size={26} /><span>{isXml ? 1 : 10}</span></span>, props.next, !props.ready || props.nextDisabled)}

        </div>
        <div className="practice-bar-actions">
          <div><TooltipTrigger>
          <Button ref={settingsTrigger} className="practice-icon practice-settings" aria-label="练习设置" aria-description={props.loopStatus ? `片段循环：${props.loopStatus}` : undefined} data-loop={props.loopStatus ? true : undefined} aria-expanded={panel === 'settings'} data-active={panel === 'settings' || undefined} onPress={() => setPanel(panel === 'settings' ? null : 'settings')}><SlidersHorizontal size={17} aria-hidden="true" /><span aria-hidden="true">{props.loopStatus ? "循环" : "练习"}</span></Button>
          <Tooltip className="practice-tooltip" placement="top">{props.loopStatus ? `片段循环：${props.loopStatus}` : "练习设置"}</Tooltip>
        </TooltipTrigger></div>
          {!props.embedded && <TooltipTrigger><Button className="practice-chrome-toggle" aria-label={bottomCollapsed ? '展开播放控制' : '收起播放控制'} aria-expanded={!bottomCollapsed} aria-controls="practice-expanded-controls" onPress={() => { setPanel(null); focus.setBottomCollapsed(!bottomCollapsed); }}>{bottomCollapsed ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}</Button><Tooltip className="practice-tooltip" placement="bottom">{bottomCollapsed ? '展开播放控制' : '收起播放控制'}</Tooltip></TooltipTrigger>}
        </div>
      </section>
    </div>
    {focus.notice && <div className="practice-focus-notice" role="status">{focus.notice}<Button className="practice-icon" aria-label="关闭全屏提示" onPress={focus.dismissNotice}><X size={16} aria-hidden="true" /></Button></div>}
    {panel && <Popover triggerRef={panel === 'settings' ? settingsTrigger : positionTrigger} isOpen onOpenChange={open => { if (!open) setPanel(null); }} placement="top end" className="practice-popover" offset={10}>
      <Dialog className="practice-panel" aria-label={panel === 'settings' ? '练习设置' : isXml ? '定位小节' : '定位时间'}>
        <header><div><strong>{panel === 'settings' ? '练习设置' : isXml ? '定位小节' : '定位时间'}</strong></div><Button className="practice-icon" aria-label={panel === 'settings' ? '关闭练习设置' : '关闭定位'} onPress={() => setPanel(null)}><X size={18} aria-hidden="true" /></Button></header>
        {panel === 'settings' ? props.children : <PositionLocator timeline={props.timeline} isXml={isXml} close={() => setPanel(null)} />}
      </Dialog>
    </Popover>}
  </>;
}

function PositionLocator({ timeline, isXml, close }: { timeline: Timeline; isXml: boolean; close(): void }) {
  const [value, setValue] = useState(timeline.value);
  return <>
    <label className="practice-field"><span>{timeline.label(value)}</span>
      <input aria-label={isXml ? '目标小节' : '目标时间'} type="range" min="0" max={timeline.max} step={timeline.step ?? 1} value={value} aria-valuetext={timeline.label(value)} disabled={timeline.disabled} onChange={event => setValue(Number(event.target.value))} />
    </label>
    <Button className="practice-action" isDisabled={timeline.disabled} onPress={() => { timeline.seek(value); close(); }}>跳转</Button>
  </>;
}
