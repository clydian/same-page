import type { PreparedMusicXml } from '@same-page/player/musicxml-direction-timing';
import { isCompatibleMusicXmlPreparation } from '@same-page/player/preparation-format';
import { onNavigationReset, onDriveChange } from '../settings/navigation-events';
import type { PlaybackSource } from './playback-store';
const MAX_BYTES = 32 * 1024 * 1024, MAX_ITEMS = 4, TTL = 5 * 60_000;
type Entry = { bytes: Uint8Array; prepared?: PreparedMusicXml; expires: number; choirId: string; metadataBytes: number; cacheIdentity?: string };
const entries = new Map<string, Entry>();
const holders = new Map<string, { tokens: Set<object>; choirId: string }>();
let expiryTimer: ReturnType<typeof setTimeout> | undefined;
const keyFor = (source: PlaybackSource) => JSON.stringify([source.ownerKey, source.sessionId, source.choirId, source.score.id, source.attachment.id, source.attachment.revision]);
// This is a conservative serialized-data budget, not a claim about the JS heap.
const size = (entry: Entry) => entry.bytes.byteLength + (entry.prepared?.bytes.byteLength ?? 0) + entry.metadataBytes;
function prune() {
  for (const [key, entry] of entries) if (!holders.has(key) && entry.expires <= Date.now()) entries.delete(key);
  const idle = [...entries].filter(([key]) => !holders.has(key));
  let total = idle.reduce((sum, [, entry]) => sum + size(entry), 0);
  while (idle.length > MAX_ITEMS || total > MAX_BYTES) {
    const first = idle.shift();
    if (!first) break;
    total -= size(first[1]); entries.delete(first[0]);
  }
}
function scheduleExpiry() {
  clearTimeout(expiryTimer); expiryTimer = undefined;
  const expiries = [...entries].filter(([key]) => !holders.has(key)).map(([, entry]) => entry.expires);
  if (expiries.length) expiryTimer = setTimeout(() => { prune(); scheduleExpiry(); }, Math.max(1, Math.min(...expiries) - Date.now()));
}
export function clearPlaybackPreparation(source: PlaybackSource) { const key = keyFor(source); entries.delete(key); holders.delete(key); scheduleExpiry(); }
/** Reuse display preparation only after the caller has freshly verified access/revision. */
export function readPlaybackPreparation(source: PlaybackSource, cacheIdentity?: string) {
  prune(); const key = keyFor(source), entry = entries.get(key);
  if (entry && cacheIdentity !== undefined && cacheIdentity !== entry.cacheIdentity) { entries.delete(key); scheduleExpiry(); return undefined; }
  if (entry?.prepared && !isCompatibleMusicXmlPreparation(entry.prepared)) { entries.delete(key); scheduleExpiry(); return undefined; }
  if (entry) { entries.delete(key); entries.set(key, entry); }
  return entry;
}
export function savePlaybackPreparation(source: PlaybackSource, bytes: Uint8Array, prepared?: PreparedMusicXml, cacheIdentity?: string) {
  if (prepared && !isCompatibleMusicXmlPreparation(prepared)) return;
  const key = keyFor(source);
  const metadataBytes = prepared ? new TextEncoder().encode(JSON.stringify({ ...prepared, bytes: undefined })).byteLength : 0;
  entries.set(key, { bytes, prepared, expires: holders.has(key) ? Infinity : Date.now() + TTL, choirId: source.choirId, metadataBytes, cacheIdentity }); prune(); scheduleExpiry();
}
/** A lease keeps only immutable input alive; every opening still creates a new player. */
export function acquirePlaybackPreparation(source: PlaybackSource) {
  const key = keyFor(source), token = {};
  const holder = holders.get(key) ?? { tokens: new Set<object>(), choirId: source.choirId };
  const leases = holder.tokens;
  leases.add(token); holders.set(key, holder);
  const entry = entries.get(key); if (entry) entry.expires = Infinity;
  scheduleExpiry();
  const current = () => holders.get(key)?.tokens.has(token) === true;
  return {
    read: (cacheIdentity?: string) => current() ? readPlaybackPreparation(source, cacheIdentity) : undefined,
    save: (bytes: Uint8Array, prepared?: PreparedMusicXml, cacheIdentity?: string) => { if (current()) savePlaybackPreparation(source, bytes, prepared, cacheIdentity); },
    release() {
      if (!current()) return;
      leases.delete(token);
      if (!leases.size) {
        holders.delete(key);
        const retained = entries.get(key); if (retained) retained.expires = Date.now() + TTL;
      }
      prune(); scheduleExpiry();
    },
  };
}
export function clearPlaybackPreparations() { entries.clear(); holders.clear(); clearTimeout(expiryTimer); expiryTimer = undefined; }
onNavigationReset(clearPlaybackPreparations);
onDriveChange(impact => {
  if (impact.dropAuthority) {
    for (const [key, entry] of entries) if (entry.choirId === impact.driveId) { entries.delete(key); holders.delete(key); }
    // Pending leases may not yet have produced an entry.
    for (const [key, holder] of holders) if (holder.choirId === impact.driveId) holders.delete(key);
  }
  scheduleExpiry();
});
