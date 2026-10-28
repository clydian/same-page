import { readPublicAsset } from "../connection/connection";
import { assetValid, parsePlaybackManifest, playbackCacheName, playbackCachePrefix, playbackManifestUrl, type PlaybackAsset, type PlaybackManifest } from '../../shared/playback-assets';
declare const __SAME_PAGE_BUILD_ID__: string;
const buildId = typeof __SAME_PAGE_BUILD_ID__ === 'string' ? __SAME_PAGE_BUILD_ID__ : 'development';
type Preparation = { controller: AbortController; promise: Promise<void>; consumers: Set<symbol> };
let preparing: Preparation | undefined;
async function manifest(signal?: AbortSignal) {
  const response = await readPublicAsset(playbackManifestUrl(buildId), async response => {
    parsePlaybackManifest(await response.clone().json(), buildId);
    return true;
  }, signal, 'manifest');
  if (!response.ok) throw new Error('playback_manifest_unavailable');
  return parsePlaybackManifest(await response.json(), buildId);
}
async function shellReady(signal?: AbortSignal) {
  signal?.throwIfAborted();
  const registration = await navigator.serviceWorker?.getRegistration();
  signal?.throwIfAborted();
  if (!registration?.active) return false;
  return new Promise<boolean>(resolve => {
    const channel = new MessageChannel();
    const finish = (ready: boolean) => { clearTimeout(timeout); signal?.removeEventListener('abort', aborted); channel.port1.close(); resolve(ready); };
    const aborted = () => finish(false);
    const timeout = setTimeout(() => finish(false), 20_000);
    channel.port1.onmessage = event => finish(event.data?.buildId === buildId);
    signal?.addEventListener('abort', aborted, { once: true });
    if (signal?.aborted) { aborted(); return; }
    registration.active!.postMessage({ type: 'SAME_PAGE_PLAYBACK_READY', buildId }, [channel.port2]);
  });
}
async function bundlePresent(cache: Cache, assets: PlaybackManifest) {
  const saved = await cache.match(playbackManifestUrl(buildId));
  if (!saved || await saved.text() !== JSON.stringify(assets)) return false;
  for (const entry of assets.entries) if (!await cache.match(entry.url)) return false;
  return true;
}
export async function offlinePlayerAssetsReady() {
  try {
    if (!await shellReady()) return false;
    const assets = await manifest();
    const cache = await caches.open(playbackCacheName(buildId));
    if (!await bundlePresent(cache, assets)) return false;
    for (const entry of assets.entries) if (!await assetValid(await cache.match(entry.url), entry)) return false;
    return true;
  } catch { return false; }
}
// Public bytes may be reused across releases, but the destination still belongs
// to its own build and is retired by the existing shell collector.
async function previousBundles(signal: AbortSignal) {
  const bundles: { cache: Cache; manifest: PlaybackManifest }[] = [];
  for (const name of await caches.keys()) {
    signal.throwIfAborted();
    if (!name.startsWith(playbackCachePrefix) || name === playbackCacheName(buildId)) continue;
    try {
      const previousBuild = decodeURIComponent(name.slice(playbackCachePrefix.length));
      const cache = await caches.open(name);
      // Older releases can have a different asset base. Find their saved
      // manifest rather than deriving its URL from the current release base.
      for (const request of await cache.keys()) {
        if (!new URL(request.url).pathname.endsWith(`/playback/${encodeURIComponent(previousBuild)}/manifest.json`)) continue;
        const response = await cache.match(request);
        if (response) bundles.push({ cache, manifest: parsePlaybackManifest(await response.json(), previousBuild) });
      }
    } catch { /* An unknown or incomplete old public bundle is only a miss. */ }
  }
  return bundles;
}
function reusableType(response: Response, entry: PlaybackAsset) {
  const type = response.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() ?? '';
  if (/\.(?:m?js)$/.test(entry.url)) return /^(?:application|text)\/(?:javascript|ecmascript)$/.test(type);
  if (entry.url.endsWith('.css')) return type === 'text/css';
  if (entry.url.endsWith('.json')) return type === 'application/json';
  if (entry.url.endsWith('.svg')) return type === 'image/svg+xml';
  if (entry.url.endsWith('.sf2')) return /^(?:audio\/(?:x-)?sf2|application\/octet-stream)$/.test(type);
  if (/\.(?:woff2?|otf|eot)$/.test(entry.url)) return /^(?:font\/[-\w]+|application\/(?:octet-stream|(?:x-)?font[-\w]*|vnd\.ms-fontobject))$/.test(type);
  return /^(?:text\/(?:plain|markdown)|application\/octet-stream)$/.test(type);
}
async function reuseAsset(bundles: Awaited<ReturnType<typeof previousBundles>>, target: PlaybackAsset, signal: AbortSignal) {
  for (const bundle of bundles) for (const candidate of bundle.manifest.entries) {
    signal.throwIfAborted();
    if (candidate.bytes !== target.bytes || candidate.integrity !== target.integrity) continue;
    try {
      const response = await bundle.cache.match(candidate.url);
      if (response && reusableType(response, target) && await assetValid(response, target)) return response;
    } catch {
      // An old entry may disappear or its body may fail to read. Its manifest
      // is only a reuse hint; broken old storage must not prevent downloading.
      signal.throwIfAborted();
    }
  }
  return undefined;
}
async function prepare(signal: AbortSignal) {
  const assets = await manifest(signal);
  const cache = await caches.open(playbackCacheName(buildId));
  signal.throwIfAborted();
  await cache.put(playbackManifestUrl(buildId), Response.json(assets));
  let previous: Awaited<ReturnType<typeof previousBundles>> | undefined;
  for (const entry of assets.entries) {
    signal.throwIfAborted();
    let valid = false;
    try { valid = await assetValid(await cache.match(entry.url), entry); }
    catch { signal.throwIfAborted(); /* An unreadable current entry is repairable too. */ }
    if (valid) continue;
    previous ??= await previousBundles(signal);
    let response = await reuseAsset(previous, entry, signal);
    if (!response) {
      response = await readPublicAsset(entry.url, response => assetValid(response, entry), signal);
      if (!await assetValid(response, entry)) throw new Error('playback_asset_integrity');
    }
    const bytes = await response.arrayBuffer();
    signal.throwIfAborted();
    const headers = new Headers(response.headers);
    headers.delete('content-encoding'); headers.delete('content-length'); headers.delete('vary');
    await cache.put(entry.url, new Response(bytes, { headers }));
  }
  // This task has just checked every captured response. Check presence after
  // incremental writes, without immediately hashing the entire bundle again.
  // A later readiness query always audits fresh cache responses independently.
  if (!await shellReady(signal) || !await bundlePresent(cache, assets)) throw new Error('playback_assets_incomplete');
  signal.throwIfAborted();
}
export function prepareOfflinePlayerAssets(signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason);
  if (!preparing) {
    const controller = new AbortController();
    const task: Preparation = { controller, consumers: new Set(), promise: Promise.resolve() };
    task.promise = prepare(AbortSignal.any([controller.signal, AbortSignal.timeout(180_000)])).finally(() => { if (preparing === task) preparing = undefined; });
    preparing = task;
  }
  const task = preparing, consumer = Symbol();
  task.consumers.add(consumer);
  if (!signal) {
    void task.promise.then(() => task.consumers.delete(consumer), () => task.consumers.delete(consumer));
    return task.promise;
  }
  return new Promise<void>((resolve, reject) => {
    let finished = false;
    const finish = (failed: boolean, error?: unknown) => {
      if (finished) return;
      finished = true; signal.removeEventListener('abort', aborted); task.consumers.delete(consumer);
      if (signal.aborted) reject(signal.reason); else if (failed) reject(error); else resolve();
    };
    const aborted = () => {
      finish(true, signal.reason);
      if (!task.consumers.size) { if (preparing === task) preparing = undefined; task.controller.abort(signal.reason); }
    };
    signal.addEventListener('abort', aborted, { once: true });
    void task.promise.then(() => finish(false), error => finish(true, error));
    if (signal.aborted) aborted();
  });
}
