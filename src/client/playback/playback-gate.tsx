import { Component, lazy, Suspense, useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Button } from 'react-aria-components';
import { diagnosticErrorType, recordFailure } from '../diagnostics/diagnostics';
import { useUpdateStatus } from '../updates/update-status';
import { playbackStore, setPlaybackView, stopPlayback } from './playback-store';
const MusicXmlPlayer = lazy(() => import('./musicxml-player'));
const AudioPlayer = lazy(() => import('./audio-player'));
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
    recordFailure({ operation: 'other', category: 'internal', stage: 'decode',
      errorType: diagnosticErrorType(error) });
  }
  render() { return this.state.failed ? <PlaybackFailure /> : this.props.children; }
}

function PlaybackFailure() {
  const update = useUpdateStatus();
  return <aside className="playback-loading" aria-label="播放器加载失败" style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 90, background: '#fcfdfb', color: '#31463a', padding: 8 }}>
    <p role="alert">播放器加载失败，乐谱和笔记仍可继续使用。请先完成当前操作，再到关于合谱应用更新。</p>
    <p role="status">{update.message}</p>
    <Button onPress={stopPlayback}>关闭播放器</Button>
    <Button isDisabled={["registering", "checking", "preparing", "applying", "unsupported"].includes(update.phase)} onPress={() => window.dispatchEvent(new Event('same-page-check-update'))}>检查更新</Button>
    <Link to="/about">关于合谱与版本更新</Link>
  </aside>;
}
