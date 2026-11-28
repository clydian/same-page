import { prepareMusicXmlForPlaybackBytes } from '@same-page/player/engine';
import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react';
import type { AppLocale } from '../../i18n';
import { SIGHT_SINGING_SCORE_MAX_BYTES } from '../../shared/sight-singing';
import { diagnosticFetch } from '../diagnostics/diagnostics';
import { isSettingsReadDenied, SettingsRequestError } from '../settings/settings-request';
import { captureNavigationIdentity, onDriveChange } from '../settings/navigation-events';
import { acquirePlaybackPreparation, clearPlaybackPreparation } from '../playback/playback-preparation';
import { MUSICXML_READ_TIMEOUT_MS, readPlaybackAttachment, resolveMusicXmlSource, validateMusicXmlAttachment } from '../playback/musicxml-source';
import { readOfflineMusicXml, revokeOfflineMusicXml } from '../playback/offline-musicxml';
import { PracticeOpeningError } from '../playback/practice-error';
import type { PlaybackSource } from '../playback/playback-store';
import { validateMusicXmlFile } from '../playback/validate-musicxml';
import { loadMelodyScore, type MelodyScore } from './melody';
import { readQuestionSnapshot } from './questions';
import { isSightSingingMemberDenied, publishedPath } from './read';

type QuestionSnapshot = { choirId: string; questionId: string; version: number; name: string };
export type MelodySource =
  | { kind: 'library'; playback: PlaybackSource }
  | ({ kind: 'cloud' } & QuestionSnapshot)
  | ({ kind: 'local'; owner: string } & QuestionSnapshot)
  | { kind: 'upload'; choirId: string; key: string; file: File; locale: AppLocale };

type Loaded = { key: string; attempt: number } & ({ document: MelodyScore; bytes: Uint8Array<ArrayBuffer>; name: string } | { error: true });
type SourceRead = { bytes: Uint8Array; name: string; library?: Awaited<ReturnType<typeof resolveMusicXmlSource>> };
const attachmentChanged = (error: unknown) => error instanceof PracticeOpeningError && error.code === 'attachmentUpdated';

function sourceKey(source: MelodySource | null) {
  if (!source) return '';
  if (source.kind === 'library') {
    const { ownerKey, sessionId, choirId, score, attachment } = source.playback;
    return JSON.stringify([source.kind, ownerKey, sessionId, choirId, score.id, attachment.id, attachment.revision]);
  }
  if (source.kind === 'upload') return JSON.stringify([source.kind, source.key]);
  return JSON.stringify([source.kind, source.kind === 'local' ? source.owner : null, source.choirId, source.questionId, source.version]);
}

