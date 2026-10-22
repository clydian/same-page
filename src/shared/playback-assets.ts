import { assetUrl } from "./asset-url";
export interface PlaybackAsset { url: string; bytes: number; integrity: string }
export interface PlaybackManifest { buildId: string; entries: PlaybackAsset[] }
export const playbackCachePrefix = 'same-page-playback-v1:';
export const playbackManifestUrl = (buildId: string) => assetUrl(`playback/${encodeURIComponent(buildId)}/manifest.json`);
export const playbackCacheName = (buildId: string) => playbackCachePrefix + encodeURIComponent(buildId);
export async function assetValid(response: Response | undefined, entry: PlaybackAsset) {
  if (response?.status !== 200 || response.redirected || /text\/html/i.test(response.headers.get('Content-Type') ?? '')) return false;
  const type = response.headers.get('Content-Type') ?? '';
  if (/\.(?:m?js)$/.test(entry.url) && !/(?:javascript|ecmascript)/i.test(type)) return false;
  if (/\.css$/.test(entry.url) && !/text\/css/i.test(type)) return false;
  const bytes = await response.clone().arrayBuffer();
  if (bytes.byteLength !== entry.bytes) return false;
  const hash = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))));
  return entry.integrity === `sha256-${hash}`;
}
export function parsePlaybackManifest(value: unknown, buildId: string): PlaybackManifest {
  const manifest = value as PlaybackManifest;
  const assetPath = (url: string) => url.replace(/^\/_releases\/[a-f0-9]{7,40}\//, "/");
  if (manifest?.buildId !== buildId || !Array.isArray(manifest.entries) || !manifest.entries.length ||
    !manifest.entries.every(entry => typeof entry.url === 'string' && /^\/(?:assets\/[^/?]+|playback\/[^/?]+\/(?:font|soundfont)\/[^/?]+)$/.test(assetPath(entry.url)) && Number.isSafeInteger(entry.bytes) && entry.bytes > 0 && /^sha256-[A-Za-z0-9+/]{43}=$/.test(entry.integrity))) throw new Error('invalid_playback_manifest');
  if (!manifest.entries.some(entry => entry.url.endsWith('/sonivox.sf2')) || !manifest.entries.some(entry => /musicxml-player-/.test(entry.url)) || !manifest.entries.some(entry => /prepare\.worker-/.test(entry.url))) throw new Error('incomplete_playback_manifest');
  return manifest;
}
