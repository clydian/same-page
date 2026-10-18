import { beforeEach, expect, it, vi } from 'vitest';
import { ShellRuntime, digest, shellBudget } from '../service-worker/shell-runtime.ts';

const origin = 'https://shell.example/';
class MemoryCache {
  data = new Map();
  async match(key, options = {}) {
    const url = typeof key === 'string' ? key : key.url;
    const found = [...this.data].find(([k]) => options.ignoreSearch ? k.split('?')[0] === url.split('?')[0] : k === url);
    return found?.[1].clone();
  }
  async put(key, response) { this.data.set(typeof key === 'string' ? key : key.url, response.clone()); }
  async delete(key) { return this.data.delete(typeof key === 'string' ? key : key.url); }
  async keys() { return [...this.data.keys()].map(url => new Request(url)); }
}
let stores, scope, server;
const target = get => ({ postMessage: (_message, ports) => { Promise.resolve(get()).then(value => ports[0].postMessage(value)); } });
beforeEach(() => {
  stores = new Map(); server = new Map();
  vi.stubGlobal('caches', {
    open: async name => { if (!stores.has(name)) stores.set(name, new MemoryCache()); return stores.get(name); },
    match: async (key, options) => stores.get(options.cacheName)?.match(key, options),
    keys: async () => [...stores.keys()], delete: async name => stores.delete(name),
  });
  let tail = Promise.resolve();
  scope = { navigator: { locks: { request: (_name, action) => { const next = tail.then(action); tail = next.catch(() => undefined); return next; } } }, location: { origin: origin.slice(0, -1) }, registration: { scope: origin, active: null, waiting: null, installing: null }, clients: { matchAll: async () => [] } };
  vi.stubGlobal('fetch', vi.fn(async request => { const body = server.get(request.url); if (body === undefined) throw new TypeError('offline'); return new Response(body, { headers: { 'Content-Type': request.url.endsWith('.js') ? 'text/javascript' : 'text/html' } }); }));
});
async function release(id, bytes = 32) {
  const html = `<meta name="same-page-build-id" content="${id}">`;
  const script = `/* ${id} */`;
  const entries = await Promise.all([['/', html], [`/assets/main-${id}.js`, script]].map(async ([url, text]) => ({ url, revision: id, bytes, integrity: `sha256-${await digest(new TextEncoder().encode(text))}` })));
  server.set(origin, html); server.set(origin + `assets/main-${id}.js`, script);
  const runtime = new ShellRuntime(scope, entries, id); await runtime.install();
  return runtime;
}
async function complete(runtime) {
  const id = await runtime.identity;
  const record = (await runtime.records()).find(r => r.cacheName === id.cacheName);
  const cache = await caches.open(id.cacheName);
  return (await Promise.all(record.entries.map(entry => cache.match(entry.url)))).every(Boolean);
}
it('isolates overlapping installers from both legacy revision pruning and legacy namespace cleanup', async () => {
  const b = await release('B'), c = await release('C');
  const legacyName = 'workbox-precache-v2-' + origin;
  await caches.open(legacyName);
  for (const name of await caches.keys()) if (name.includes('-precache-') && name.includes(origin) && name !== legacyName) await caches.delete(name);
  expect(await complete(b)).toBe(true); expect(await complete(c)).toBe(true);
  expect((await c.identity).cacheName).not.toContain('-precache-');
  expect((await c.identity).cacheName).not.toContain(origin);
});
it('rejects a changed deployment rather than storing its HTML under an old manifest', async () => {
  const b = await release('B'), c = await release('C');
  await (await caches.open((await c.identity).cacheName)).delete(origin);
  server.set(origin, '<html>unverified D</html>');
  expect(await (await c.navigation()).text()).toContain('content="B"');
  expect(await (await caches.open((await c.identity).cacheName)).match(origin)).toBeUndefined();
  expect(await complete(b)).toBe(true);
});
it('repairs missing bytes with the exact integrity or renders a retry page, never a redirect/error response', async () => {
  const c = await release('C'); const cache = await caches.open((await c.identity).cacheName);
  await cache.delete(origin);
  expect((await c.navigation()).status).toBe(200); expect(await complete(c)).toBe(true);
  await cache.delete(origin); server.clear();
  const failure = await c.navigation();
  expect(failure.status).toBe(503); expect(failure.redirected).toBe(false); expect(await failure.text()).toContain('重试');
});
it('retains legacy hash assets for an old document after a controller switch', async () => {
  const c = await release('C'); const old = await caches.open('workbox-precache-v2-' + origin);
  await old.put(origin + 'assets/old-12345678.js', new Response('old module', { headers: { 'Content-Type': 'text/javascript' } }));
  expect(await (await c.asset(new Request(origin + 'assets/old-12345678.js'))).text()).toBe('old module');
});
it('collects only unreferenced owned releases, preserving worker roles, displayed versions and one rollback', async () => {
  const a = await release('A'), b = await release('B'), c = await release('C'), d = await release('D');
  scope.registration.active = target(() => d.identity); scope.registration.waiting = target(() => c.identity);
  scope.clients.matchAll = async () => [{ id: 'old', ...target(() => b.identity) }];
  await d.collect(); expect(await complete(a)).toBe(true); expect(await complete(b)).toBe(true);
  scope.registration.waiting = null; scope.clients.matchAll = async () => [];
  await d.collect();
  expect(stores.has((await d.identity).cacheName)).toBe(true);
  // Created in order; C is the newest rollback. A/B are retired.
  expect(stores.has((await c.identity).cacheName)).toBe(true);
  expect(stores.has((await a.identity).cacheName)).toBe(false); expect(stores.has((await b.identity).cacheName)).toBe(false);
});
it('unknown/suspended clients and legacy workers veto shell collection', async () => {
  const a = await release('A'), b = await release('B'), c = await release('C');
  scope.registration.active = target(() => c.identity);
  scope.clients.matchAll = async () => [{ id: 'legacy', ...target(() => null) }];
  await c.collect(); expect(stores.has((await a.identity).cacheName)).toBe(true);
  scope.clients.matchAll = async () => []; scope.registration.active = target(() => null);
  await c.collect(); expect(stores.has((await b.identity).cacheName)).toBe(true);
});
it('caps protected shell storage without evicting the active release', async () => {
  const allocated = [];
  for (let i = 0; i < 4; i++) allocated.push(await release(String(i), shellBudget / 8));
  scope.registration.active = target(() => null); // Legacy active worker cannot authorize collection.
  await expect(release('overflow', shellBudget / 8)).rejects.toThrow('shell_capacity_protected');
  expect(await complete(allocated[0])).toBe(true);
});
it('a quota failure cleans only the new candidate and preserves the usable release', async () => {
  const old = await release('old');
  const put = MemoryCache.prototype.put;
  vi.spyOn(MemoryCache.prototype, 'put').mockImplementation(async function(key, response) {
    if (String(key).includes('main-new.js')) throw new DOMException('quota', 'QuotaExceededError');
    return put.call(this, key, response);
  });
  await expect(release('new')).rejects.toThrow('quota'); expect(await complete(old)).toBe(true);
  expect((await old.records()).map(r => r.buildId)).toEqual(['old']);
  vi.restoreAllMocks();
});

