import { ReleasePermission } from "./release-permission";
import { assetValid, parsePlaybackManifest, playbackManifestUrl } from '../src/shared/playback-assets';
import { isApiPath } from '../src/client/pwa-navigation';
import { ShellRuntime, type ManifestEntry } from './shell-runtime';
import { updateFailureReason } from '../src/shared/update-diagnostics';
declare const __SAME_PAGE_BUILD_ID__: string;
const scope = self as unknown as ServiceWorkerGlobalScope & { __WB_MANIFEST: ManifestEntry[] };
const manifest = (self as unknown as { __WB_MANIFEST: ManifestEntry[] }).__WB_MANIFEST;
declare const __SAME_PAGE_RELEASE_CHANNELS__: boolean;
const permission = new ReleasePermission(scope.location.origin, __SAME_PAGE_BUILD_ID__, typeof __SAME_PAGE_RELEASE_CHANNELS__ === "boolean" && __SAME_PAGE_RELEASE_CHANNELS__);
const runtime = new ShellRuntime(scope, manifest, __SAME_PAGE_BUILD_ID__, permission);

scope.addEventListener('install', event => event.waitUntil(runtime.install().catch(async error => {
  // A standalone support page can observe a failed candidate even while an old
  // application shell remains active. Never export raw exceptions or asset URLs.
  const notification = scope.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
    for (const client of clients) {
      try { client.postMessage({ type: 'SAME_PAGE_UPDATE_FAILURE', buildId: __SAME_PAGE_BUILD_ID__, reason: updateFailureReason(error) }); }
      catch { /* A closing window must not prevent another page's diagnosis. */ }
    }
  }).catch(() => undefined);
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([notification, new Promise<void>(resolve => { timer = setTimeout(resolve, 1000); })]);
  clearTimeout(timer);
  throw error;
})));
scope.addEventListener('activate', event => event.waitUntil(runtime.activate()));
scope.addEventListener('message', event => {
  const type = event.data?.type;
  if (type === 'SAME_PAGE_PLAYBACK_READY') { event.waitUntil(runtime.readyBuild(event.data.buildId, AbortSignal.timeout(15_000)).then(() => event.ports[0]?.postMessage({ buildId: event.data.buildId })).catch(() => event.ports[0]?.postMessage(null))); return; }
  if (type === 'SAME_PAGE_CHECK_SHELL') {
    if (typeof event.data.buildId !== 'string' || !/^(?:[a-f0-9]{7,40}|development)$/.test(event.data.buildId)) return;
    event.waitUntil((async () => {
      const own = await runtime.identity;
      event.ports[0]?.postMessage({ available: await runtime.availableBuild(event.data.buildId), activeBuild: own.buildId, activeReady: await runtime.availableBuild(own.buildId) });
      await runtime.collect();
    })().catch(() => event.ports[0]?.postMessage(null)));
    return;
  }
  if (type === 'SAME_PAGE_SHELL_IDENTITY') { event.waitUntil(runtime.identity.then(value => event.ports[0]?.postMessage(value))); return; }
  if (type === 'SAME_PAGE_COLLECT_SHELLS') { event.waitUntil(runtime.collect().then(async removed => event.ports[0]?.postMessage({ ...await runtime.identity, removed }))); return; }
  if (type !== 'SAME_PAGE_SAFE_UPDATE') return;
  if (event.data.requested !== true) { event.ports[0]?.postMessage({ safe: false }); return; }
  event.waitUntil((async () => {
    try {
      const signal = AbortSignal.timeout(8_000);
      await permission.confirm();
      await runtime.ready(signal);
      const clients = await scope.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const confirm = async () => {
        const approvals = await Promise.all(clients.map(client => new Promise(resolve => {
          const channel = new MessageChannel();
          const timer = setTimeout(() => { channel.port1.close(); resolve(false); }, 1500);
          channel.port1.onmessage = reply => { clearTimeout(timer); channel.port1.close(); resolve(reply.data === true); };
          client.postMessage({ type: 'SAME_PAGE_UPDATE_PROBE', requested: true, automatic: event.data.automatic === true }, [channel.port2]);
        })));
        const current = await scope.clients.matchAll({ type: 'window', includeUncontrolled: true });
        return !signal.aborted && approvals.every(Boolean) && current.every(client => clients.some(previous => previous.id === client.id));
      };
      // Reconfirm after every window answered: editing or a new window may have
      // appeared while another window was responding to the first round.
      const safe = await confirm() && await confirm();
      if (safe) { await permission.confirm(); await scope.skipWaiting(); }
      event.ports[0]?.postMessage({ safe });
    } catch { event.ports[0]?.postMessage({ safe: false, reason: 'incomplete' }); }
  })());
});

