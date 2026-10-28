import { useEffect, useRef, useState } from 'react';
import type { PlaybackSource } from './playback-store';
import { MusicXmlPractice } from './musicxml-practice';
import { openMusicXmlPlayback, type MusicXmlOpeningSnapshot } from './musicxml-opening';

export default function MusicXmlPlayer({ source }: { source: PlaybackSource }) {
  const container = useRef<HTMLDivElement>(null), viewport = useRef<HTMLDivElement>(null);
  const opening = useRef<ReturnType<typeof openMusicXmlPlayback> | null>(null);
  const [state, setState] = useState<MusicXmlOpeningSnapshot>({
    session: null, progress: { phase: 'access' }, error: null, offlineStatus: 'preparing',
  });
  useEffect(() => {
    if (!container.current || !viewport.current) return;
    const current = openMusicXmlPlayback({ source, container: container.current, viewport: viewport.current }, setState);
    opening.current = current;
    return () => { current.dispose(); opening.current = null; };
  }, [source]);
  return <MusicXmlPractice source={source} container={container} viewport={viewport}
    session={state.session} error={state.error} offlineStatus={state.offlineStatus}
    preparation={{ message: state.progress.phase === 'access' ? '正在确认乐谱…' : state.progress.phase === 'local' ? '正在读取本机乐谱…' : '正在下载乐谱…', loaded: state.progress.loaded, total: state.progress.total }}
    retry={() => opening.current?.retry()} retryOffline={() => opening.current?.retryOffline()} />;
}
