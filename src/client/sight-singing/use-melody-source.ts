import { useCallback, useEffect, useEffectEvent, useState } from 'react';
import type { AppLocale } from '../../i18n';
import { SIGHT_SINGING_PROTOCOL_HEADER, SIGHT_SINGING_SCORE_MAX_BYTES } from '../../shared/sight-singing';
import { diagnosticFetch } from '../diagnostics/diagnostics';
import { readAttachment } from '../score-library/attachments/api';
import { isSettingsReadDenied } from '../settings/settings-request';
import { onDriveChange, onNavigationSuspend } from '../settings/navigation-events';
import { acquirePlaybackPreparation } from '../playback/playback-preparation';
import { MUSICXML_READ_TIMEOUT_MS, resolveMusicXmlSource } from '../playback/musicxml-source';
import type { PlaybackSource } from '../playback/playback-store';
import { validateMusicXmlFile } from '../playback/validate-musicxml';
import { loadMelodyScore, type MelodyScore } from './melody';
import { readQuestionSnapshot } from './questions';

export const publishedPath = (drive: string) => `/api/choirs/${encodeURIComponent(drive)}/sight-singing/questions`;
export const sightSingingProtocol = { [SIGHT_SINGING_PROTOCOL_HEADER]: '3' };

type QuestionSnapshot = { choirId: string; questionId: string; version: number; name: string };
export type MelodySource =
  | { kind: 'library'; playback: PlaybackSource }
  | ({ kind: 'cloud' } & QuestionSnapshot)
  | ({ kind: 'local'; owner: string } & QuestionSnapshot)
  | { kind: 'upload'; choirId: string; key: string; file: File; locale: AppLocale };

type Loaded = { key: string; attempt: number } & ({ document: MelodyScore; bytes: Uint8Array<ArrayBuffer>; name: string } | { error: true });

function sourceKey(source: MelodySource | null) {
  if (!source) return '';
  if (source.kind === 'library') {
    const { ownerKey, sessionId, choirId, score, attachment } = source.playback;
    return JSON.stringify([source.kind, ownerKey, sessionId, choirId, score.id, attachment.id, attachment.revision]);
  }
  if (source.kind === 'upload') return JSON.stringify([source.kind, source.key]);
  return JSON.stringify([source.kind, source.choirId, source.questionId, source.version]);
}

export function useMelodySource(source: MelodySource | null) {
  const key = sourceKey(source);
  const currentSource = useEffectEvent(() => source);
  const [loaded, setLoaded] = useState<Loaded>();
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt(value => value + 1), []);
  useEffect(() => {
    const source = currentSource();
    if (!source) return;
    const lifetime = new AbortController();
    const signal = AbortSignal.any([lifetime.signal, AbortSignal.timeout(MUSICXML_READ_TIMEOUT_MS)]);
    const playback = source.kind === 'library' ? source.playback : null;
    const choirId = source.kind === 'library' ? source.playback.choirId : source.choirId;
    const lease = playback ? acquirePlaybackPreparation(playback) : null;
    const revoke = () => { lifetime.abort(); setLoaded({ key, attempt, error: true }); };
    const unobserve = onDriveChange(change => { if (change.driveId === choirId && change.dropAuthority) revoke(); });
    const unsuspend = onNavigationSuspend(revoke);
    const verify = () => {
      if (!playback || document.visibilityState !== 'visible' || lifetime.signal.aborted) return;
      void readAttachment(playback.choirId, playback.score.id, playback.attachment.id, lifetime.signal).then(fresh => {
        if (!lifetime.signal.aborted && (fresh.revision !== playback.attachment.revision || fresh.trashExpiresAt)) revoke();
      }).catch(reason => { if (!lifetime.signal.aborted && isSettingsReadDenied(reason)) revoke(); });
    };
    window.addEventListener('focus', verify);
    const open = async (): Promise<{ bytes: Uint8Array<ArrayBuffer>; name: string }> => {
      if (source.kind === 'library' && lease) {
        const { bytes } = await resolveMusicXmlSource(source.playback, signal, lease);
        return { bytes: bytes.buffer instanceof ArrayBuffer ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) : Uint8Array.from(bytes),
          name: source.playback.attachment.name };
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
          signal, headers: sightSingingProtocol,
        });
        if (response.ok) return { bytes: new Uint8Array(await response.arrayBuffer()), name: source.name };
      }
      throw new Error('question_source_unavailable');
    };
    void open().then(({ bytes, name }) => {
      signal.throwIfAborted();
      if (bytes.byteLength > SIGHT_SINGING_SCORE_MAX_BYTES) throw new Error('question_source_too_large');
      setLoaded({ key, attempt, document: loadMelodyScore(bytes), bytes, name });
    }).catch(() => { if (!lifetime.signal.aborted) setLoaded({ key, attempt, error: true }); });
    return () => {
      lifetime.abort(); lease?.release(); unobserve(); unsuspend();
      window.removeEventListener('focus', verify);
    };
  }, [key, attempt]);
  const current = loaded?.key === key && loaded.attempt === attempt && 'document' in loaded ? loaded : null;
  return {
    document: current?.document ?? null, bytes: current?.bytes ?? null, name: current?.name ?? null,
    failed: loaded?.key === key && loaded.attempt === attempt && 'error' in loaded, retry,
  };
}
