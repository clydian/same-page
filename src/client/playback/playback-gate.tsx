import { Component, lazy, Suspense, useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Button } from 'react-aria-components';
import { diagnosticCauseType, diagnosticErrorType, recordFailure } from '../diagnostics/diagnostics';
import { useUpdateStatus } from '../updates/update-status';
import { useAppNavigation } from '../navigation/navigation-context';
import { playbackStore, setPlaybackView, stopPlayback } from './playback-store';
class PlayerModuleLoadError extends Error {}
function loadPlayer<T>(load: () => Promise<T>) {
  return load().catch(cause => { throw new PlayerModuleLoadError('player_module_load_failed', { cause }); });
}
const MusicXmlPlayer = lazy(() => loadPlayer(() => import('./musicxml-player')));
const AudioPlayer = lazy(() => loadPlayer(() => import('./audio-player')));
export function PlaybackGate() {
  const source = useSyncExternalStore(playbackStore.subscribe, playbackStore.getSnapshot);
  const { pathname } = useLocation();
  const previous = useRef(pathname);
  const base = source ? `/choirs/${source.choirId}` : '';
  const allowed = source && (pathname === base || pathname === `${base}/scores/${source.score.id}`);
  useEffect(() => {
    if (source && (!allowed || (previous.current.includes('/scores/') && pathname === base))) stopPlayback();
    previous.current = pathname;
  }, [pathname, allowed, source, base]);
  if (!allowed) return null;
  const opening = <aside className="playback-loading" aria-label="播放准备" style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 90, background: '#fcfdfb', color: '#31463a', padding: 8 }}>正在打开播放器…<Button onPress={stopPlayback}>取消</Button></aside>;
  return <PlaybackErrorBoundary key={playbackStore.getGeneration()}><Suspense fallback={opening}>
    {source.attachment.kind === 'musicxml'
      ? <MusicXmlPlayer key={`${playbackStore.getGeneration()}`} source={source} />
      : <AudioPlayer key={`${playbackStore.getGeneration()}`} source={source} />}
  </Suspense></PlaybackErrorBoundary>;
}

// The optional player is outside RouteContent: keep its errors outside the
// reader and its in-memory editors, and leave ReloadPrompt mounted.
class PlaybackErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: unknown) {
    setPlaybackView('pdf');
    const moduleFailure = error instanceof PlayerModuleLoadError;
    recordFailure({ operation: 'other', category: 'internal', stage: moduleFailure ? 'request' : 'decode',
      step: 'attachment-entry', errorType: moduleFailure ? diagnosticCauseType(error) ?? diagnosticErrorType(error.cause) : diagnosticErrorType(error) });
  }
  render() { return this.state.failed ? <PlaybackFailure /> : this.props.children; }
}

function PlaybackFailure() {
  const update = useUpdateStatus();
  const navigation = useAppNavigation();
  const navigate = useNavigate();
  return <aside className="playback-loading" aria-label="播放器加载失败" style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 90, background: '#fcfdfb', color: '#31463a', padding: 8 }}>
    <p role="alert">播放器加载失败，乐谱和笔记仍可继续使用。请保存当前操作，再进入恢复播放器检查本机资源并重新加载。</p>
    <p role="status">版本更新：{update.message}</p>
    <Button onPress={stopPlayback}>关闭播放器</Button>
    <Button onPress={() => navigation.afterEditing(() => {
      stopPlayback();
      void navigate('/about', { state: { recoverPlayer: true } });
    })}>恢复播放器</Button>
    <Button isDisabled={["registering", "checking", "preparing", "applying", "unsupported"].includes(update.phase)} onPress={() => window.dispatchEvent(new Event('same-page-check-update'))}>检查更新</Button>
    <Link to="/about">关于合谱与版本更新</Link>
  </aside>;
}
