import type { PreparedMusicXml } from '@clydian/chorus-player/musicxml-direction-timing';
import { onNavigationReset, onDriveChange } from '../settings/navigation-events';
import type { PlaybackSource } from './playback-store';
const MAX_BYTES = 32 * 1024 * 1024, MAX_ITEMS = 4, TTL = 5 * 60_000;
type Entry = { bytes: Uint8Array; prepared?: PreparedMusicXml; expires: number; choirId: string };
const entries = new Map<string, Entry>();
const keyFor = (source: PlaybackSource) => JSON.stringify([source.ownerKey, source.sessionId, source.choirId, source.score.id, source.attachment.id, source.attachment.revision]);
const size = (entry: Entry) => entry.bytes.byteLength + (entry.prepared?.bytes.byteLength ?? 0);
function prune() {
  for (const [key, entry] of entries) if (entry.expires <= Date.now()) entries.delete(key);
  let total = [...entries.values()].reduce((sum, entry) => sum + size(entry), 0);
  while (entries.size > MAX_ITEMS || total > MAX_BYTES) {
    const first = entries.entries().next().value;
    if (!first) break;
    total -= size(first[1]); entries.delete(first[0]);
  }
}
/** Reuse display preparation only after the caller has freshly verified access/revision. */
export function readPlaybackPreparation(source: PlaybackSource) {
  prune(); const key = keyFor(source), entry = entries.get(key);
  if (entry) { entries.delete(key); entries.set(key, entry); }
  return entry;
}
export function savePlaybackPreparation(source: PlaybackSource, bytes: Uint8Array, prepared?: PreparedMusicXml) {
  const key = keyFor(source);
  entries.set(key, { bytes, prepared, expires: Date.now() + TTL, choirId: source.choirId }); prune();
}
export function clearPlaybackPreparations() { entries.clear(); }
onNavigationReset(clearPlaybackPreparations);
onDriveChange(impact => { if (impact.dropAuthority) for (const [key, entry] of entries) if (entry.choirId === impact.driveId) entries.delete(key); });
