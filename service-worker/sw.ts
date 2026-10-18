import { isApiPath } from '../src/client/pwa-navigation';
import { ShellRuntime, type ManifestEntry } from './shell-runtime';
declare const __SAME_PAGE_BUILD_ID__: string;
const scope = self as unknown as ServiceWorkerGlobalScope & { __WB_MANIFEST: ManifestEntry[] };
const manifest = (self as unknown as { __WB_MANIFEST: ManifestEntry[] }).__WB_MANIFEST;
const runtime = new ShellRuntime(scope, manifest, __SAME_PAGE_BUILD_ID__);

scope.addEventListener('install', event => event.waitUntil(runtime.install()));
scope.addEventListener('activate', event => event.waitUntil(runtime.activate()));
scope.addEventListener('message', event => {
  const type = event.data?.type;
  if (type === 'SAME_PAGE_SHELL_IDENTITY') { event.waitUntil(runtime.identity.then(value => event.ports[0]?.postMessage(value))); return; }
  if (type === 'SAME_PAGE_COLLECT_SHELLS') { event.waitUntil(runtime.collect().then(() => runtime.identity).then(value => event.ports[0]?.postMessage(value))); return; }
  if (type !== 'SAME_PAGE_SAFE_UPDATE') return;
  if (event.data.requested !== true) { event.ports[0]?.postMessage({ safe: false }); return; }
  event.waitUntil((async () => {
    try {
      const signal = AbortSignal.timeout(8_000);
      await runtime.ready(signal);
      const clients = await scope.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const approvals = await Promise.all(clients.map(client => new Promise(resolve => {
        const channel = new MessageChannel();
        const timer = setTimeout(() => { channel.port1.close(); resolve(false); }, 1500);
        channel.port1.onmessage = reply => { clearTimeout(timer); channel.port1.close(); resolve(reply.data === true); };
        client.postMessage({ type: 'SAME_PAGE_UPDATE_PROBE', requested: true }, [channel.port2]);
      })));
      const current = await scope.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const safe = !signal.aborted && approvals.every(Boolean) && current.every(client => clients.some(previous => previous.id === client.id));
      event.ports[0]?.postMessage({ safe });
      if (safe) await scope.skipWaiting();
    } catch { event.ports[0]?.postMessage({ safe: false, reason: 'incomplete' }); }
  })());
});

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
  const staticAsset = /^\/(?:assets|pdfjs|font|soundfont)\//.test(url.pathname) || /\.(?:m?js|css|wasm|pdf|xml|musicxml|mxl|png|webp|ico|woff2?|json|webmanifest|tgz|txt|map)$/i.test(url.pathname) || manifest.some(entry => new URL(entry.url, scope.registration.scope).pathname === url.pathname && url.pathname !== new URL(scope.registration.scope).pathname);
  if (animations.test(url.pathname)) event.respondWith(animation(event.request));
  else if (staticAsset) event.respondWith(runtime.asset(event.request));
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
