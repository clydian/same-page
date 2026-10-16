import { useEffect, useRef, useState } from 'react';
import { createPlayerSession, type PlayerSession } from '@clydian/chorus-player';
import { attachmentFetch } from '../score-library/attachments/request';
import { readAttachment, attachmentFileUrl } from '../score-library/attachments/api';
import { stopPlayback, type PlaybackSource } from './playback-store';
import { SettingsRequestError } from '../settings/settings-request';
import { MusicXmlPractice } from './musicxml-practice';
import { clearPlaybackPreparation, readPlaybackPreparation, savePlaybackPreparation } from './playback-preparation';
import { usePlaybackLifetime } from './use-playback-lifetime';
export default function MusicXmlPlayer({ source }: { source: PlaybackSource }) {
  const container = useRef<HTMLDivElement>(null), viewport = useRef<HTMLDivElement>(null);
  const [session, setSession] = useState<PlayerSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  usePlaybackLifetime(source);
  useEffect(() => {
    const abort = new AbortController();
    let player: PlayerSession | null = null;
    const timeout = setTimeout(() => abort.abort(new Error('读取附件超时，请重试。')), 60000);
    const pauseForAudio = (event: Event) => { if (event.target instanceof HTMLMediaElement) player?.pause(); };
    document.addEventListener('play', pauseForAudio, true);
    void (async () => {
      const fresh = await readAttachment(source.choirId, source.score.id, source.attachment.id, abort.signal);
      if (abort.signal.aborted) return;
      if (fresh.revision !== source.attachment.revision) throw new Error('附件已更新，请从附件列表重新打开。');
      const cached = readPlaybackPreparation(source);
      let bytes = cached?.bytes;
      if (!bytes) {
        const response = await attachmentFetch(attachmentFileUrl(source.choirId, source.attachment), { signal: abort.signal });
        if (abort.signal.aborted) return;
        if (!response.ok) {
          if ([401, 403, 404].includes(response.status)) { stopPlayback(); return; }
          throw new Error('无法读取附件，请检查网络后重试。');
        }
        bytes = new Uint8Array(await response.arrayBuffer());
      }
      if (abort.signal.aborted || !container.current) return;
      clearTimeout(timeout);
      const sourceBytes = bytes;
      player = createPlayerSession(container.current, sourceBytes, { scrollElement: viewport.current ?? undefined, prepared: cached?.prepared,
        onPrepared: prepared => { if (!abort.signal.aborted) savePlaybackPreparation(source, sourceBytes, prepared); } });
      setSession(player);
    })().catch(reason => {
      if (!abort.signal.aborted && reason instanceof SettingsRequestError && [401,403,404].includes(reason.status)) { clearPlaybackPreparation(source); stopPlayback(); return; }
      if (!abort.signal.aborted || abort.signal.reason instanceof Error && abort.signal.reason.name !== 'AbortError') setError(reason instanceof Error ? reason.message : '读取失败。');
    });
    return () => { abort.abort(); clearTimeout(timeout); document.removeEventListener('play', pauseForAudio, true); player?.dispose(); };
  }, [source, attempt]);
  return <MusicXmlPractice source={source} session={session} error={error} container={container} viewport={viewport} retry={() => { setError(null); setSession(null); setAttempt(value => value + 1); }} />;
}
