import { readerHref } from "../reader/reader-entry";
import { useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button, Popover, Tooltip, TooltipTrigger } from 'react-aria-components';
import { Pause, Play, RotateCcw, RotateCw, ChevronDown, SlidersHorizontal, X, LoaderCircle } from 'lucide-react';
import { Dialog } from '../navigation/overlays';
import { useAppNavigation, useExitLayer } from '../navigation/navigation-context';
import { playbackStore, playbackViewStore, setPlaybackView, stopPlayback, type PlaybackSource, type PlaybackView } from './playback-store';
import './practice-player.css';
import { PracticeSplit } from './practice-split';
import { PlaybackTimeline, type Timeline } from './playback-timeline';

type Props = {
  source?: PlaybackSource; embedded?: boolean; ready: boolean; playing: boolean; message?: string; failed?: boolean;
  position: string; timeline: Timeline; speed?: number; setSpeed?(value: number): void; previousDisabled: boolean; nextDisabled: boolean;
  notationControls?: ReactNode;
  play(): void; previous(): void; next(): void; retry(): void; children: ReactNode;
};

export function PracticePlayerShell(props: Props) {
  const { source } = props;
  const readerView = useSyncExternalStore(playbackViewStore.subscribe, playbackViewStore.getSnapshot);
  const view = props.embedded ? 'xml' : readerView;
  const [panel, setPanel] = useState<'settings' | null>(null);
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
      document.documentElement.style.setProperty('--practice-inset', `${Math.ceil(element.getBoundingClientRect().height)}px`);
      document.documentElement.style.setProperty('--practice-top-inset', `${Math.ceil(top.getBoundingClientRect().height)}px`);
    };
    measure();
    // Insets resize both score viewports. Commit outside the observer delivery
    // cycle so WebKit can finish the current layout before measuring them again.
    let frame = 0;
    const observer = new ResizeObserver(() => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); }); observer.observe(element); observer.observe(top);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); document.documentElement.style.removeProperty('--practice-inset'); document.documentElement.style.removeProperty('--practice-top-inset'); };
  }, [props.embedded]);
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
    <header className="practice-header" aria-label="练习看谱" ref={header}>
      {props.embedded ? <strong>候选谱面与试听</strong> : isXml ? <div className="practice-view-switch" role="group" aria-label="显示谱面">
        <Button aria-pressed={view === 'pdf'} onPress={() => selectView('pdf')}>原始 PDF</Button>
        <Button aria-pressed={view === 'xml'} onPress={() => selectView('xml')}>重排谱面</Button>
        <Button aria-pressed={view === 'compare'} onPress={() => selectView('compare')}>对照</Button>
      </div> : <span className="practice-source-name" title={source?.attachment.name}>{source?.attachment.name}</span>}
      {props.notationControls}
      {!props.embedded && <Button className="practice-end-playback" aria-label="结束播放" onPress={stopPlayback}>结束</Button>}
    </header>
    <div className="practice-dock" data-view={view} ref={dock}>
      {props.message && <div className="practice-notice" role="status"><span>{props.message}</span>{props.failed && <Button onPress={props.retry}>重试</Button>}</div>}
      <section className="practice-bar" aria-label="乐谱练习" data-testid="musicxml-player">
        <PlaybackTimeline timeline={props.timeline} />

        <div className="practice-transport">
        {icon(isXml ? '前一小节' : '后退 10 秒', <span className="practice-skip" aria-hidden="true"><RotateCcw size={26} /><span>{isXml ? 1 : 10}</span></span>, props.previous, !props.ready || props.previousDisabled)}
        <TooltipTrigger><Button className="practice-icon practice-play" aria-label={props.playing ? '暂停' : '播放'} isDisabled={!props.ready} onPress={props.play}>
          {!props.ready && !props.failed ? <LoaderCircle className="practice-loading-icon" size={18} aria-hidden="true" /> : props.playing ? <Pause size={18} fill="currentColor" aria-hidden="true" /> : <Play size={18} fill="currentColor" aria-hidden="true" />}
        </Button><Tooltip className="practice-tooltip" placement="top">{props.playing ? '暂停' : '播放'}</Tooltip></TooltipTrigger>
        {icon(isXml ? '后一小节' : '前进 10 秒', <span className="practice-skip" aria-hidden="true"><RotateCw size={26} /><span>{isXml ? 1 : 10}</span></span>, props.next, !props.ready || props.nextDisabled)}
        <span className="practice-position" title={props.position}>{props.position}</span>

        </div>
        <div className="practice-bar-actions">{props.setSpeed && <span className="practice-speed-control"><select className="practice-speed" aria-label="速度" value={props.speed} disabled={!props.ready} onChange={event => props.setSpeed?.(Number(event.target.value))}>{[.5,.75,1,1.25,1.5].map(speed => <option key={speed} value={speed}>{speed}×</option>)}</select><ChevronDown size={12} aria-hidden="true" /></span>}
        <Button ref={settingsTrigger} className={`practice-icon practice-settings${isXml ? " practice-settings-xml" : ""}`} aria-label="练习设置" aria-expanded={panel === 'settings'} data-active={panel === 'settings' || undefined} onPress={() => setPanel(panel === 'settings' ? null : 'settings')}><SlidersHorizontal size={isXml ? 15 : 18} aria-hidden="true" />{isXml && <span>练习</span>}</Button>
        </div>
      </section>
    </div>
    {panel && <Popover triggerRef={settingsTrigger} isOpen onOpenChange={open => { if (!open) setPanel(null); }} placement="top end" className="practice-popover" offset={10}>
      <Dialog className="practice-panel" aria-label="练习设置">
        <header><div><strong>练习设置</strong></div><Button className="practice-icon" aria-label="关闭练习设置" onPress={() => setPanel(null)}><X size={18} aria-hidden="true" /></Button></header>
        {panel === 'settings' && <>{props.children}</>}
      </Dialog>
    </Popover>}
  </>;
}