async function playbackAsset(request: Request) {
  for (const name of await caches.keys()) {
    if (!name.startsWith('same-page-playback-v1:')) continue;
    try {
      const build = decodeURIComponent(name.slice('same-page-playback-v1:'.length));
      const cache = await caches.open(name);
      const manifest = await cache.match(playbackManifestUrl(build));
      if (!manifest) continue;
      const assets = parsePlaybackManifest(await manifest.json(), build);
      const entry = assets.entries.find(entry => new URL(entry.url, scope.location.origin).href === request.url);
      if (entry) {
        // Font/worklet requests carry different Origin/Accept headers. These
        // verified public bytes have one representation per immutable URL.
        const cached = await cache.match(entry.url);
        if (await assetValid(cached, entry)) return cached!;
      }
    } catch { /* Unknown or incomplete bundles do not authorize a response. */ }
  }
  return runtime.asset(request);
}

const animations = /^\/assets\/(?:shared-layers|personal-layer|replace-pdf|offline-sync)-animation-[^/]+\.webp$/;
async function animation(request: Request) {
  const cache = await caches.open('same-page-home-animations');
  const cached = await cache.match(request);
  const stamp = Number(cached?.headers.get('x-same-page-cached-at')) || Date.parse(cached?.headers.get('Date') ?? '');
  if (cached && (!Number.isFinite(stamp) || Date.now() - stamp < 30 * 86400000)) return cached;
  const response = await fetch(request);
  if (response.status === 200 && /image\/webp/.test(response.headers.get('Content-Type') ?? '')) {
    const headers = new Headers(response.headers); headers.set('x-same-page-cached-at', String(Date.now()));
    await cache.put(request, new Response(await response.clone().arrayBuffer(), { headers }));
    const keys = await cache.keys();
    await Promise.all(keys.slice(0, Math.max(0, keys.length - 8)).map(key => cache.delete(key)));
  }
  return response;
}
scope.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== scope.location.origin || isApiPath(url.pathname)) return;
  const staticAsset = url.pathname.startsWith("/_releases/") || /^\/(?:assets|pdfjs|font|soundfont|playback)\//.test(url.pathname) || /\.(?:m?js|css|wasm|pdf|xml|musicxml|mxl|png|webp|ico|woff2?|json|webmanifest|tgz|txt|map)$/i.test(url.pathname) || manifest.some(entry => new URL(entry.url, scope.registration.scope).pathname === url.pathname && url.pathname !== new URL(scope.registration.scope).pathname);
  if (animations.test(url.pathname)) event.respondWith(animation(event.request));
  else if (staticAsset) event.respondWith(playbackAsset(event.request));
  else if (event.request.mode === 'navigate') {
    // Preserve the host's explicit index URL canonicalization, also offline.
    // This is a new redirect response, never a fetched redirected HTML body.
    if (url.pathname === new URL('index.html', scope.registration.scope).pathname) {
      const canonical = new URL(scope.registration.scope); canonical.search = url.search;
      event.respondWith(Promise.resolve(Response.redirect(canonical.href, 307)));
    } else {
      const response = runtime.navigation();
      event.respondWith(response);
      event.waitUntil(response.then(() => runtime.auditAfterNavigation()));
    }
  }

});
