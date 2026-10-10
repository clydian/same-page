import { useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button, Popover, Tooltip, TooltipTrigger } from 'react-aria-components';
import { Pause, Play, StepBack, StepForward, SlidersHorizontal, ListMusic, X, LoaderCircle, Check } from 'lucide-react';
import { Dialog } from '../navigation/overlays';
import { useAppNavigation, useExitLayer } from '../navigation/navigation-context';
import { useLibraryAttachments } from '../score-library/attachments/use-library-attachments';
import { useApplicationIdentity } from '../auth/application-identity';
import { useNetworkStatus } from '../platform/use-network-status';
import { playbackStore, playbackViewStore, setPlaybackView, startPlayback, stopPlayback, type PlaybackSource } from './playback-store';
import './practice-player.css';

type Props = {
  source: PlaybackSource; ready: boolean; playing: boolean; message?: string; failed?: boolean;
  position: string; previousDisabled: boolean; nextDisabled: boolean;
  play(): void; previous(): void; next(): void; retry(): void; children: ReactNode;
};

export function PracticePlayerShell(props: Props) {
  const { source } = props;
  const view = useSyncExternalStore(playbackViewStore.subscribe, playbackViewStore.getSnapshot);
  const [panel, setPanel] = useState<'settings' | 'sources' | null>(null);
  const settingsTrigger = useRef<HTMLButtonElement>(null), sourcesTrigger = useRef<HTMLButtonElement>(null);
  const dock = useRef<HTMLDivElement>(null);
  const location = useLocation(), navigate = useNavigate(), navigation = useAppNavigation();
  const identity = useApplicationIdentity(), online = useNetworkStatus();
  const currentSession = identity.onlineState === 'authenticated' || identity.onlineState === 'signed-out';
  const metadata = useLibraryAttachments(source.choirId, [{ ...source.score, attachmentCount: source.score.attachmentCount ?? 1 }],
    online && currentSession && identity.authenticatedSessionId === source.sessionId, `${source.ownerKey}:${source.sessionId ?? 'guest'}`);
  const choices = metadata.items.filter(item => item.scoreId === source.score.id && (item.kind === 'musicxml' || item.kind === 'audio') && !item.trashExpiresAt);
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
    if (location.pathname !== path) void navigate(`${path}${location.search}`);
  });
  const selectSource = (id: string) => {
    const attachment = choices.find(item => item.id === id);
    if (attachment && attachment.id !== source.attachment.id) navigation.afterEditing(() => { if (playbackStore.getSnapshot() === source) startPlayback({ ...source, attachment }); });
    setPanel(null);
  };
  const icon = (label: string, children: ReactNode, action: () => void, disabled = false) => <TooltipTrigger>
    <Button className="practice-icon" aria-label={label} isDisabled={disabled} onPress={action}>{children}</Button>
    <Tooltip className="practice-tooltip" placement="top">{label}</Tooltip>
  </TooltipTrigger>;
  return <>
    <div className="practice-dock" data-view={isXml ? view : 'pdf'} ref={dock}>
      {props.message && <div className="practice-notice" role="status"><span>{props.message}</span>{props.failed && <Button onPress={props.retry}>重试</Button>}
        <Button aria-label="结束播放" onPress={stopPlayback}><X size={16} aria-hidden="true" /></Button></div>}
      <section className="practice-bar" aria-label="乐谱练习" data-testid="musicxml-player">
        {icon(isXml ? '前一小节' : '后退 10 秒', <StepBack size={18} aria-hidden="true" />, props.previous, !props.ready || props.previousDisabled)}
        <TooltipTrigger><Button className="practice-icon practice-play" aria-label={props.playing ? '暂停' : '播放'} isDisabled={!props.ready} onPress={props.play}>
          {!props.ready && !props.failed ? <LoaderCircle className="practice-loading-icon" size={18} aria-hidden="true" /> : props.playing ? <Pause size={18} fill="currentColor" aria-hidden="true" /> : <Play size={18} fill="currentColor" aria-hidden="true" />}
        </Button><Tooltip className="practice-tooltip" placement="top">{props.playing ? '暂停' : '播放'}</Tooltip></TooltipTrigger>
        {icon(isXml ? '后一小节' : '前进 10 秒', <StepForward size={18} aria-hidden="true" />, props.next, !props.ready || props.nextDisabled)}
        <span className="practice-position" title={props.position}>{props.position}</span>
        {isXml && <label className="practice-view"><span className="visually-hidden">显示谱面</span><select aria-label="显示谱面" value={view} onChange={event => selectView(event.target.value === 'xml' ? 'xml' : 'pdf')}><option value="pdf">原谱</option><option value="xml">播放谱</option></select></label>}
        {choices.length > 1 && <Button ref={sourcesTrigger} className="practice-icon practice-source" aria-label="选择音源" aria-expanded={panel === 'sources'} onPress={() => setPanel(panel === 'sources' ? null : 'sources')}><ListMusic size={18} aria-hidden="true" /></Button>}
        <Button ref={settingsTrigger} className="practice-icon practice-settings" aria-label="练习设置" aria-expanded={panel === 'settings'} data-active={panel === 'settings' || undefined} onPress={() => setPanel(panel === 'settings' ? null : 'settings')}><SlidersHorizontal size={18} aria-hidden="true" /></Button>
      </section>
    </div>
    {panel && <Popover triggerRef={panel === 'sources' ? sourcesTrigger : settingsTrigger} isOpen onOpenChange={open => { if (!open) setPanel(null); }} placement="top end" className="practice-popover" offset={10}>
      <Dialog className="practice-panel" aria-label={panel === 'sources' ? '选择音源' : '练习设置'}>
        <header><div><strong>{panel === 'sources' ? '音源' : '练习设置'}</strong>{panel === 'settings' && <small>{source.attachment.name}</small>}</div><Button className="practice-icon" aria-label="关闭练习设置" onPress={() => setPanel(null)}><X size={18} aria-hidden="true" /></Button></header>
        {panel === 'sources' ? <div className="practice-source-list" role="group" aria-label="音源">{choices.map(item => <Button key={item.id} className="practice-source-option" aria-pressed={item.id === source.attachment.id} onPress={() => selectSource(item.id)}><span>{item.name}</span>{item.id === source.attachment.id && <Check size={16} aria-hidden="true" />}</Button>)}</div>
          : choices.length > 1 && <label className="practice-field">音源<select aria-label="音源" value={source.attachment.id} onChange={event => selectSource(event.target.value)}>{choices.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
        {panel === 'settings' && <>{props.children}<footer><Button className="practice-end" onPress={stopPlayback}>结束练习</Button></footer></>}
      </Dialog>
    </Popover>}
  </>;
}
