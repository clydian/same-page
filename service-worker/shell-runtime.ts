import { playbackCacheName } from '../src/shared/playback-assets';
import { isApiPath } from '../src/client/pwa-navigation';
import { applicationShellBudgetBytes } from '../src/shared/update-diagnostics';
export interface ManifestEntry { url: string; revision: string | null; integrity: string; bytes: number }
export interface ShellRecord { cacheName: string; buildId: string; created: number; complete: boolean; installing?: number; activated?: number; entries: ManifestEntry[] }
export interface ShellIdentity { cacheName: string; buildId: string }
export const shellBudget = applicationShellBudgetBytes;
const probeType = 'SAME_PAGE_SHELL_IDENTITY';

export async function digest(bytes: ArrayBuffer | Uint8Array<ArrayBuffer>) {
  return btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))));
}
export async function valid(response: Response | undefined, entry: ManifestEntry) {
  const type = response?.headers.get('Content-Type') ?? '';
  if (/\.(?:m?js)$/.test(entry.url) && !/(?:javascript|ecmascript)/i.test(type)) return false;
  if (/\.css$/.test(entry.url) && !/text\/css/i.test(type)) return false;
  return Boolean(response?.status === 200 && entry.integrity === `sha256-${await digest(await response.clone().arrayBuffer())}`);
}
export async function identify(target: { postMessage(message: unknown, transfer: Transferable[]): void } | null | undefined, type = probeType): Promise<ShellIdentity | null | undefined> {
  if (!target) return null;
  return new Promise(resolve => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => { channel.port1.close(); resolve(undefined); }, 750);
    channel.port1.onmessage = event => {
      clearTimeout(timer); channel.port1.close();
      const value = event.data;
      resolve(value && typeof value.buildId === 'string' && typeof value.cacheName === 'string' ? value : undefined);
    };
    try { target.postMessage({ type }, [channel.port2]); }
    catch { clearTimeout(timer); channel.port1.close(); resolve(undefined); }
  });
}