it('keeps recently activated history releases even when they are absent from live clients', async () => {
  const a = await release('A'), b = await release('B'), c = await release('C');
  const record = (await a.records()).find(r => r.buildId === 'A'); record.activated = Date.now();
  const registry = await caches.open(a.registryName);
  const key = (await registry.keys()).find(k => k.url.includes(encodeURIComponent(record.cacheName)));
  await registry.put(key, Response.json(record));
  scope.registration.active = target(() => c.identity);
  await c.collect();
  expect(stores.has((await a.identity).cacheName)).toBe(true);
  expect(stores.has((await b.identity).cacheName)).toBe(true);
});

it('serializes retiring a cache with an installer reusing the same immutable release', async () => {
  const a = await release('A'); await release('B'); await release('C'); const d = await release('D');
  scope.registration.active = target(() => d.identity);
  let entered, resume;
  const started = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { resume = resolve; });
  const remove = caches.delete;
  vi.spyOn(caches, 'delete').mockImplementation(async name => {
    if (name === (await a.identity).cacheName) { entered(); await gate; }
    return remove(name);
  });
  const collection = d.collect(); await started;
  const installing = release('A'); resume();
  await collection; const restored = await installing;
  expect(await complete(restored)).toBe(true); expect(await complete(d)).toBe(true);
  vi.restoreAllMocks();
});
it('defers collection without Web Locks instead of risking protected data', async () => {
  const a = await release('A'); await release('B'); const c = await release('C');
  scope.registration.active = target(() => c.identity); scope.navigator = {};
  await c.collect(); expect(await complete(a)).toBe(true);
});

it('returns a retry document when CacheStorage becomes unavailable during worker startup', async () => {
  const a = await release('A'); const entries = (await a.records())[0].entries;
  vi.spyOn(caches, 'open').mockRejectedValue(new DOMException('unavailable', 'SecurityError'));
  const restarting = new ShellRuntime(scope, entries, 'A');
  expect((await restarting.navigation()).status).toBe(503);
  expect((await restarting.asset(new Request(origin + 'assets/main-A.js'))).status).toBe(200);
  vi.restoreAllMocks();
});

it('repairs a canonical shell with an incorrect MIME type even if its bytes match', async () => {
  const c = await release('C'); const cache = await caches.open((await c.identity).cacheName);
  const body = await (await cache.match(origin)).text();
  await cache.put(origin, new Response(body, { headers: { 'Content-Type': 'application/octet-stream' } }));
  expect((await c.navigation()).headers.get('Content-Type')).toMatch(/text\/html/);
});

it('reuses legacy bytes only after matching the new integrity, without retaining a shared cache handle', async () => {
  const legacy = await caches.open('workbox-precache-v2-' + origin);
  await legacy.put(origin + 'assets/main-C.js', new Response('/* C */', { headers: { 'Content-Type': 'text/javascript' } }));
  const c = await release('C');
  expect(fetch.mock.calls.map(([request]) => request.url)).not.toContain(origin + 'assets/main-C.js');
  await caches.delete('workbox-precache-v2-' + origin);
  expect(await complete(c)).toBe(true);
});
