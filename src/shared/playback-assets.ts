import { assetUrl } from "./asset-url";
export interface PlaybackAsset { url: string; bytes: number; integrity: string }
export interface PlaybackManifest { buildId: string; entries: PlaybackAsset[] }
export const playbackCachePrefix = 'same-page-playback-v1:';
export const playbackManifestUrl = (buildId: string) => assetUrl(`playback/${encodeURIComponent(buildId)}/manifest.json`);
export const playbackCacheName = (buildId: string) => playbackCachePrefix + encodeURIComponent(buildId);
// Old bundles keep their own release prefix, independent of the active worker.
// They remain read-only sources during the move to required shell resources.
export async function cachedPlaybackManifest(cache: { keys(): Promise<readonly Request[]>; match(request: Request): Promise<Response | undefined> }, buildId: string) {
  for (const request of await cache.keys()) {
    if (!new URL(request.url).pathname.endsWith(`/playback/${encodeURIComponent(buildId)}/manifest.json`)) continue;
    const response = await cache.match(request);
    if (response) return parsePlaybackManifest(await response.json(), buildId);
  }
  return undefined;
}
export function playbackAssetTypeValid(response: Response, url: string) {
  const type = response.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() ?? '';
  // ASSETS may omit the type for unknown binary extensions (notably .sf2).
  // These fetch/FontFace bytes are still sealed by SHA-256; executable and text
  // resources continue to require their explicit MIME type below.
  if (!type && /\.(?:sf2|woff2?|otf|eot)$/.test(url)) return true;
  if (/\.(?:m?js)$/.test(url)) return /^(?:application|text)\/(?:javascript|ecmascript)$/.test(type);
  if (url.endsWith('.css')) return type === 'text/css';
  if (url.endsWith('.json')) return type === 'application/json';
  if (url.endsWith('.svg')) return type === 'image/svg+xml';
  if (url.endsWith('.sf2')) return /^(?:audio\/(?:x-)?sf2|application\/octet-stream)$/.test(type);
  if (/\.(?:woff2?|otf|eot)$/.test(url)) return /^(?:font\/[-\w]+|application\/(?:octet-stream|(?:x-)?font[-\w]*|vnd\.ms-fontobject))$/.test(type);
  return /^(?:text\/(?:plain|markdown)|application\/octet-stream)$/.test(type);
}
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
  const assetPath = (url: string) => {
    const prefix = /^\/_releases\/([^/]+)\//.exec(url);
    if (prefix && prefix[1] !== buildId) return '';
    const path = prefix ? url.slice(prefix[0].length - 1) : url;
    if (path.startsWith('/playback/') && !path.startsWith(`/playback/${encodeURIComponent(buildId)}/`)) return '';
    return path;
  };
  if (manifest?.buildId !== buildId || !Array.isArray(manifest.entries) || !manifest.entries.length ||
    !manifest.entries.every(entry => typeof entry?.url === 'string' && /^\/(?:assets\/[^/?]+|playback\/[^/?]+\/(?:font|soundfont)\/[^/?]+)$/.test(assetPath(entry.url)) && Number.isSafeInteger(entry.bytes) && entry.bytes > 0 && /^sha256-[A-Za-z0-9+/]{43}=$/.test(entry.integrity))) throw new Error('invalid_playback_manifest');
  if (!manifest.entries.some(entry => entry.url.endsWith('/sonivox.sf2')) || !manifest.entries.some(entry => /musicxml-player-/.test(entry.url)) || !manifest.entries.some(entry => /prepare\.worker-/.test(entry.url))) throw new Error('incomplete_playback_manifest');
  return manifest;
}
