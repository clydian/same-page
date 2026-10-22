import { readAttachment, attachmentFileUrl } from '../score-library/attachments/api';
import { attachmentFetch } from '../score-library/attachments/request';
import { captureNavigationIdentity } from '../settings/navigation-events';
import { SettingsRequestError } from '../settings/settings-request';
import { captureMusicXmlAccess, readOfflineMusicXml, readStoredMusicXml, revokeOfflineMusicXml } from './offline-musicxml';
import type { acquirePlaybackPreparation } from './playback-preparation';
import type { PlaybackSource } from './playback-store';

type Metadata = Awaited<ReturnType<typeof readAttachment>>;
type PendingMetadata = { controller: AbortController; promise: Promise<Metadata>; consumers: number; settled: boolean };
// Exact source identity is one explicit opening, including its owner/effective session.
// Settled values are never retained as authority for a later opening or focus.
const metadata = new WeakMap<PlaybackSource, PendingMetadata>();
export function readPlaybackAttachment(source: PlaybackSource, signal: AbortSignal) {
  signal.throwIfAborted();
  let pending = metadata.get(source);
  if (!pending) {
    const controller = new AbortController();
    pending = { controller, consumers: 0, settled: false, promise: readAttachment(source.choirId, source.score.id, source.attachment.id, controller.signal) };
    metadata.set(source, pending);
    const task = pending;
    // A lifetime-hook consumer must not keep a timed-out opening alive and make
    // a retry join that same hung request forever. This bounds the shared task.
    const timeout = setTimeout(() => controller.abort(new Error('读取附件超时，请重试。')), 60_000);
    const forget = () => { clearTimeout(timeout); if (metadata.get(source) === task) metadata.delete(source); };
    controller.signal.addEventListener('abort', forget, { once: true });
    const settled = () => { task.settled = true; controller.signal.removeEventListener('abort', forget); forget(); };
    void task.promise.then(settled, settled);
  }
  const task = pending;
  task.consumers++;
  return new Promise<Metadata>((resolve, reject) => {
    let finished = false;
    const finish = (action: () => void) => {
      if (finished) return;
      finished = true;
      signal.removeEventListener('abort', aborted);
      task.controller.signal.removeEventListener('abort', taskAborted);
      task.consumers--;
      if (!task.settled && !task.consumers) {
        if (metadata.get(source) === task) metadata.delete(source);
        task.controller.abort();
      }
      action();
    };
    const aborted = () => finish(() => reject(signal.reason));
    const taskAborted = () => finish(() => reject(task.controller.signal.reason));
    task.controller.signal.addEventListener('abort', taskAborted, { once: true });
    signal.addEventListener('abort', aborted, { once: true });
    void task.promise.then(value => finish(() => resolve(value)), reason => finish(() => reject(reason)));
  });
}
const denied = (reason: unknown) => reason instanceof SettingsRequestError && [401, 403, 404].includes(reason.status);
const temporary = (reason: unknown) => reason instanceof TypeError || reason instanceof SettingsRequestError && reason.status >= 500;
const identityChanged = (reason: unknown) => reason instanceof Error && ['offline_identity_changed', 'local_workspace_owner_changed'].includes(reason.message);
// An initial guardrail, to be tuned with device Blob+SHA measurements. A stalled
// local store must not keep a working network request behind an unbounded read.
const LOCAL_READ_BUDGET_MS = 250;
type MusicXmlAccess = Awaited<ReturnType<typeof captureMusicXmlAccess>>;
async function boundedLocalPreparation(accessRead: Promise<{ access: MusicXmlAccess } | { reason: unknown }>, preparation: ReturnType<typeof acquirePlaybackPreparation>, signal: AbortSignal, localAbort: AbortController) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let aborted: (() => void) | undefined;
  const local = async () => {
    const captured = await accessRead;
    signal.throwIfAborted(); localAbort.signal.throwIfAborted();
    if ('reason' in captured) {
      if (identityChanged(captured.reason)) throw captured.reason;
      return null;
    }
    const access = captured.access;
    await access.assertCurrent(); localAbort.signal.throwIfAborted();
    const cached = preparation.read(access.cacheIdentity);
    if (cached) return { access, cached, bytes: cached.bytes };
    let bytes: Uint8Array<ArrayBuffer> | null;
    try { bytes = await readStoredMusicXml(access); }
    catch (reason) { if (identityChanged(reason)) throw reason; bytes = null; }
    localAbort.signal.throwIfAborted();
    await access.assertCurrent(); localAbort.signal.throwIfAborted();
    return { access, cached: undefined, bytes };
  };
  try {
    return await Promise.race([
      local(),
      new Promise<null>((resolve, reject) => {
        timer = setTimeout(() => { localAbort.abort(); resolve(null); }, LOCAL_READ_BUDGET_MS);
        aborted = () => reject(signal.reason);
        signal.addEventListener('abort', aborted, { once: true });
      }),
    ]);
  } finally {
    clearTimeout(timer);
    if (aborted) signal.removeEventListener('abort', aborted);
  }
}
async function boundedFinalAccessGuard(access: MusicXmlAccess, signal: AbortSignal, localAbort: AbortController) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let aborted: (() => void) | undefined;
  try {
    await Promise.race([
      access.assertCurrent(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => { localAbort.abort(); reject(new Error('musicxml_local_storage_timeout')); }, LOCAL_READ_BUDGET_MS);
        aborted = () => reject(signal.reason);
        signal.addEventListener('abort', aborted, { once: true });
      }),
    ]);
    signal.throwIfAborted();
  } catch (reason) {
    if (signal.aborted || identityChanged(reason)) throw reason;
    // A failed workspace guard is not a network failure and cannot authorize an
    // offline fallback or silently bypass a previously captured identity fence.
    throw new Error('本机状态校验未完成，请重试。', { cause: reason });
  } finally {
    clearTimeout(timer); if (aborted) signal.removeEventListener('abort', aborted);
  }
}
function validateMusicXmlAttachment(source: PlaybackSource, fresh: Metadata) {
  if (fresh.id !== source.attachment.id || fresh.scoreId !== source.score.id || fresh.kind !== 'musicxml' || fresh.revision !== source.attachment.revision || fresh.sizeBytes !== source.attachment.sizeBytes || fresh.trashExpiresAt) throw new Error('附件已更新，请从附件列表重新打开。');
}
function lazyOriginalSave(source: PlaybackSource, openingSignal: AbortSignal, current: () => boolean) {
  return async (bytes: Uint8Array, taskSignal?: AbortSignal) => {
    const localAbort = new AbortController();
    const signal = AbortSignal.any([openingSignal, localAbort.signal, ...(taskSignal ? [taskSignal] : [])]);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let aborted: (() => void) | undefined;
    try {
      signal.throwIfAborted();
      if (!current()) throw new Error('offline_identity_changed');
      validateMusicXmlAttachment(source, await readPlaybackAttachment(source, signal));
      signal.throwIfAborted();
      if (!current()) throw new Error('offline_identity_changed');
      const capture = async () => {
        const access = await captureMusicXmlAccess(source, signal);
        await access.assertCurrent(); signal.throwIfAborted();
        return access;
      };
      const access = await Promise.race([
        capture(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => localAbort.abort(new Error('musicxml_local_storage_timeout')), LOCAL_READ_BUDGET_MS);
          aborted = () => reject(signal.reason);
          signal.addEventListener('abort', aborted, { once: true });
        }),
      ]);
      clearTimeout(timer); if (aborted) signal.removeEventListener('abort', aborted);
      signal.throwIfAborted();
      if (!current()) throw new Error('offline_identity_changed');
      await access.save(bytes, signal);
    } catch (reason) {
      if (!openingSignal.aborted && current() && denied(reason)) await revokeOfflineMusicXml(source).catch(() => undefined);
      throw reason;
    } finally {
      clearTimeout(timer); if (aborted) signal.removeEventListener('abort', aborted);
      localAbort.abort();
    }
  };
}
export async function resolveMusicXmlSource(source: PlaybackSource, signal: AbortSignal, preparation: ReturnType<typeof acquirePlaybackPreparation>, onAuthorized?: () => void) {
  const current = captureNavigationIdentity();
  // Start before local workspace I/O, allowing the lifetime hook to join this
  // opening's in-flight metadata without keeping a successful auth TTL.
  const freshRead = navigator.onLine ? readPlaybackAttachment(source, signal) : Promise.reject<Metadata>(new TypeError('offline'));
  const localAbort = new AbortController();
  // Capture before authorization yields, but defer protected cache reads until
  // authorization succeeds. The one budget covers capture, fences and Blob/SHA.
  const accessRead = captureMusicXmlAccess(source, AbortSignal.any([signal, localAbort.signal]));
  const accessResult = accessRead.then(access => ({ access }), reason => ({ reason }));
  const assertNavigation = () => {
    signal.throwIfAborted();
    if (!current()) throw new Error('offline_identity_changed');
  };
  let fresh: Metadata;
  try { fresh = await freshRead; }
  catch (reason) {
    signal.throwIfAborted();
    if (!current()) throw new Error('offline_identity_changed', { cause: reason });
    localAbort.abort();
    if (denied(reason)) { await revokeOfflineMusicXml(source).catch(() => undefined); throw reason; }
    if (!temporary(reason)) throw reason;
    const bytes = await readOfflineMusicXml(source, signal);
    signal.throwIfAborted();
    if (!current()) throw new Error('offline_identity_changed', { cause: reason });
    if (!bytes) throw new Error('这份练习谱尚未完成离线准备，请联网打开后重试。', { cause: reason });
    return { bytes, prepared: undefined, tier: 'offline' as const, save: null, cacheIdentity: undefined, assertCurrent: undefined };
  }
  signal.throwIfAborted();
  if (!current()) throw new Error('offline_identity_changed');
  try { validateMusicXmlAttachment(source, fresh); }
  catch (reason) { localAbort.abort(); throw reason; }
  onAuthorized?.();
  const local = await boundedLocalPreparation(accessResult, preparation, signal, localAbort);
  assertNavigation();
  const access = local?.access;
  if (local?.cached) return { bytes: local.cached.bytes, prepared: local.cached.prepared, tier: 'prepared' as const, save: access?.save ?? null, cacheIdentity: access?.cacheIdentity, assertCurrent: access?.assertCurrent };
  if (local?.bytes) return { bytes: local.bytes, prepared: undefined, tier: 'local' as const, save: access?.save ?? null, cacheIdentity: access?.cacheIdentity, assertCurrent: access?.assertCurrent };
  try {
    const url = attachmentFileUrl(source.choirId, fresh);
    const response = await attachmentFetch(`${url}${url.includes('?') ? '&' : '?'}revision=${fresh.revision}`, { signal });
    signal.throwIfAborted();
    if (!response.ok) throw new SettingsRequestError(response.status);
    if (response.headers.get('X-Attachment-Revision') !== String(fresh.revision)) throw new Error('附件已更新，请从附件列表重新打开。');
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength !== fresh.sizeBytes) throw new Error('musicxml_size_mismatch');
    if (access) await boundedFinalAccessGuard(access, signal, localAbort);
    assertNavigation();
    return { bytes, prepared: undefined, tier: 'network' as const, save: access?.save ?? lazyOriginalSave(source, signal, current), cacheIdentity: access?.cacheIdentity, assertCurrent: access?.assertCurrent };
  } catch (reason) {
    signal.throwIfAborted();
    if (!current()) throw new Error('offline_identity_changed', { cause: reason });
    if (denied(reason)) { await revokeOfflineMusicXml(source).catch(() => undefined); throw reason; }
    if (!temporary(reason)) throw reason;
    const bytes = await readOfflineMusicXml(source, signal);
    if (!current()) throw new Error('offline_identity_changed', { cause: reason });
    if (!bytes) throw new Error('这份练习谱尚未完成离线准备，请联网打开后重试。', { cause: reason });
    return { bytes, prepared: undefined, tier: 'offline' as const, save: null, cacheIdentity: undefined, assertCurrent: undefined };
  }
}
