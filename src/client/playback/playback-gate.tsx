import { lazy, Suspense, useEffect, useRef, useSyncExternalStore } from 'react';
import { useLocation } from 'react-router-dom';
import { Button } from 'react-aria-components';
import { playbackStore, stopPlayback } from './playback-store';
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
  return <Suspense fallback={opening}>
    {source.attachment.kind === 'musicxml'
      ? <MusicXmlPlayer key={`${playbackStore.getGeneration()}`} source={source} />
      : <AudioPlayer key={`${playbackStore.getGeneration()}`} source={source} />}
  </Suspense>;
}
