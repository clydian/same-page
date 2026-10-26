import { prepareOfflineMusicXml } from './offline-musicxml';
import { useEffect, useRef, useState } from 'react';
import { createPlayerSession, type PlayerSession } from '@same-page/player';
import { stopPlayback, type PlaybackSource } from './playback-store';
import { SettingsRequestError } from '../settings/settings-request';
import { MusicXmlPractice } from './musicxml-practice';
import { acquirePlaybackPreparation, clearPlaybackPreparation } from './playback-preparation';
import { usePlaybackLifetime } from './use-playback-lifetime';
import { resolveMusicXmlSource } from './musicxml-source';
import { musicXmlLoadingTracker } from './musicxml-loading';

export default function MusicXmlPlayer({ source }: { source: PlaybackSource }) {
  const container = useRef<HTMLDivElement>(null), viewport = useRef<HTMLDivElement>(null);
  const [session, setSession] = useState<PlayerSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState<'preparing' | 'ready' | 'failed'>('preparing');
  const [preparation, setPreparation] = useState<{ bytes: Uint8Array; save: (bytes: Uint8Array, signal?: AbortSignal) => Promise<void>; signal: AbortSignal; source: PlaybackSource; canSaveAutomatically: boolean; loading: ReturnType<typeof musicXmlLoadingTracker> } | null>(null);
  const [foregroundReady, setForegroundReady] = useState(false);
  const [offlineAttempt, retryOffline] = useState(0);
  const [attempt, setAttempt] = useState(0);
  usePlaybackLifetime(source);
  useEffect(() => {
    const abort = new AbortController();
    const lease = acquirePlaybackPreparation(source);
    const loading = musicXmlLoadingTracker();
    let player: PlayerSession | null = null;
    let unsubscribe: (() => void) | undefined;
    let firstSystem = false, active = true;
    const timeout = setTimeout(() => {
      const reason = new Error('读取附件超时，请重试。');
      abort.abort(reason);
      if (active) setError(reason.message);
    }, 60000);
    const pauseForAudio = (event: Event) => { if (event.target instanceof HTMLMediaElement) player?.pause(); };
    document.addEventListener('play', pauseForAudio, true);
    void (async () => {
      const resolved = await resolveMusicXmlSource(source, abort.signal, lease, () => loading.stage('authorized'));
      abort.signal.throwIfAborted();
      loading.source(resolved.tier); loading.stage('raw-ready');
      if (resolved.tier === 'offline') { setOffline('ready'); loading.stage('offline-ready'); }
      else if (resolved.save) {
        setPreparation({ bytes: resolved.bytes, save: resolved.save, signal: abort.signal, source, canSaveAutomatically: resolved.canSaveAutomatically, loading });
        if (!resolved.canSaveAutomatically) { setOffline('failed'); loading.stage('offline-retry-required'); }
      }
      else setOffline('failed');
      if (!container.current) return;
      clearTimeout(timeout);
      const frontReady = () => {
        if (!active) return;
        const status = player?.getSnapshot().status;
        if (status === 'error') { loading.end('error'); setForegroundReady(false); }
        else if (firstSystem && status === 'ready') setForegroundReady(true);
      };
      player = createPlayerSession(container.current, resolved.bytes, {
        scrollElement: viewport.current ?? undefined, prepared: resolved.prepared,
        onLoadingStage: stage => loading.stage(stage),
        onFirstReadableSystem: () => { firstSystem = true; frontReady(); },
        onPrepared: prepared => {
          if (abort.signal.aborted || !resolved.assertCurrent) return;
          // Worker completion can arrive after a storage cleanup or owner switch.
          // Recheck the captured access before retaining protected derived bytes.
          void resolved.assertCurrent().then(() => {
            if (!abort.signal.aborted) lease.save(resolved.bytes, prepared, resolved.cacheIdentity);
          }).catch(() => undefined);
        },
      });
      unsubscribe = player.subscribe(frontReady);
      frontReady();
      setSession(player);
    })().catch(reason => {
      clearTimeout(timeout);
      if (!active) return;
      loading.end('error');
      if (!abort.signal.aborted && reason instanceof SettingsRequestError && [401,403,404].includes(reason.status)) { clearPlaybackPreparation(source); stopPlayback(); return; }
      if (!abort.signal.aborted || abort.signal.reason instanceof Error && abort.signal.reason.name !== 'AbortError') setError(reason instanceof Error ? reason.message : '读取失败。');
    });
    return () => { active = false; abort.abort(); clearTimeout(timeout); document.removeEventListener('play', pauseForAudio, true); unsubscribe?.(); player?.dispose(); lease.release(); loading.end('cancelled'); };
  }, [source, attempt]);
  // A discarded opening access cannot be recaptured by an automatic task after
  // cleanup. Only a new explicit retry may establish a new write intent.
  const offlineIntent = preparation && (offlineAttempt > 0 ? offlineAttempt : preparation.canSaveAutomatically && foregroundReady ? 0 : null);
  useEffect(() => {
    if (!preparation || preparation.source !== source || preparation.signal.aborted || offlineIntent === null) return;
    const abort = new AbortController();
    const signal = AbortSignal.any([preparation.signal, abort.signal]);
    void prepareOfflineMusicXml(source, () => preparation.save(preparation.bytes, signal), signal).then(() => {
      if (!signal.aborted) { setOffline('ready'); preparation.loading.stage('offline-ready'); }
    }).catch(reason => {
      if (signal.aborted) return;
      if (reason instanceof SettingsRequestError && [401,403,404].includes(reason.status)) { clearPlaybackPreparation(source); stopPlayback(); return; }
      setOffline('failed');
    });
    return () => { abort.abort(); };
  }, [source, preparation, offlineIntent]);
  return <MusicXmlPractice offlineStatus={offline} retryOffline={() => { setOffline('preparing'); retryOffline(value => value + 1); }} source={source} session={session} error={error} container={container} viewport={viewport} retry={() => { setError(null); setSession(null); setForegroundReady(false); setPreparation(null); setOffline('preparing'); retryOffline(0); setAttempt(value => value + 1); }} />;
}
