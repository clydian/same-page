import { assetValid, parsePlaybackManifest, playbackCacheName, playbackManifestUrl } from '../../shared/playback-assets';
declare const __SAME_PAGE_BUILD_ID__: string;
const buildId = typeof __SAME_PAGE_BUILD_ID__ === 'string' ? __SAME_PAGE_BUILD_ID__ : 'development';
let preparing: Promise<void> | undefined;
async function manifest() {
  const response = await fetch(playbackManifestUrl(buildId), { cache: 'no-cache', redirect: 'error', signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error('playback_manifest_unavailable');
  return parsePlaybackManifest(await response.json(), buildId);
}
async function shellReady() {
  const registration = await navigator.serviceWorker?.getRegistration();
  if (!registration?.active) return false;
  return new Promise<boolean>(resolve => {
    const channel = new MessageChannel();
    const timeout = setTimeout(() => { channel.port1.close(); resolve(false); }, 20_000);
    channel.port1.onmessage = event => { clearTimeout(timeout); channel.port1.close(); resolve(event.data?.buildId === buildId); };
    registration.active!.postMessage({ type: 'SAME_PAGE_PLAYBACK_READY', buildId }, [channel.port2]);
  });
}
export async function offlinePlayerAssetsReady() {
  try {
    if (!await shellReady()) return false;
    const assets = await manifest();
    const cache = await caches.open(playbackCacheName(buildId));
    const savedManifest = await cache.match(playbackManifestUrl(buildId));
    if (!savedManifest || await savedManifest.text() !== JSON.stringify(assets)) return false;
    for (const entry of assets.entries) if (!await assetValid(await cache.match(entry.url), entry)) return false;
    return true;
  } catch { return false; }
}
export function prepareOfflinePlayerAssets() {
  preparing ??= (async () => {
    const signal = AbortSignal.timeout(180_000);
    const assets = await manifest();
    const cache = await caches.open(playbackCacheName(buildId));
    await cache.put(playbackManifestUrl(buildId), Response.json(assets));
    // Incremental verified writes permit a retry after interruption. There is no
    // readiness marker: every readiness claim audits the entire matching bundle.
    for (const entry of assets.entries) {
      if (await assetValid(await cache.match(entry.url), entry)) continue;
      const response = await fetch(entry.url, { cache: 'reload', redirect: 'error', integrity: entry.integrity, signal });
      if (!await assetValid(response, entry)) throw new Error('playback_asset_integrity');
      const headers = new Headers(response.headers);
      headers.delete('content-encoding'); headers.delete('content-length'); headers.delete('vary');
      await cache.put(entry.url, new Response(await response.arrayBuffer(), { headers }));
    }
    if (!await offlinePlayerAssetsReady()) throw new Error('playback_assets_incomplete');
  })().finally(() => { preparing = undefined; });
  return preparing;
}
