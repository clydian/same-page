import { useCallback, useEffect, useEffectEvent, useState } from 'react';
import { readAttachment } from '../score-library/attachments/api';
import { isSettingsReadDenied } from '../settings/settings-request';
import { onDriveChange, onNavigationSuspend } from '../settings/navigation-events';
import { acquirePlaybackPreparation } from '../playback/playback-preparation';
import { MUSICXML_READ_TIMEOUT_MS, resolveMusicXmlSource } from '../playback/musicxml-source';
import type { PlaybackSource } from '../playback/playback-store';
import { loadMelodyScore, type MelodyScore } from './melody';

type Loaded = { key: string; attempt: number } & ({ document: MelodyScore } | { error: true });

export function useMelodySource(source: PlaybackSource | null) {
  const key = source ? JSON.stringify([source.ownerKey, source.sessionId, source.choirId, source.score.id, source.attachment.id, source.attachment.revision]) : '';
  const currentSource = useEffectEvent(() => source);
  const [loaded, setLoaded] = useState<Loaded>();
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt(value => value + 1), []);
  useEffect(() => {
    const source = currentSource();
    if (!source) return;
    const lifetime = new AbortController();
    const signal = AbortSignal.any([lifetime.signal, AbortSignal.timeout(MUSICXML_READ_TIMEOUT_MS)]);
    const lease = acquirePlaybackPreparation(source);
    const revoke = () => { lifetime.abort(); setLoaded({ key, attempt, error: true }); };
    const unobserve = onDriveChange(change => { if (change.driveId === source.choirId && change.dropAuthority) revoke(); });
    const unsuspend = onNavigationSuspend(revoke);
    const verify = () => {
      if (document.visibilityState !== 'visible' || lifetime.signal.aborted) return;
      void readAttachment(source.choirId, source.score.id, source.attachment.id, lifetime.signal).then(fresh => {
        if (!lifetime.signal.aborted && (fresh.revision !== source.attachment.revision || fresh.trashExpiresAt)) revoke();
      }).catch(reason => { if (!lifetime.signal.aborted && isSettingsReadDenied(reason)) revoke(); });
    };
    window.addEventListener('focus', verify);
    void resolveMusicXmlSource(source, signal, lease).then(resolved => {
      signal.throwIfAborted();
      const document = loadMelodyScore(resolved.bytes);
      setLoaded({ key, attempt, document });
    }).catch(() => { if (!lifetime.signal.aborted) setLoaded({ key, attempt, error: true }); });
    return () => {
      lifetime.abort(); lease.release(); unobserve(); unsuspend();
      window.removeEventListener('focus', verify);
    };
  }, [key, attempt]);
  const current = loaded?.key === key && loaded.attempt === attempt ? loaded : undefined;
  return { document: current && 'document' in current ? current.document : null, failed: Boolean(current && 'error' in current), retry };
}