export function useMelodySource(source: MelodySource | null, canReadCloud: boolean, onMemberDenied: () => void) {
  const key = sourceKey(source);
  const currentSource = useEffectEvent(() => source);
  const [loaded, setLoaded] = useState<Loaded>();
  const [attempt, setAttempt] = useState(0);
  if (loaded && loaded.key !== key) setLoaded(undefined);
  const current = loaded?.key === key && loaded.attempt === attempt && 'document' in loaded ? loaded : null;
  const waitingForConnection = !current && !canReadCloud && (source?.kind === 'cloud' || source?.kind === 'library' && navigator.onLine);
  const cloudAvailable = useEffectEvent(() => canReadCloud);
  const memberDenied = useEffectEvent(onMemberDenied);
  const retry = useCallback(() => setAttempt(value => value + 1), []);
  const verifyLibrary = useRef<() => void>(undefined);
  const verifyOnReconnect = useEffectEvent(() => { if (canReadCloud && current) verifyLibrary.current?.(); });
  useEffect(() => { verifyOnReconnect(); }, [canReadCloud]);
  useEffect(() => {
    const source = currentSource();
    if (!source || waitingForConnection) return;
    const lifetime = new AbortController();
    const signal = AbortSignal.any([lifetime.signal, AbortSignal.timeout(source.kind === 'cloud' ? 30_000 : MUSICXML_READ_TIMEOUT_MS)]);
    const playback = source.kind === 'library' ? source.playback : null;
    const choirId = source.kind === 'library' ? source.playback.choirId : source.choirId;
    const lease = playback ? acquirePlaybackPreparation(playback) : null;
    const navigationCurrent = captureNavigationIdentity();
    const revoke = () => { lifetime.abort(); setLoaded({ key, attempt, error: true }); };
    const unobserve = onDriveChange(change => { if (playback && change.driveId === choirId && change.dropAuthority) revoke(); });
    const verify = () => {
      if (!playback || !cloudAvailable() || document.visibilityState !== 'visible' || lifetime.signal.aborted) return;
      const authorityCurrent = captureNavigationIdentity();
      void readPlaybackAttachment(playback, lifetime.signal).then(fresh => {
        validateMusicXmlAttachment(playback, fresh);
      }).catch(reason => {
        if (lifetime.signal.aborted || !authorityCurrent() || (!isSettingsReadDenied(reason) && !attachmentChanged(reason))) return;
        clearPlaybackPreparation(playback);
        if (isSettingsReadDenied(reason)) void revokeOfflineMusicXml(playback).catch(() => undefined);
        revoke();
      });
    };
    verifyLibrary.current = verify;
    window.addEventListener('focus', verify);
    window.addEventListener('online', verify);
    const open = async (): Promise<SourceRead> => {
      if (source.kind === 'library' && lease) {
        const library = cloudAvailable() ? await resolveMusicXmlSource(source.playback, signal, lease) : undefined;
        const bytes = library?.bytes ?? await readOfflineMusicXml(source.playback, signal);
        if (!bytes) throw new Error('question_source_unavailable');
        return { bytes, name: source.playback.attachment.name, library };
      }
      if (source.kind === 'upload') {
        await validateMusicXmlFile(source.file, signal, source.locale);
        return { bytes: new Uint8Array(await source.file.arrayBuffer()), name: source.file.name };
      }
      if (source.kind === 'local') {
        const blob = await readQuestionSnapshot(source.owner, choirId, source.questionId, source.version);
        if (blob) return { bytes: new Uint8Array(await blob.arrayBuffer()), name: source.name };
      }
      if (source.kind === 'cloud') {
        const response = await diagnosticFetch(`${publishedPath(choirId)}/${encodeURIComponent(source.questionId)}/score?version=${source.version}`, {
          signal,
        });
        if (!response.ok) throw new SettingsRequestError(response.status);
        return { bytes: new Uint8Array(await response.arrayBuffer()), name: source.name };
      }
      throw new Error('question_source_unavailable');
    };
    void open().then(({ bytes: raw, name, library }) => {
      signal.throwIfAborted();
      if (playback && !navigationCurrent()) throw new Error('offline_identity_changed');
      if (raw.byteLength > SIGHT_SINGING_SCORE_MAX_BYTES) throw new Error('question_source_too_large');
      const bytes = raw.buffer instanceof ArrayBuffer ? new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength) : Uint8Array.from(raw);
      const cached = library?.prepared;
      const prepared = cached && !('kind' in cached) ? cached : prepareMusicXmlForPlaybackBytes(bytes);
      const document = loadMelodyScore(prepared);
      setLoaded({ key, attempt, document, bytes, name });
      if (cached !== prepared && lease && library?.assertCurrent) {
        void library.assertCurrent().then(() => {
          if (!signal.aborted) lease.save(raw, prepared, library.cacheIdentity);
        }).catch(() => undefined);
      }
    }).catch(error => {
      if (lifetime.signal.aborted) return;
      if (playback && navigationCurrent() && (isSettingsReadDenied(error) || attachmentChanged(error))) clearPlaybackPreparation(playback);
      if (source.kind === 'cloud' && isSightSingingMemberDenied(error)) memberDenied();
      setLoaded({ key, attempt, error: true });
    });
    return () => {
      verifyLibrary.current = undefined;
      lifetime.abort(); lease?.release(); unobserve();
      window.removeEventListener('focus', verify);
      window.removeEventListener('online', verify);
    };
  }, [key, attempt, waitingForConnection]);
  return {
    document: current?.document ?? null, bytes: current?.bytes ?? null, name: current?.name ?? null,
    failed: waitingForConnection || loaded?.key === key && loaded.attempt === attempt && 'error' in loaded, retry,
  };
}
