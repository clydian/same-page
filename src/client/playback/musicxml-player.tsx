import { captureMusicXmlWrite, prepareOfflineMusicXml, readOfflineMusicXml, revokeOfflineMusicXml } from './offline-musicxml';
import { useEffect, useRef, useState } from 'react';
import { createPlayerSession, type PlayerSession } from '@same-page/player';
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
  const [offline, setOffline] = useState<'preparing' | 'ready' | 'failed'>('preparing');
  const [preparation, setPreparation] = useState<{ bytes: Uint8Array; save: (bytes: Uint8Array) => Promise<void> } | null>(null);
  const [offlineAttempt, retryOffline] = useState(0);
  const [attempt, setAttempt] = useState(0);
  usePlaybackLifetime(source);
  useEffect(() => {
    const abort = new AbortController();
    let player: PlayerSession | null = null;
    let active = true;
    const timeout = setTimeout(() => {
      const reason = new Error('读取附件超时，请重试。');
      abort.abort(reason);
      if (active) setError(reason.message);
    }, 60000);
    const pauseForAudio = (event: Event) => { if (event.target instanceof HTMLMediaElement) player?.pause(); };
    document.addEventListener('play', pauseForAudio, true);
    void (async () => {
      // Capture the write lifetime before either authorization or download yields.
      const save = await captureMusicXmlWrite(source, abort.signal).catch(() => null);
      abort.signal.throwIfAborted();
      let bytes: Uint8Array | undefined;
      let cached: ReturnType<typeof readPlaybackPreparation>;
      try {
        if (!navigator.onLine) throw new TypeError('offline');
        const fresh = await readAttachment(source.choirId, source.score.id, source.attachment.id, abort.signal);
        abort.signal.throwIfAborted();
        if (fresh.revision !== source.attachment.revision || fresh.trashExpiresAt) throw new Error('附件已更新，请从附件列表重新打开。');
        cached = readPlaybackPreparation(source);
        bytes = cached?.bytes;
        if (!bytes) {
          const response = await attachmentFetch(attachmentFileUrl(source.choirId, source.attachment), { signal: abort.signal });
          if (!response.ok) throw new SettingsRequestError(response.status);
          bytes = new Uint8Array(await response.arrayBuffer());
        }
      } catch (reason) {
        if (abort.signal.aborted) throw abort.signal.reason;
        if (reason instanceof SettingsRequestError && [401, 403, 404].includes(reason.status)) {
          await revokeOfflineMusicXml(source).catch(() => undefined);
          throw reason;
        }
        // A revision mismatch or malformed response must never select old bytes.
        if (!(reason instanceof TypeError) && !(reason instanceof SettingsRequestError && reason.status >= 500)) throw reason;
        bytes = await readOfflineMusicXml(source) ?? undefined;
        if (!bytes) throw new Error('这份练习谱尚未完成离线准备，请联网打开后重试。', { cause: reason });
        setOffline('ready');
      }
      abort.signal.throwIfAborted();
      if (save && navigator.onLine) setPreparation({ bytes, save });
      else if (!save) setOffline('failed');
      abort.signal.throwIfAborted();
      if (!container.current) return;
      clearTimeout(timeout);
      const sourceBytes = bytes;
      player = createPlayerSession(container.current, sourceBytes, { scrollElement: viewport.current ?? undefined, prepared: cached?.prepared,
        onPrepared: prepared => { if (!abort.signal.aborted) savePlaybackPreparation(source, sourceBytes, prepared); } });
      setSession(player);
    })().catch(reason => {
      clearTimeout(timeout);
      if (!active) return;
      if (!abort.signal.aborted && reason instanceof SettingsRequestError && [401,403,404].includes(reason.status)) { clearPlaybackPreparation(source); stopPlayback(); return; }
      if (!abort.signal.aborted || abort.signal.reason instanceof Error && abort.signal.reason.name !== 'AbortError') setError(reason instanceof Error ? reason.message : '读取失败。');
    });
    return () => { active = false; abort.abort(); clearTimeout(timeout); document.removeEventListener('play', pauseForAudio, true); player?.dispose(); };
  }, [source, attempt]);
  useEffect(() => {
    if (!preparation) return;
    let active = true;
    void prepareOfflineMusicXml(source, () => preparation.save(preparation.bytes)).then(() => {
      if (active) setOffline('ready');
    }).catch(() => { if (active) setOffline('failed'); });
    return () => { active = false; };
  }, [source, preparation, offlineAttempt]);
  return <MusicXmlPractice offlineStatus={offline} retryOffline={() => { setOffline('preparing'); retryOffline(value => value + 1); }} source={source} session={session} error={error} container={container} viewport={viewport} retry={() => { setError(null); setSession(null); setAttempt(value => value + 1); }} />;
}
