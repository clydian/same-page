import { useMessages } from "../../i18n";
import { useEffect, useRef, useState } from 'react';
import type { PlaybackSource } from './playback-store';
import { MusicXmlPractice } from './musicxml-practice';
import { openMusicXmlPlayback, type MusicXmlOpeningSnapshot } from './musicxml-opening';

export default function MusicXmlPlayer({ source }: { source: PlaybackSource }) {
  const t = useMessages("practice");
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
    session={state.session} error={state.errorCode ? t(state.errorCode) : state.error} offlineStatus={state.offlineStatus}
    preparation={{ message: state.progress.phase === 'access' ? t("checkingScore") : state.progress.phase === 'local' ? t("readingLocalScore") : t("downloadingScore"), loaded: state.progress.loaded, total: state.progress.total }}
    retry={() => opening.current?.retry()} retryOffline={() => opening.current?.retryOffline()} />;
}
