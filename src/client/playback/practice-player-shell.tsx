import { readerHref } from "../reader/reader-entry";
import { useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button, Popover, Tooltip, TooltipTrigger } from 'react-aria-components';
import { Pause, Play, StepBack, StepForward, SlidersHorizontal, X, LoaderCircle } from 'lucide-react';
import { Dialog } from '../navigation/overlays';
import { useAppNavigation, useExitLayer } from '../navigation/navigation-context';
import { playbackStore, playbackViewStore, setPlaybackView, stopPlayback, type PlaybackSource } from './playback-store';
import './practice-player.css';
import { PlaybackTimeline, type Timeline } from './playback-timeline';

type Props = {
  source: PlaybackSource; ready: boolean; playing: boolean; message?: string; failed?: boolean;
  position: string; timeline: Timeline; speed?: number; setSpeed?(value: number): void; previousDisabled: boolean; nextDisabled: boolean;
  play(): void; previous(): void; next(): void; retry(): void; children: ReactNode;
};

export function PracticePlayerShell(props: Props) {
  const { source } = props;
  const view = useSyncExternalStore(playbackViewStore.subscribe, playbackViewStore.getSnapshot);
  const [panel, setPanel] = useState<'settings' | null>(null);
  const settingsTrigger = useRef<HTMLButtonElement>(null);
  const dock = useRef<HTMLDivElement>(null);
  const location = useLocation(), navigate = useNavigate(), navigation = useAppNavigation();
  const isXml = source.attachment.kind === 'musicxml';
  useExitLayer(panel !== null, 'overlay', () => { setPanel(null); return true; });
  useLayoutEffect(() => {
    const element = dock.current;
    if (!element) return;
    const measure = () => document.documentElement.style.setProperty('--practice-inset', `${Math.ceil(element.getBoundingClientRect().height)}px`);
    measure();
    const observer = new ResizeObserver(measure); observer.observe(element);
    return () => { observer.disconnect(); document.documentElement.style.removeProperty('--practice-inset'); };
  }, []);
  const selectView = (next: 'pdf' | 'xml') => navigation.afterEditing(() => {
    if (playbackStore.getSnapshot() !== source) return;
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
    <div className="practice-dock" data-view={view} ref={dock}>
      {props.message && <div className="practice-notice" role="status"><span>{props.message}</span>{props.failed && <Button onPress={props.retry}>重试</Button>}</div>}
      <section className="practice-bar" aria-label="乐谱练习" data-testid="musicxml-player">
        <PlaybackTimeline timeline={props.timeline} />
        <div className="practice-view"><span className="practice-source-name" title={source.attachment.name}>{source.attachment.name}</span>{isXml ? <label><span className="practice-view-label" aria-hidden="true">谱面</span><select aria-label="显示谱面" value={view} onChange={event => selectView(event.target.value === 'xml' ? 'xml' : 'pdf')}><option value="pdf">原始 PDF</option><option value="xml">重排谱面</option></select></label> : <span className="practice-view-static">原始 PDF</span>}</div>
        <div className="practice-transport">
        {icon(isXml ? '前一小节' : '后退 10 秒', <StepBack size={18} aria-hidden="true" />, props.previous, !props.ready || props.previousDisabled)}
        <TooltipTrigger><Button className="practice-icon practice-play" aria-label={props.playing ? '暂停' : '播放'} isDisabled={!props.ready} onPress={props.play}>
          {!props.ready && !props.failed ? <LoaderCircle className="practice-loading-icon" size={18} aria-hidden="true" /> : props.playing ? <Pause size={18} fill="currentColor" aria-hidden="true" /> : <Play size={18} fill="currentColor" aria-hidden="true" />}
        </Button><Tooltip className="practice-tooltip" placement="top">{props.playing ? '暂停' : '播放'}</Tooltip></TooltipTrigger>
        {icon(isXml ? '后一小节' : '前进 10 秒', <StepForward size={18} aria-hidden="true" />, props.next, !props.ready || props.nextDisabled)}
        <span className="practice-position" title={props.position}>{props.position}</span>

        </div>
        <div className="practice-bar-actions">{props.setSpeed && <select className="practice-speed" aria-label="速度" value={props.speed} disabled={!props.ready} onChange={event => props.setSpeed?.(Number(event.target.value))}>{[.5,.75,1,1.25,1.5].map(speed => <option key={speed} value={speed}>{speed}×</option>)}</select>}
        <Button ref={settingsTrigger} className="practice-icon practice-settings" aria-label="练习设置" aria-expanded={panel === 'settings'} data-active={panel === 'settings' || undefined} onPress={() => setPanel(panel === 'settings' ? null : 'settings')}><SlidersHorizontal size={18} aria-hidden="true" /></Button>
        {icon("结束播放", <X size={20} aria-hidden="true" />, stopPlayback)}</div>
      </section>
    </div>
    {panel && <Popover triggerRef={settingsTrigger} isOpen onOpenChange={open => { if (!open) setPanel(null); }} placement="top end" className="practice-popover" offset={10}>
      <Dialog className="practice-panel" aria-label="练习设置">
        <header><div><strong>练习设置</strong><small>{source.attachment.name} · {isXml ? 'MusicXML 文件' : '音频附件'}</small></div><Button className="practice-icon" aria-label="关闭练习设置" onPress={() => setPanel(null)}><X size={18} aria-hidden="true" /></Button></header>
        {panel === 'settings' && <>{props.children}</>}
      </Dialog>
    </Popover>}
  </>;
}
