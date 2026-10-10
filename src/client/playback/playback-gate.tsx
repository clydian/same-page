import { lazy, Suspense, useEffect, useRef, useSyncExternalStore } from 'react';
import { useLocation } from 'react-router-dom';
import { Button } from 'react-aria-components';
import { playbackStore, playbackNotationStore, playbackViewStore, setPlaybackView, stopPlayback } from './playback-store';
const MusicXmlPlayer = lazy(() => import('./musicxml-player'));
const AudioPlayer = lazy(() => import('./audio-player'));
export function PlaybackGate() {
  const source = useSyncExternalStore(playbackStore.subscribe, playbackStore.getSnapshot);
  const notation = useSyncExternalStore(playbackNotationStore.subscribe, playbackNotationStore.getSnapshot);
  const view = useSyncExternalStore(playbackViewStore.subscribe, playbackViewStore.getSnapshot);
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
  const notationOpening = source.attachment.kind === 'musicxml' ? opening : view === 'xml' ? <section className="practice-notation" data-visible role="status"><div className="practice-notation-status">正在打开重排谱面…<Button className="practice-action" onPress={() => setPlaybackView('pdf')}>返回原始 PDF</Button></div></section> : null;
  return <Suspense fallback={opening}>
    {notation && <Suspense fallback={notationOpening}><MusicXmlPlayer key={`${notation.ownerKey}:${notation.attachment.id}:${notation.attachment.revision}`} source={notation} controls={source.attachment.kind === 'musicxml'} /></Suspense>}
    {source.attachment.kind === 'audio' && <AudioPlayer key={`${source.ownerKey}:${source.attachment.id}:${source.attachment.revision}`} source={source} />}
  </Suspense>;
}