// This manager owns shell caches, their optional public player bundles and its registry, never business storage.
export class ShellRuntime {
  readonly prefix: string;
  readonly registryName: string;
  readonly identity: Promise<ShellIdentity>;
  private current: Promise<ShellRecord>;
  private repair?: Promise<void>;
  private assetRecords?: Promise<ShellRecord[]>;
  private audit?: Promise<void>;
  constructor(private scope: ServiceWorkerGlobalScope, entries: ManifestEntry[], buildId: string) {
    this.prefix = `same-page-shell-v1:${encodeURIComponent(scope.registration.scope)}:`;
    this.registryName = `same-page-shell-registry-v1:${encodeURIComponent(scope.registration.scope)}`;
    // vite-plugin-pwa appends its web manifest after transforms; discard an
    // untransformed duplicate only when a verified entry for that URL exists.
    const verifiedEntries = entries.filter(entry => entry.integrity || !entries.some(other => other.url === entry.url && other.integrity));
    const normalized = [...new Map(verifiedEntries.map(entry => {
      const url = new URL(entry.url, scope.registration.scope);
      if (url.origin !== scope.location.origin || isApiPath(url.pathname) || !/^sha256-[A-Za-z0-9+/]{43}=$/.test(entry.integrity) || !(entry.bytes >= 0)) throw new Error('invalid_shell_manifest');
      return [url.href, { ...entry, url: url.href }];
    })).values()].sort((a, b) => a.url.localeCompare(b.url));
    if (!normalized.some(entry => entry.url === scope.registration.scope)) throw new Error('missing_canonical_shell');
    this.current = digest(new TextEncoder().encode(JSON.stringify(normalized))).then(async hash => {
      const cacheName = this.prefix + encodeURIComponent(buildId) + ':' + encodeURIComponent(hash);
      const saved = await caches.open(this.registryName).then(cache => cache.match(this.key(cacheName))).then(response => response?.json()).catch(() => undefined) as ShellRecord | undefined;
      return { cacheName, buildId, entries: normalized, complete: saved?.complete === true,
        created: Number.isFinite(saved?.created) ? saved!.created : Date.now(),
        ...(Number.isFinite(saved?.activated) ? { activated: saved!.activated } : {}),
      };
    });
    this.identity = this.current.then(({ cacheName, buildId }) => ({ cacheName, buildId }));
    void this.identity.catch(() => undefined); // An install failure also rejects identity.
  }
  private key(name: string) { return new URL(`__same_page_shell__/${encodeURIComponent(name)}`, this.scope.registration.scope).href; }
  private async save(record: ShellRecord) {
    await (await caches.open(this.registryName)).put(this.key(record.cacheName), Response.json(record));
  }
  async records() {
    const registry = await caches.open(this.registryName);
    const result: ShellRecord[] = [];
    for (const key of await registry.keys()) {
      try {
        const record = await (await registry.match(key))!.json() as ShellRecord;
        if (!record.cacheName.startsWith(this.prefix) || typeof record.buildId !== 'string' || !Number.isFinite(record.created) || !Array.isArray(record.entries)) continue;
        if (!record.entries.some(entry => entry.url === this.scope.registration.scope)) continue;
        if (!record.entries.every(entry => /^sha256-[A-Za-z0-9+/]{43}=$/.test(entry.integrity) && Number.isFinite(entry.bytes) && entry.bytes >= 0 && new URL(entry.url).origin === this.scope.location.origin && !isApiPath(new URL(entry.url).pathname))) continue;
        const expected = this.prefix + encodeURIComponent(record.buildId) + ':' + encodeURIComponent(await digest(new TextEncoder().encode(JSON.stringify(record.entries))));
        if (record.cacheName === expected) result.push(record);
      } catch { /* Unknown records never authorize deletion of unrelated caches. */ }
    }
    return result;
  }
  private async obtain(entry: ManifestEntry, signal?: AbortSignal) {
    // Copy matching immutable bytes, never cache handles or another release's
    // revision bookkeeping. Legacy cleanup can then delete its copy safely.
    let response: Response | undefined;
    for (const name of await caches.keys()) {
      if (!name.startsWith(this.prefix) && !(name.startsWith('workbox-') && name.includes('-precache-') && name.endsWith(this.scope.registration.scope))) continue;
      const candidate = await caches.match(entry.url, { cacheName: name, ignoreSearch: true });
      if (candidate && await valid(candidate, entry)) { response = candidate; break; }
    }
    response ??= await fetch(new Request(entry.url, { credentials: 'same-origin', cache: 'reload', redirect: 'error', integrity: entry.integrity, signal }));
    if (!await valid(response, entry)) throw new Error('shell_integrity_mismatch');
    // A constructed response cannot carry a network redirect flag or compressed
    // transfer headers after its decoded bytes have been read.
    const headers = new Headers(response.headers);
    headers.delete('content-encoding'); headers.delete('content-length');
    return new Response(await response.arrayBuffer(), { status: 200, headers });
  }
  private async check(record: ShellRecord, repair: boolean, verify: boolean, signal?: AbortSignal) {
    const cache = await caches.open(record.cacheName);
    const checkEntry = async (entry: ManifestEntry) => {
      const response = await cache.match(entry.url);
      const correctVersion = async (value: Response) => entry.url !== this.scope.registration.scope ||
        /text\/html/i.test(value.headers.get('Content-Type') ?? '') && (await value.clone().text()).includes(`<meta name="same-page-build-id" content="${record.buildId}">`);
      if (response && (!verify || await valid(response, entry)) && await correctVersion(response)) return;
      if (!repair) throw new Error('shell_incomplete');
      const replacement = await this.obtain(entry, signal);
      if (!await correctVersion(replacement)) throw new Error('shell_version_mismatch');
      await cache.put(entry.url, replacement);
    };
    // Bound network/crypto work without making mobile installation pay one RTT
    // per manifest entry. Finish in-flight writes before cleanup on failure.
    let next = 0, failure: { error: unknown } | undefined;
    await Promise.all(Array.from({ length: Math.min(4, record.entries.length) }, async () => {
      while (!failure && next < record.entries.length) {
        const entry = record.entries[next++];
        try { await checkEntry(entry); } catch (error) { failure ??= { error }; }
      }
    }));
    if (failure) throw failure.error;
  }
  private locked<T>(action: () => Promise<T>) {
    const locks = this.scope.navigator?.locks;
    return locks ? locks.request(this.prefix + 'lifecycle', action) : action();
  }
  async install() {
    const record = await this.current;
    let existing = false;
    // Ask the active owner to reclaim only demonstrably unused releases. Legacy
    // workers do not understand this message; their caches are never evicted.
    if (this.scope.registration.active) await identify(this.scope.registration.active, 'SAME_PAGE_COLLECT_SHELLS');
    await this.locked(async () => {
    existing = (await caches.keys()).includes(record.cacheName);
    const records = await this.records();
    const names = (await caches.keys()).filter(name => name.startsWith(this.prefix));
    const bytes = names.reduce((sum, name) => sum + (records.find(r => r.cacheName === name)?.entries.reduce((n, e) => n + e.bytes, 0) ?? shellBudget / 4), 0);
    const size = record.entries.reduce((sum, entry) => sum + entry.bytes, 0);
    if (!existing && bytes + size > shellBudget) throw new Error('shell_capacity_protected');
    record.installing = Date.now();
    await this.save(record);
    });
    try {
      await this.check(record, true, true, AbortSignal.timeout(300_000));
      // Other workers cannot prune this namespace. Recheck all entries before
      // publishing readiness; a successful earlier put is not a commit marker.
      await this.locked(async () => {
        await this.check(record, false, true);
        delete record.installing; record.complete = true; await this.save(record);
      });
    } catch (error) {
      await this.locked(async () => {
        if (!existing) {
          await caches.delete(record.cacheName);
          await (await caches.open(this.registryName)).delete(this.key(record.cacheName));
        } else {
          delete record.installing; record.complete = false; await this.save(record).catch(() => undefined);
        }
      });
      throw error;
    }
  }
  async ready(signal?: AbortSignal) {
    if (!this.repair) this.repair = (async () => {
      const record = await this.current;
      try { await this.check(record, true, true, signal); }
      catch (error) { record.complete = false; throw error; }
      // Readiness of an already installed shell depends on verified bytes,
      // not on spare quota for refreshing its bookkeeping. Installation still
      // requires its registry commit before the candidate can become waiting.
      record.complete = true; await this.save(record).catch(() => undefined);
    })().finally(() => { this.repair = undefined; });
    return this.repair;
  }
  async readyBuild(buildId: string, signal?: AbortSignal) {
    const current = await this.current;
    if (current.buildId === buildId) return this.ready(signal);
    for (const record of await this.records()) {
      if (record.buildId !== buildId || !record.complete) continue;
      try { await this.check(record, false, true, signal); return; } catch { /* Try a retained matching shell. */ }
    }
    throw new Error('matching_shell_unavailable');
  }
  async activate() {
    // If storage was externally lost after install, remain able to serve a
    // complete rollback shell or a retry page. Do not fail activation itself.
    await this.ready(AbortSignal.timeout(15_000)).catch(() => undefined);
    const record = await this.current; record.activated = Date.now();
    await this.save(record).catch(() => undefined);
    await this.collect();
  }
  private async references() {
    const { active, waiting, installing } = this.scope.registration;
    const roles = await Promise.all([active, waiting, installing].map(worker => identify(worker)));
    if (roles.some(role => role === undefined)) return null;
    const own = await this.identity;
    if (roles[0]?.cacheName !== own.cacheName) return null;
    const clients = await this.scope.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const pages = await Promise.all(clients.map(client => identify(client, 'SAME_PAGE_SHELL_PROBE')));
    if (pages.some(page => !page)) return null;
    const current = await this.scope.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (current.some(client => !clients.some(previous => previous.id === client.id))) return null;
    return { roles: roles.filter(Boolean) as ShellIdentity[], pages: pages as ShellIdentity[] };
  }
  async collect() {
    // Without an origin-wide lock, retain caches rather than race an installer
    // reusing a retired immutable release. Admission stays bounded either way.
    if (!this.scope.navigator?.locks) return;
    return this.locked(() => this.collectLocked());
  }
  private async collectLocked() {
    const candidates = await this.records(); // Fixed snapshot excludes future installers.
    const references = await this.references();
    if (!references) return;
    const keep = new Set(references.roles.map(role => role.cacheName));
    for (const page of references.pages) {
      const matches = candidates.filter(record => record.buildId === page.buildId);
      if (!matches.length) return; // Legacy/unknown displayed version: defer collection.
      matches.forEach(record => keep.add(record.cacheName));
    }
    for (const record of candidates) {
      if (record.installing && Date.now() - record.installing < 120_000) keep.add(record.cacheName);
      // History/BFCache entries need not appear in clients.matchAll(). Give a
      // displayed release a full day before it can become a GC candidate.
      if (record.activated && Date.now() - record.activated < 86400000) keep.add(record.cacheName);
    }
    for (const previous of candidates.filter(record => record.complete && !keep.has(record.cacheName)).sort((a, b) => b.created - a.created)) {
      try { await this.check(previous, false, true); keep.add(previous.cacheName); break; } catch { /* An incomplete retired copy is not a rollback. */ }
    }
    for (const record of candidates.filter(record => !keep.has(record.cacheName))) {
      // An update, a new tab or a restored old tab can race the earlier snapshot.
      const latest = await this.references();
      if (!latest || latest.pages.some(page => !candidates.some(record => record.buildId === page.buildId)) || latest.roles.some(role => role.cacheName === record.cacheName) || latest.pages.some(page => page.buildId === record.buildId)) return;
      await caches.delete(record.cacheName);
      // Optional public resources share the same live-document protection.
      // Their collector never touches IndexedDB or another product cache.
      if (!candidates.some(other => keep.has(other.cacheName) && other.buildId === record.buildId)) await caches.delete(playbackCacheName(record.buildId));
      await (await caches.open(this.registryName)).delete(this.key(record.cacheName));
      this.assetRecords = undefined;
    }
  }
  async navigation() {
    const record = await this.current;
    try {
      const cache = await caches.open(record.cacheName);
      // A sealed manifest was fully audited at install/activation. Check all
      // required keys before returning HTML, and verify the actual root bytes.
      // Every served asset is separately hashed; a full wake-up audit runs after
      // the response instead of blocking its first byte on 6+ MiB of reads.
      const present = new Set((await cache.keys()).map(key => key.url));
      const root = record.entries.find(entry => entry.url === this.scope.registration.scope)!;
      let shell = await cache.match(root.url);
      if (!record.complete || record.entries.some(entry => !present.has(entry.url)) || !await valid(shell, root) || !/text\/html/i.test(shell?.headers.get('Content-Type') ?? '')) {
        await this.ready(AbortSignal.timeout(10_000));
        shell = await cache.match(root.url);
      }
      // Cache eviction can race the audit and this final read. Never let an
      // undefined value escape respondWith, even after successful readiness.
      if (!shell || !await valid(shell, root)) throw new Error('shell_disappeared');
      return shell;
    } catch {
      for (const previous of (await this.records().catch(() => [])).filter(r => r.complete && r.cacheName !== record.cacheName).sort((a, b) => b.created - a.created)) {
        try {
          await this.check(previous, false, true);
          const shell = await (await caches.open(previous.cacheName)).match(this.scope.registration.scope);
          if (shell) { this.assetRecords = undefined; return shell; }
        } catch { /* Try another complete retained release; never a mixed shell. */ }
      }
      return new Response('<!doctype html><html lang="zh-CN"><meta name="viewport" content="width=device-width,initial-scale=1"><title>合谱</title><body><main><h1>暂时无法打开合谱</h1><p>请联网后重试。此设备保存的内容仍然保留。</p><button onclick="location.reload()">重试</button></main></body></html>', { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
    }
  }
  auditAfterNavigation() {
    this.audit ??= this.ready(AbortSignal.timeout(30_000)).catch(() => undefined);
    return this.audit;
  }
  async asset(request: Request): Promise<Response> {
    try { return await this.cachedAsset(request); } catch { return this.networkAsset(request); }
  }
  private async cachedAsset(request: Request) {
    const url = new URL(request.url); url.search = '';
    const current = await this.current;
    this.assetRecords ??= this.records().catch(error => { this.assetRecords = undefined; throw error; });
    const records = [current, ...(await this.assetRecords).filter(record => record.cacheName !== current.cacheName)];
    for (const record of records) {
      const entry = record.entries.find(entry => entry.url === url.href);
      if (!entry) continue;
      const cached = await caches.match(url.href, { cacheName: record.cacheName });
      if (cached && await valid(cached, entry)) return cached;
      if (record.cacheName === current.cacheName) {
        try {
          const repaired = await this.obtain(entry, AbortSignal.timeout(10_000));
          await (await caches.open(record.cacheName)).put(url.href, repaired.clone());
          return repaired;
        } catch { /* Retained/legacy assets can still satisfy an old document. */ }
      }
    }
    for (const name of await caches.keys()) {
      if (!name.startsWith('workbox-') || !name.includes('-precache-') || !name.endsWith(this.scope.registration.scope)) continue;
      const cached = await (await caches.open(name)).match(url.href, { ignoreSearch: true });
      if (cached?.status === 200 && !/text\/html/i.test(cached.headers.get('Content-Type') ?? '')) return cached;
    }
    return this.networkAsset(request);
  }
  private async networkAsset(request: Request) {
    try {
      const response = await fetch(request);
      if (/text\/html/i.test(response.headers.get('Content-Type') ?? '')) return new Response(null, { status: 404 });
      return response;
    } catch { return new Response(null, { status: 503, headers: { 'Cache-Control': 'no-store' } }); }
  }
}
