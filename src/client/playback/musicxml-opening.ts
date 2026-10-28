import { createPlayerSession, type PlayerSession } from '@same-page/player';
import { acquirePlaybackPreparation, clearPlaybackPreparation } from './playback-preparation';
import { resolveMusicXmlSource, MUSICXML_READ_TIMEOUT_MS, type MusicXmlReadProgress } from './musicxml-source';
import { musicXmlLoadingTracker } from './musicxml-loading';
import { playbackStore, stopPlayback, type PlaybackSource } from './playback-store';
import { readAttachment } from '../score-library/attachments/api';
import { SettingsRequestError } from '../settings/settings-request';
import { holdUpdate } from '../updates/update-safety';
import { onDriveChange } from '../settings/navigation-events';
import { prepareOfflineMusicXml, revokeOfflineMusicXml } from './offline-musicxml';

export interface MusicXmlOpeningSnapshot {
  session: PlayerSession | null;
  progress: MusicXmlReadProgress;
  error: string | null;
  offlineStatus: 'preparing' | 'ready' | 'failed';
}
interface OpeningTarget { source: PlaybackSource; container: HTMLDivElement; viewport: HTMLDivElement }

/** One explicit practice opening owns every retry and its protected results. */
export function openMusicXmlPlayback({ source, container, viewport }: OpeningTarget, changed: (snapshot: MusicXmlOpeningSnapshot) => void) {
  let disposed = false;
  let stopAttempt: (() => void) | undefined;
  let snapshot: MusicXmlOpeningSnapshot;
  let verifyAuthority = () => {};
  let retryOffline = () => {};
  const releaseUpdate = holdUpdate();
  const releaseDrive = onDriveChange(impact => {
    if (impact.driveId === source.choirId && impact.dropAuthority && playbackStore.getSnapshot() === source) {
      dispose(); stopPlayback();
    }
  });
  const focus = () => verifyAuthority();
  const pauseForAudio = (event: Event) => {
    if (event.target instanceof HTMLMediaElement) snapshot.session?.pause();
  };
  window.addEventListener('focus', focus);
  document.addEventListener('play', pauseForAudio, true);
  const denied = (reason: unknown) => reason instanceof SettingsRequestError && [401, 403, 404].includes(reason.status);
  const revoke = () => {
    if (disposed || playbackStore.getSnapshot() !== source) return;
    clearPlaybackPreparation(source);
    void revokeOfflineMusicXml(source).catch(() => undefined);
    dispose(); stopPlayback();
  };
  const publish = (patch: Partial<MusicXmlOpeningSnapshot>) => {
    if (disposed) return;
    snapshot = { ...snapshot, ...patch };
    changed(snapshot);
  };
  const retry = () => {
    if (disposed) return;
    stopAttempt?.();
    retryOffline = () => {};
    snapshot = { session: null, progress: { phase: 'access' }, error: null, offlineStatus: 'preparing' };
    publish({});
    const abort = new AbortController();
    const authorityAbort = new AbortController();
    const lease = acquirePlaybackPreparation(source);
    const loading = musicXmlLoadingTracker();
    let active = true;
    let player: PlayerSession | undefined;
    let unsubscribe: (() => void) | undefined;
    let stopOffline = () => {};
    let firstSystem = false;
    let automaticStarted = false;
    const timeout = setTimeout(() => {
      const reason = new Error('读取附件超时，请重试。');
      abort.abort(reason);
      loading.end('error');
      publish({ error: reason.message });
    }, MUSICXML_READ_TIMEOUT_MS);
    verifyAuthority = () => {
      // Focus is a fresh authority check, never a cached opening permission.
      void readAttachment(source.choirId, source.score.id, source.attachment.id, authorityAbort.signal).catch(reason => {
        if (active && !authorityAbort.signal.aborted && denied(reason)) revoke();
      });
    };
    stopAttempt = () => {
      active = false; abort.abort(); authorityAbort.abort(); clearTimeout(timeout);
      stopOffline(); unsubscribe?.(); player?.dispose(); lease.release(); loading.end('cancelled');
    };
    void (async () => {
      const resolved = await resolveMusicXmlSource(source, abort.signal, lease,
        () => loading.stage('authorized'), progress => { if (active && !abort.signal.aborted) publish({ progress }); });
      abort.signal.throwIfAborted();
      if (!active) return;
      clearTimeout(timeout);
      loading.source(resolved.tier); loading.stage('raw-ready');
      publish({ offlineStatus: resolved.tier === 'offline' ? 'ready' : resolved.canSaveAutomatically && resolved.save ? 'preparing' : 'failed' });
      if (resolved.tier === 'offline') loading.stage('offline-ready');
      else if (!resolved.canSaveAutomatically) loading.stage('offline-retry-required');
      const prepareOffline = () => {
        const save = resolved.save;
        if (!active || abort.signal.aborted || !save) return;
        stopOffline();
        const task = new AbortController();
        const signal = AbortSignal.any([abort.signal, task.signal]);
        stopOffline = () => task.abort();
        publish({ offlineStatus: 'preparing' });
        void prepareOfflineMusicXml(source, () => save(resolved.bytes, signal), signal).then(() => {
          if (!active || signal.aborted) return;
          publish({ offlineStatus: 'ready' }); loading.stage('offline-ready');
        }).catch(reason => {
          if (!active || signal.aborted) return;
          if (denied(reason)) { revoke(); return; }
          publish({ offlineStatus: 'failed' });
        });
      };
      retryOffline = () => {
        // Only a user action may use the resolver's fresh write-intent path.
        automaticStarted = true;
        prepareOffline();
      };
      const frontReady = () => {
        if (!active || abort.signal.aborted) return;
        const status = player?.getSnapshot().status;
        if (status === 'error') { loading.end('error'); stopOffline(); }
        else if (firstSystem && status === 'ready' && !automaticStarted && resolved.canSaveAutomatically) {
          automaticStarted = true; prepareOffline();
        }
      };
      player = createPlayerSession(container, resolved.bytes, {
        scrollElement: viewport, prepared: resolved.prepared,
        onLoadingStage: stage => { if (active) loading.stage(stage); },
        onFirstReadableSystem: () => { firstSystem = true; frontReady(); },
        onPrepared: prepared => {
          if (abort.signal.aborted || !resolved.assertCurrent) return;
          void resolved.assertCurrent().then(() => {
            if (active && !abort.signal.aborted) lease.save(resolved.bytes, prepared, resolved.cacheIdentity);
          }).catch(() => undefined);
        },
      });
      unsubscribe = player.subscribe(frontReady);
      publish({ session: player });
      frontReady();
    })().catch(reason => {
      clearTimeout(timeout);
      if (!active || abort.signal.aborted) return;
      loading.end('error');
      if (denied(reason)) { revoke(); return; }
      publish({ error: reason instanceof Error ? reason.message : '读取失败。' });
    });
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    stopAttempt?.();
    releaseUpdate(); releaseDrive(); releasePlayback();
    window.removeEventListener('focus', focus);
    document.removeEventListener('play', pauseForAudio, true);
  };
  const releasePlayback = playbackStore.subscribe(() => {
    if (playbackStore.getSnapshot() !== source) dispose();
  });
  retry();
  return { retry, retryOffline: () => { if (!disposed) retryOffline(); }, dispose };
}
