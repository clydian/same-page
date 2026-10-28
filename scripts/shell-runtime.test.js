import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ShellRuntime, digest, shellReleaseLimit } from '../service-worker/shell-runtime.ts';

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
  // Tiny in-memory releases can share a real millisecond. Give fixtures an
  // explicit creation order so rollback selection does not depend on host load.
  let now = Date.now();
  vi.spyOn(Date, 'now').mockImplementation(() => ++now);
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
afterEach(() => { vi.restoreAllMocks(); });

it('finishes the worker install even when advisory progress delivery never settles', async () => {
  const seed = await release('abc1234');
  const record = (await seed.records())[0];
  const listeners = new Map();
  scope.__WB_MANIFEST = record.entries;
  scope.addEventListener = (type, listener) => listeners.set(type, listener);
  scope.clients.matchAll = () => new Promise(() => {});
  vi.stubGlobal('self', scope);
  vi.stubGlobal('__SAME_PAGE_BUILD_ID__', 'abc1234');
  vi.stubGlobal('__SAME_PAGE_RELEASE_CHANNELS__', false);
  vi.useFakeTimers();
  try {
    vi.resetModules();
    await import('../service-worker/sw.ts');
    let installation, completed = false;
    listeners.get('install')({ waitUntil: promise => { installation = promise.then(() => { completed = true; }); } });
    await vi.waitFor(() => {
      let progress;
      listeners.get('message')({ data: {type:'SAME_PAGE_INSTALL_PROGRESS'}, ports:[{postMessage:value=>{progress=value;}}] });
      expect(progress?.stage).toBe('ready');
    });
    expect(completed).toBe(false);
    await vi.advanceTimersByTimeAsync(1000);
    await installation;
    expect(completed).toBe(true);
    expect(await complete(seed)).toBe(true);
  } finally {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});
async function release(id, bytes = 32, scriptCount = 1) {
  const html = `<meta name="same-page-build-id" content="${id}">`;
  const files = [['/', html], ...Array.from({ length: scriptCount }, (_, index) => [`/assets/main-${id}${index ? '-' + index : ''}.js`, `/* ${id}${index ? '-' + index : ''} */`])];
  const entries = await Promise.all(files.map(async ([url, text]) => ({ url, revision: id, bytes, integrity: `sha256-${await digest(new TextEncoder().encode(text))}` })));
  for (const [url, text] of files) server.set(new URL(url, origin).href, text);
  const runtime = new ShellRuntime(scope, entries, id); await runtime.install();
  return runtime;
}
async function complete(runtime) {
  const id = await runtime.identity;
  const record = (await runtime.records()).find(r => r.cacheName === id.cacheName);
  const cache = await caches.open(id.cacheName);
  return (await Promise.all(record.entries.map(entry => cache.match(entry.url)))).every(Boolean);
}
async function presented(...runtimes) {
  for (const runtime of runtimes) {
    const own = await runtime.identity;
    const saved = (await runtime.records()).find(r => r.cacheName === own.cacheName);
    saved.activated = Date.now();
    saved.candidateOnly = false;
    const registry = await caches.open(runtime.registryName);
    const key = new URL('__same_page_shell__/' + encodeURIComponent(saved.cacheName), origin).href;
    await registry.delete(new URL('__same_page_candidate__/' + encodeURIComponent(saved.cacheName), origin).href);
    await registry.put(key, Response.json(saved));
  }
}
it('directly installs the latest release beside the four shells in the Android report', async () => {
  const retained = [];
  for (const [index, bytes] of [6601844, 6603293, 6607650, 6622743].entries()) {
    retained.push(await release(`phone-${index}`, bytes / 2));
  }
  scope.registration.active = target(() => null);
  const latest = await release('latest', 6764296 / 2);
  expect(await complete(latest)).toBe(true);
  for (const runtime of retained) expect(await complete(runtime)).toBe(true);
});
it('isolates overlapping installers from both legacy revision pruning and legacy namespace cleanup', async () => {
  const b = await release('B'), c = await release('C');
  const legacyName = 'workbox-precache-v2-' + origin;
  await caches.open(legacyName);
  for (const name of await caches.keys()) {
    const scopeUrl = name.match(/^workbox-precache-v\d+-(https?:\/\/.*)$/)?.[1];
    if (!scopeUrl || name === legacyName) continue;
    try { if (new URL(scopeUrl).href === origin) await caches.delete(name); }
    catch { /* A malformed cache name never authorizes deletion. */ }
  }
  expect(await complete(b)).toBe(true); expect(await complete(c)).toBe(true);
  expect((await c.identity).cacheName).not.toContain('-precache-');
  expect((await c.identity).cacheName).not.toContain(origin);
});
it('rejects a changed deployment rather than storing its HTML under an old manifest', async () => {
  const b = await release('B'), c = await release('C');
  await presented(b);
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
  await presented(a, b, c, d);
  scope.registration.active = target(() => d.identity); scope.registration.waiting = target(() => c.identity);
  scope.clients.matchAll = async () => [{ id: 'old', ...target(() => b.identity) }];
  await d.collect(); expect(stores.has((await a.identity).cacheName)).toBe(false); expect(await complete(b)).toBe(true);
  scope.registration.waiting = null; scope.clients.matchAll = async () => [];
  await d.collect();
  expect(stores.has((await d.identity).cacheName)).toBe(true);
  // Created in order; C is the newest rollback. A/B are retired.
  expect(stores.has((await c.identity).cacheName)).toBe(true);
  expect(stores.has((await a.identity).cacheName)).toBe(false); expect(stores.has((await b.identity).cacheName)).toBe(false);
});
it('unknown/suspended clients and legacy workers veto shell collection', async () => {
  const a = await release('A'), b = await release('B'), c = await release('C');
  await presented(a, b);
  scope.registration.active = target(() => c.identity);
  scope.clients.matchAll = async () => [{ id: 'legacy', ...target(() => null) }];
  await c.collect(); expect(stores.has((await a.identity).cacheName)).toBe(true);
  scope.clients.matchAll = async () => []; scope.registration.active = target(() => null);
  await c.collect(); expect(stores.has((await b.identity).cacheName)).toBe(true);
});
it('rejects an oversized individual release before fetching or evicting the active shell', async () => {
  const old = await release('old');
  const calls = fetch.mock.calls.length;
  await expect(release('oversized', shellReleaseLimit / 2 + 1)).rejects.toThrow('shell_release_too_large');
  expect(fetch.mock.calls.length).toBe(calls);
  expect(await complete(old)).toBe(true);
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
it.each([0, 1])('retries quota writes only after owner collection reports actual removal (%i)', async removed => {
  const old = await release('active');
  let collection = 0;
  scope.registration.active = { postMessage: (_message, ports) => {
    collection++;
    ports[0].postMessage({ buildId: 'active', cacheName: 'active', removed: collection > 1 ? removed : 0 });
  } };
  const put = MemoryCache.prototype.put;
  let writes = 0;
  vi.spyOn(MemoryCache.prototype, 'put').mockImplementation(async function(key, response) {
    if (String(key).includes('main-retry.js') && ++writes === 1) throw new DOMException('quota', 'QuotaExceededError');
    return put.call(this, key, response);
  });
  if (removed) expect(await complete(await release('retry'))).toBe(true);
  else await expect(release('retry')).rejects.toThrow('quota');
  expect(writes).toBe(removed ? 2 : 1);
  expect(await complete(old)).toBe(true);
});

it('keeps a steady current and one rollback across twenty same-day activations', async () => {
  for (let i = 0; i < 20; i++) {
    const runtime = await release(`day-${i}`);
    scope.registration.active = target(() => runtime.identity);
    await runtime.activate();
    const records = await runtime.records();
    expect(records.map(r => r.buildId)).toEqual(i ? [`day-${i - 1}`, `day-${i}`] : ['day-0']);
    expect(await complete(runtime)).toBe(true);
  }
});
it('reclaims twenty superseded candidates despite an unknown window, retaining displayed history', async () => {
  const history = await release('history'); await presented(history);
  const active = await release('active'); await presented(active);
  scope.registration.active = target(() => active.identity);
  scope.clients.matchAll = async () => [{ id: 'frozen', ...target(() => null) }];
  for (let i = 0; i < 20; i++) {
    const candidate = await release(`waiting-${i}`);
    scope.registration.waiting = target(() => candidate.identity);
    await active.collect();
    expect((await active.records()).map(r => r.buildId)).toEqual(['history', 'active', `waiting-${i}`]);
    expect(await complete(active)).toBe(true);
  }
});
it('never displays an abandoned candidate as a navigation fallback', async () => {
  const current = await release('current');
  await release('never-displayed');
  await (await caches.open((await current.identity).cacheName)).delete(origin);
  server.clear();
  expect((await current.navigation()).status).toBe(503);
});
it('preserves the fixed v1 legacy collection while retiring new history', async () => {
  const old = await release('legacy');
  const own = await old.identity;
  const record = (await old.records())[0];
  const legacyName = own.cacheName.replace('same-page-shell-v2:', 'same-page-shell-v1:');
  const source = await caches.open(own.cacheName), dest = await caches.open(legacyName);
  for (const key of await source.keys()) await dest.put(key, await source.match(key));
  const registry = await caches.open(old.registryName);
  const key = new URL('__same_page_shell__/' + encodeURIComponent(own.cacheName), origin).href; await registry.delete(key);
  await registry.delete(new URL('__same_page_candidate__/' + encodeURIComponent(own.cacheName), origin).href);
  record.cacheName = legacyName;
  await registry.put(new URL('__same_page_shell__/' + encodeURIComponent(legacyName), origin).href, Response.json(record));
  await caches.delete(own.cacheName);
  for (let i = 0; i < 20; i++) {
    const runtime = await release(`new-${i}`);
    scope.registration.active = target(() => runtime.identity);
    await runtime.activate();
    expect(stores.has(legacyName)).toBe(true);
    expect((await runtime.records()).length).toBeLessThanOrEqual(3);
  }
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

it('serves a fully verified installed shell when quota prevents refreshing its registry', async () => {
  const c = await release('C');
  scope.registration.active = target(() => c.identity);
  await c.activate();
  const registry = await caches.open(c.registryName);
  vi.spyOn(registry, 'put').mockRejectedValue(new DOMException('quota', 'QuotaExceededError'));
  server.clear();
  await c.auditAfterNavigation();
  expect(registry.put).toHaveBeenCalled();
  const response = await c.navigation();
  expect(response.status).toBe(200);
  expect(await response.text()).toContain('content="C"');
  vi.restoreAllMocks();
});

it('does not mistake a displayed shell for an abandoned candidate when activation metadata cannot be written', async () => {
  const old = await release('old');
  scope.registration.active = target(() => old.identity);
  const registry = await caches.open(old.registryName);
  const put = vi.spyOn(registry, 'put').mockRejectedValue(new DOMException('quota', 'QuotaExceededError'));
  await old.activate(); // Candidate seal removal still works at quota.
  expect(await (await old.navigation()).text()).toContain('content="old"');
  put.mockRestore();
  const current = await release('current'); await presented(current);
  scope.registration.active = target(() => current.identity);
  scope.clients.matchAll = async () => [{ id: 'suspended-old', ...target(() => null) }];
  await current.collect();
  expect(await complete(old)).toBe(true);
});

it('always returns a Response when eviction races the final navigation read', async () => {
  const c = await release('C'); const cache = await caches.open((await c.identity).cacheName);
  await cache.delete(origin + 'assets/main-C.js'); // Require the repair path.
  const ready = c.ready.bind(c);
  vi.spyOn(c, 'ready').mockImplementation(async () => {
    await ready(); await cache.delete(origin); // Eviction immediately after audit.
  });
  const response = await c.navigation();
  expect(response).toBeInstanceOf(Response);
  expect(response.status).toBe(503);
  vi.restoreAllMocks();
});

it('overlaps bounded installation requests instead of paying an RTT for each resource', async () => {
  const original = fetch.getMockImplementation();
  let inFlight = 0, peak = 0;
  fetch.mockImplementation(async request => {
    peak = Math.max(peak, ++inFlight);
    await new Promise(resolve => setTimeout(resolve, 20));
    const response = await original(request); inFlight--; return response;
  });
  await release('parallel', 32, 12);
  expect(peak).toBe(4);
});

it('checks required keys and root integrity on wake without reading every asset before HTML', async () => {
  const c = await release('C'); const record = (await c.records())[0];
  const restarting = new ShellRuntime(scope, record.entries, 'C');
  const hashes = vi.spyOn(crypto.subtle, 'digest');
  expect((await restarting.navigation()).status).toBe(200);
  const script = new TextEncoder().encode('/* C */');
  const scriptAudits = () => hashes.mock.calls.filter(([, bytes]) => Buffer.from(bytes).equals(Buffer.from(script))).length;
  expect(scriptAudits()).toBe(0);
  await restarting.auditAfterNavigation();
  expect(scriptAudits()).toBeGreaterThan(0);
  vi.restoreAllMocks();
  await (await caches.open(record.cacheName)).delete(origin + 'assets/main-C.js');
  server.clear();
  expect((await restarting.navigation()).status).toBe(503);
});

it('refreshes the asset catalogue when falling back to a release installed after worker startup', async () => {
  const a = await release('A');
  expect((await a.asset(new Request(origin + 'assets/main-A.js'))).status).toBe(200);
  const b = await release('B'); await presented(b); // Historical fallback, absent from A's first asset snapshot.
  await (await caches.open((await a.identity).cacheName)).delete(origin);
  server.clear();
  expect(await (await a.navigation()).text()).toContain('content="B"');
  const script = await a.asset(new Request(origin + 'assets/main-B.js'));
  expect(script.status).toBe(200); expect(await script.text()).toBe('/* B */');
});

it('keeps verified candidate resources across a failed download and resumes only missing files', async () => {
  const old = await release('old'); await presented(old);
  const send = fetch.getMockImplementation();
  fetch.mockImplementation(request => request.url.endsWith('main-next.js') ? Promise.reject(new TypeError('network interrupted')) : send(request));
  await expect(release('next')).rejects.toThrow('network interrupted');
  expect(await complete(old)).toBe(true);
  const partial = (await old.records()).find(record => record.buildId === 'next');
  expect(partial).toMatchObject({ complete: false, candidateOnly: true });
  expect(partial.installing).toBeUndefined();
  expect((await old.navigation()).status).toBe(200);
  fetch.mockImplementation(send); fetch.mockClear();
  const resumed = await release('next');
  expect(await complete(resumed)).toBe(true);
  expect(fetch.mock.calls.map(([request]) => request.url)).not.toContain(origin);
});

async function fullPlayerRelease(id, onProgress) {
  const files = [
    ['/', `<meta name="same-page-build-id" content="${id}">`, 'text/html'],
    [`/_releases/${id}/assets/musicxml-player-test.js`, '/* player */', 'text/javascript'],
    [`/_releases/${id}/assets/prepare.worker-test.js`, '/* preparation */', 'text/javascript'],
    [`/_releases/${id}/playback/${id}/soundfont/sonivox.sf2`, 'soundfont bytes', 'application/octet-stream'],
  ];
  const entries = await Promise.all(files.map(async ([url, body]) => ({url,revision:null,bytes:Buffer.byteLength(body),integrity:`sha256-${await digest(new TextEncoder().encode(body))}`})));
  for (const [url, body] of files) server.set(new URL(url,origin).href,body);
  const send = vi.fn(async (url, validate, _signal, _policy, received) => {
    const file=files.find(([name])=>new URL(name,origin).href===url);
    if (!file || !server.has(url)) throw new TypeError('offline');
    received?.(0); received?.(Buffer.byteLength(server.get(url)));
    const response=new Response(server.get(url),{headers:{'Content-Type':file[2],Vary:'Origin, Accept-Encoding'}});
    if (!await validate(response)) throw new Error('shell_integrity_mismatch');
    return response;
  });
  return {runtime:new ShellRuntime(scope,entries,id,undefined,send,onProgress),entries,files,send};
}
it('migrates verified legacy player bytes into the required shell across release prefixes',async()=>{
  const old=await release('previous'); await presented(old);
  const previous=await fullPlayerRelease('previous');
  const cache=await caches.open('same-page-playback-v1:previous');
  await cache.put(origin+'_releases/previous/playback/previous/manifest.json',Response.json({buildId:'previous',entries:previous.entries.slice(1)}));
  for(const [url,body,type] of previous.files.slice(1)) await cache.put(new URL(url,origin).href,new Response(body,{headers:{'Content-Type':type}}));
  const next=await fullPlayerRelease('next'); await next.runtime.install();
  expect(next.send.mock.calls.map(call=>call[0])).toEqual([origin]);
  await caches.delete('same-page-playback-v1:previous'); server.clear();
  await next.runtime.ready();
  for(const entry of next.entries.slice(1)) {
    const response=await next.runtime.asset(new Request(new URL(entry.url,origin)));
    expect(response.status).toBe(200); expect(response.headers.get('Vary')).toBeNull();
  }
  expect(await complete(old)).toBe(true);
});
it.each(['corrupt','wrong-mime','unreadable'])('downloads only the invalid legacy player target (%s)',async kind=>{
  const old=await fullPlayerRelease('previous');
  const cache=await caches.open('same-page-playback-v1:previous');
  await cache.put(origin+'_releases/previous/playback/previous/manifest.json',Response.json({buildId:'previous',entries:old.entries.slice(1)}));
  for(const [url,body,type] of old.files.slice(1)) await cache.put(new URL(url,origin).href,new Response(body,{headers:{'Content-Type':type}}));
  const sf=old.entries.at(-1);
  if(kind==='corrupt') await cache.put(new URL(sf.url,origin).href,new Response('corrupt',{headers:{'Content-Type':'application/octet-stream'}}));
  if(kind==='wrong-mime') await cache.put(new URL(sf.url,origin).href,new Response('soundfont bytes',{headers:{'Content-Type':'font/woff2'}}));
  if(kind==='unreadable') {
    const original=cache.match.bind(cache);
    cache.match=async(key,options)=>String(key).endsWith('.sf2')?new Response(new ReadableStream({start(controller){controller.error(new Error('unreadable'));}})):original(key,options);
  }
  const next=await fullPlayerRelease('next'); await next.runtime.install();
  expect(next.send.mock.calls.map(call=>call[0])).toEqual([origin,new URL(next.entries.at(-1).url,origin).href]);
});
it('a missing required player prevents installation and preserves the old displayed release',async()=>{
  const old=await release('old'); await presented(old);
  const next=await fullPlayerRelease('next'); server.delete(new URL(next.entries.at(-1).url,origin).href);
  await expect(next.runtime.install()).rejects.toThrow('offline');
  expect(await next.runtime.availableBuild('next')).toBe(false);
  expect(await complete(old)).toBe(true);
  expect(await(await next.runtime.navigation()).text()).toContain('content="old"');
});
it('reuses unchanged required player resources on the following upgrade and detects offline eviction',async()=>{
  const first=await fullPlayerRelease('first'); await first.runtime.install(); await presented(first.runtime);
  const second=await fullPlayerRelease('second'); await second.runtime.install(); await presented(second.runtime);
  expect(second.send.mock.calls.map(call=>call[0])).toEqual([origin]);
  server.clear(); await second.runtime.ready();
  const own=await second.runtime.identity;
  await(await caches.open(own.cacheName)).delete(new URL(second.entries.at(-1).url,origin).href);
  await caches.delete((await first.runtime.identity).cacheName);
  expect(await second.runtime.availableBuild('second')).toBe(false);
  await expect(second.runtime.ready()).rejects.toThrow('offline');
});
it('retires legacy player bundles with their old shell without deleting migrated playback or business storage',async()=>{
  const old=await release('old'); await presented(old);
  await caches.open('same-page-playback-v1:old');
  const unrelated=await caches.open('business-files'); await unrelated.put(origin+'private',new Response('retained'));
  const current=await fullPlayerRelease('current'); await current.runtime.install(); await presented(current.runtime);
  const latest=await fullPlayerRelease('latest'); await latest.runtime.install(); await presented(latest.runtime);
  scope.registration.active=target(()=>latest.runtime.identity);
  await latest.runtime.collect();
  expect(stores.has((await old.identity).cacheName)).toBe(false);
  expect(stores.has('same-page-playback-v1:old')).toBe(false);
  server.clear(); await latest.runtime.ready();
  expect(await complete(current.runtime)).toBe(true);
  expect(await(await unrelated.match(origin+'private')).text()).toBe('retained');
});

it('reports preparation as ready only after the entire release has been verified and committed',async()=>{
 const snapshots=[];
 const full=await fullPlayerRelease('abc1234',p=>snapshots.push(p));
 await full.runtime.install();
 const total=full.entries.reduce((n,e)=>n+e.bytes,0);
 expect(snapshots[0]).toMatchObject({stage:'checking',preparedBytes:0,totalBytes:total});
 expect(snapshots.some(p=>p.stage==='verifying')).toBe(true);
 expect(snapshots.at(-1)).toMatchObject({stage:'ready',preparedBytes:total,downloadedBytes:total,reusedBytes:0});
 expect(await complete(full.runtime)).toBe(true);
 const next=await fullPlayerRelease('def5678',p=>snapshots.push(p)); await next.runtime.install();
 expect(snapshots.at(-1).reusedBytes).toBe(full.entries.slice(1).reduce((n,e)=>n+e.bytes,0));
});
