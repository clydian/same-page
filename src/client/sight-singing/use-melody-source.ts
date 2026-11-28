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
import { prepareOfflinePlayerAssets, offlinePlayerAssetsReady } from '../playback/offline-player-assets';
import type { PublishedQuestion } from '../../shared/sight-singing';
import { capturePublishedQuestionCopy, type PublishedQuestionScope } from './published-question-cache';
import { readQuestionSnapshot } from './questions';
import { isSightSingingMemberDenied, publishedPath } from './read';

type QuestionSnapshot = { choirId: string; questionId: string; version: number; name: string };
export type MelodySource =
  | { kind: 'library'; playback: PlaybackSource }
  | { kind: 'cloud'; scope: PublishedQuestionScope; question: PublishedQuestion }
  | ({ kind: 'local'; owner: string } & QuestionSnapshot)
  | { kind: 'upload'; choirId: string; key: string; file: File; locale: AppLocale };

type Loaded = { key: string; attempt: number } & ({ document: MelodyScore; bytes: Uint8Array<ArrayBuffer>; name: string } | { error: true });
type SourceRead = { bytes: Uint8Array; name: string; library?: Awaited<ReturnType<typeof resolveMusicXmlSource>>; save?: (bytes: Uint8Array<ArrayBuffer>, task: AbortSignal) => Promise<void> };
const attachmentChanged = (error: unknown) => error instanceof PracticeOpeningError && error.code === 'attachmentUpdated';

function sourceKey(source: MelodySource | null) {
  if (!source) return '';
  if (source.kind === 'library') {
    const { ownerKey, sessionId, choirId, score, attachment } = source.playback;
    return JSON.stringify([source.kind, ownerKey, sessionId, choirId, score.id, attachment.id, attachment.revision]);
  }
  if (source.kind === 'upload') return JSON.stringify([source.kind, source.key]);
  if (source.kind === 'cloud') {
    const { userId, choirId, sessionId } = source.scope;
    return JSON.stringify([source.kind, userId, choirId, sessionId, source.question.id, source.question.version]);
  }
  return JSON.stringify([source.kind, source.owner, source.choirId, source.questionId, source.version]);
}

export function useMelodySource(source: MelodySource | null, canReadCloud: boolean, handlers: {
  onMemberDenied: () => void; onCopySaved: () => void; onQuestionMissing: (id: string, signal: AbortSignal) => void;
}) {
  const key = sourceKey(source);
  const currentSource = useEffectEvent(() => source);
  const [loaded, setLoaded] = useState<Loaded>();
  const [attempt, setAttempt] = useState(0);
  if (loaded && loaded.key !== key) setLoaded(undefined);
  const current = loaded?.key === key && loaded.attempt === attempt && 'document' in loaded ? loaded : null;
  const waitingForConnection = !current && !canReadCloud && source?.kind === 'library' && navigator.onLine;
  const cloudAvailable = useEffectEvent(() => canReadCloud);
  const memberDenied = useEffectEvent(handlers.onMemberDenied);
  const copySaved = useEffectEvent(handlers.onCopySaved);
  const questionMissing = useEffectEvent(handlers.onQuestionMissing);
  const retry = useCallback(() => setAttempt(value => value + 1), []);
  const verifyLibrary = useRef<() => void>(undefined);
  const verifyOnReconnect = useEffectEvent(() => { if (canReadCloud && current) verifyLibrary.current?.(); });
  const retryCloudOnReconnect = useEffectEvent(() => {
    if (canReadCloud && source?.kind === 'cloud' && loaded?.key === key && 'error' in loaded) retry();
  });
  useEffect(() => {
    verifyOnReconnect();
    const timer = setTimeout(() => retryCloudOnReconnect(), 0);
    return () => clearTimeout(timer);
  }, [canReadCloud]);
  useEffect(() => {
    const source = currentSource();
    if (!source || waitingForConnection) return;
    const lifetime = new AbortController();
    const signal = AbortSignal.any([lifetime.signal, AbortSignal.timeout(source.kind === 'cloud' ? 30_000 : MUSICXML_READ_TIMEOUT_MS)]);
    const playback = source.kind === 'library' ? source.playback : null;
    const choirId = source.kind === 'library' ? source.playback.choirId : source.kind === 'cloud' ? source.scope.choirId : source.choirId;
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
        const { question, scope } = source;
        const cache = question.exerciseType === 'rhythm' ? null
          : await capturePublishedQuestionCopy(scope, question, lifetime.signal).catch(() => null);
        const bytes = await cache?.read().catch(() => null);
        signal.throwIfAborted();
        if (bytes && (cloudAvailable() || await offlinePlayerAssetsReady())) return { bytes, name: question.snapshot.name };
        if (!cloudAvailable()) throw new Error('question_source_unavailable');
        const response = await diagnosticFetch(`${publishedPath(choirId, question.exerciseType)}/${encodeURIComponent(question.id)}/score?version=${question.version}`, { signal, headers: { 'x-same-page-owner-user-id': scope.userId } });
        if (!response.ok) {
          if (response.status === 404 && !signal.aborted) questionMissing(question.id, lifetime.signal);
          throw new SettingsRequestError(response.status);
        }
        return { bytes: new Uint8Array(await response.arrayBuffer()), name: question.snapshot.name, save: cache?.save };
      }
      throw new Error('question_source_unavailable');
    };
    void open().then(({ bytes: raw, name, library, save }) => {
      signal.throwIfAborted();
      if (playback && !navigationCurrent()) throw new Error('offline_identity_changed');
      if (raw.byteLength > SIGHT_SINGING_SCORE_MAX_BYTES) throw new Error('question_source_too_large');
      const bytes = raw.buffer instanceof ArrayBuffer ? new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength) : Uint8Array.from(raw);
      const cached = library?.prepared;
      const prepared = cached && !('kind' in cached) ? cached : prepareMusicXmlForPlaybackBytes(bytes);
      const document = loadMelodyScore(prepared);
      setLoaded({ key, attempt, document, bytes, name });
      if (save) void prepareOfflinePlayerAssets(lifetime.signal).then(() => save(bytes, lifetime.signal))
        .then(() => { if (!lifetime.signal.aborted) copySaved(); }).catch(() => undefined);
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
