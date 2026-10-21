import assert from 'node:assert/strict';
import { requireShellAuditResult } from './shell-audit-diagnostics.mjs';
import { observeShellLifecycleCalls, snapshotShellRegistration } from './shell-lifecycle-observation.mjs';
import { createServer } from 'node:http';
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os'; import path from 'node:path';
import { chromium, webkit } from '@playwright/test';
import { generateSW } from 'workbox-build';

// Legacy workers use the released Workbox 7.4.1 shared-cache policy. Optional
// directories run the same scenarios against reconstructed historical releases.
const temporary = await mkdtemp(path.join(os.tmpdir(), 'same-page-shell-lifecycle-'));
const roots = [path.join(temporary, 'A'), path.join(temporary, 'B'), path.join(temporary, 'C')];
const output = 'artifacts/verification/shell-lifecycle';
await mkdir(output, { recursive: true });
await cp('dist/client', roots[2], { recursive: true });
const currentBuild = JSON.parse(await readFile(path.join(roots[2], 'build.json'), 'utf8')).buildId;
const manifest = JSON.parse(await readFile(path.join(roots[2], 'shell-manifest.json'), 'utf8'));
for (const [index, environment] of ['SAME_PAGE_LEGACY_A', 'SAME_PAGE_LEGACY_B'].entries()) {
  if (process.env[environment]) { await cp(process.env[environment], roots[index], { recursive: true }); continue; }
  await mkdir(path.join(roots[index], 'assets'), { recursive: true });
  const label = ['legacy-A', 'legacy-B'][index];
  await writeFile(path.join(roots[index], 'index.html'), `<!doctype html><meta name="same-page-build-id" content="${label}"><h1>${label}</h1><script src="/assets/${label}.js"></script>`);
  await writeFile(path.join(roots[index], 'assets', label + '.js'), `document.documentElement.dataset.buildId=${JSON.stringify(label)};
    navigator.serviceWorker.register('/sw.js');
    navigator.serviceWorker.addEventListener('message',event=>{if(event.data?.type==='SAME_PAGE_UPDATE_PROBE')event.ports[0]?.postMessage(true)});
    window.addEventListener('same-page-apply-update',async()=>{window.requested=true;const reg=await navigator.serviceWorker.getRegistration();const c=new MessageChannel();reg.waiting.postMessage({type:'SAME_PAGE_SAFE_UPDATE',requested:true},[c.port2]);});
    `);
  await cp('public/update-coordination.js', path.join(roots[index], 'update-coordination.js'));
  await generateSW({ globDirectory: roots[index], swDest: path.join(roots[index], 'sw.js'), globPatterns: ['**/*.{js,html}'], cleanupOutdatedCaches: true,
    importScripts: ['/update-coordination.js'], navigateFallback: '/index.html', navigateFallbackDenylist: [/^\/api(?:\/|$)/] });
}
const expected = await Promise.all(roots.map(async root => (await readFile(path.join(root, 'index.html'), 'utf8')).match(/name="same-page-build-id" content="([^"]+)"/)[1]));
let active = 0, gate, release, blocked = false, offline = false;
const gatePath = '/' + manifest.find(entry => /reader-page-.*\.js$/.test(entry.url)).url.replace(/^\//, '');
const requests = [];
const lifecycleObservations = [];
let auditPhase = 'setup';
const observe = entry => { if (lifecycleObservations.length < 500) lifecycleObservations.push({ time: Date.now(), phase: auditPhase, ...entry }); };
const server = createServer(async (request, response) => {
  try {
    if (request.url === '/sw.js') {
      const requestOffline = offline, releaseIndex = active;
      observe({ type: 'worker-script-request', offline: requestOffline, release: releaseIndex });
      response.once('finish', () => observe({ type: 'worker-script-response', offline: requestOffline, release: releaseIndex, status: response.statusCode }));
      response.once('close', () => { if (!response.writableFinished) observe({ type: 'worker-script-connection-closed', offline: requestOffline, release: releaseIndex }); });
    }
    if (offline) { response.destroy(); return; }
    const url = new URL(request.url, 'http://localhost');
    requests.push({ path: url.pathname, release: active });
    // Fixed loopback fixture destination; query preservation is independently
    // asserted against the product worker below, not this legacy redirect stub.
    if (url.pathname === '/index.html') { response.writeHead(307, { Location: '/' }); response.end(); return; }
    if (active === 2 && url.pathname === gatePath && gate) { blocked = true; await gate; }
    if (url.pathname.startsWith('/api/')) {
      response.setHeader('Content-Type', 'application/json');
      if (url.pathname === '/api/auth/get-session') response.end('null');
      else if (url.pathname === '/api/auth/social-providers') response.end('{"providers":[]}');
      else { response.statusCode = 404; response.end('{"error":"not_found"}'); }
      return;
    }
    let file = path.resolve(roots[active], '.' + url.pathname);
    if (!file.startsWith(roots[active] + path.sep)) file = path.join(roots[active], 'index.html');
    try { if (!(await stat(file)).isFile()) throw new Error('not_file'); }
    catch {
      if (/^\/(assets|pdfjs|font|soundfont)\//.test(url.pathname)) { response.statusCode = 404; response.end(); return; }
      file = path.join(roots[active], 'index.html');
    }
    response.writeHead(200, { 'Cache-Control': 'no-cache', 'Content-Type': ({ '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.webp': 'image/webp', '.wasm': 'application/wasm', '.woff2': 'font/woff2' })[path.extname(file)] ?? 'application/octet-stream' });
    response.end(await readFile(file));
  } catch { response.statusCode = 500; response.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
async function poll(read, label, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try { if (await read()) return; } catch (error) { if (!/Execution context was destroyed/.test(error.message)) throw error; }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('Timed out: ' + label);
}
async function audit(page, role = 'active') {
  const state = await page.evaluate(async ({ manifest, role }) => {
    const registration = await navigator.serviceWorker.getRegistration();
    const target = registration?.[role];
    if (!target) {
      const describeWorker = worker => worker ? { scriptURL: worker.scriptURL, state: worker.state } : null;
      return { missingAuditTarget: {
        role, url: location.href, scope: registration?.scope ?? null,
        controller: describeWorker(navigator.serviceWorker.controller),
        registration: registration ? { scope: registration.scope, active: describeWorker(registration.active), waiting: describeWorker(registration.waiting), installing: describeWorker(registration.installing) } : null,
        registrations: (await navigator.serviceWorker.getRegistrations()).map(value => ({ scope: value.scope, active: describeWorker(value.active), waiting: describeWorker(value.waiting), installing: describeWorker(value.installing) })),
        navigation: performance.getEntriesByType('navigation').map(entry => ({ name: entry.name, type: entry.type, workerStart: entry.workerStart, responseStart: entry.responseStart })),
        heading: document.querySelector('h1')?.textContent ?? null,
      } };
    }
    const identity = await new Promise(resolve => { const c = new MessageChannel(); c.port1.onmessage = e => { c.port1.close(); resolve(e.data); }; target.postMessage({ type: 'SAME_PAGE_SHELL_IDENTITY' }, [c.port2]); });
    const cache = await caches.open(identity.cacheName);
    const failures = [];
    for (const entry of manifest) {
      const response = await cache.match(new URL(entry.url, location.origin + '/').href);
      if (!response) { failures.push({ url: entry.url, reason: 'missing' }); continue; }
      const hash = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256', await response.arrayBuffer()))));
      if (entry.integrity !== 'sha256-' + hash) failures.push({ url: entry.url, reason: 'integrity' });
    }
    return { identity, entries: manifest.length, failures, caches: await caches.keys() };
  }, { manifest, role });
  requireShellAuditResult(state);
  assert.equal(state.identity.buildId, currentBuild); assert.deepEqual(state.failures, []);
  assert.ok(!state.identity.cacheName.includes('-precache-'));
  return state;
}
try {
  const engines = process.env.SAME_PAGE_BROWSER === 'chromium' ? [chromium] : [chromium, webkit];
  for (const engine of engines) {
    const browser = await engine.launch();
    try {
      for (const explicit of engine === webkit ? [true] : [false, true]) {
        active = 0; offline = false; blocked = false; gate = undefined;
        lifecycleObservations.length = 0; auditPhase = 'legacy-overlap';
        const context = await browser.newContext({ serviceWorkers: 'allow', viewport: { width: 390, height: 844 } });
        await context.exposeBinding('__shellLifecycleObservation', (_, entry) => observe({ type: 'browser', ...entry }));
        await context.addInitScript(observeShellLifecycleCalls, '__shellLifecycleObservation');
        const workers = [];
        context.on('serviceworker', worker => { workers.push(worker); void worker.evaluate(() => { self.__shellTestActivated = false; self.addEventListener('activate', () => { self.__shellTestActivated = true; }); }).catch(() => {}); });
        const page = await context.newPage();
        try {
          await page.goto(origin + '/about'); await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined)); await page.reload();
          await poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)), 'legacy controller');
          active = 1; await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration()).update(); });
          await poll(() => page.evaluate(async () => Boolean((await navigator.serviceWorker.getRegistration()).waiting)), 'B waiting');
          gate = new Promise(resolve => { release = resolve; }); active = 2;
          await page.evaluate(() => { navigator.serviceWorker.getRegistration().then(reg => reg.update()).catch(() => {}); });
          await poll(() => Promise.resolve(blocked), 'C installing with slow resource');
          const c = workers.at(-1), b = workers[1];
          const before = await (c ?? page).evaluate(async () => ({ names: await caches.keys() }));
          if (explicit) {
            await page.evaluate(() => window.dispatchEvent(new Event('same-page-apply-update')));
            if (b) await poll(() => b.evaluate(() => self.__shellTestActivated && self.registration.active?.state === 'activated').catch(() => false), 'explicit B activated');
            else await poll(() => page.evaluate(async () => { const reg = await navigator.serviceWorker.getRegistration(); return !reg.waiting && reg.active?.state === 'activated'; }), 'explicit B activated');
            await page.reload();
            await poll(() => page.evaluate(build => document.documentElement.dataset.buildId === build, expected[1]), 'B displayed after explicit update');
          } else await page.close();
          if (b) await poll(() => b.evaluate(() => self.__shellTestActivated).catch(() => false), 'B activated while C installing');
          // Legacy namespace cleanup and same-cache revision pruning have both run.
          const during = await (c ?? page).evaluate(async () => {
            const result = [];
            for (const name of await caches.keys()) if (name.startsWith('same-page-shell-v1:')) result.push({ name, root: Boolean(await (await caches.open(name)).match(location.origin + '/')) });
            return result;
          });
          assert.ok(during.length && during.every(record => record.root), 'legacy activation must retain installing C root');
          release(); gate = undefined;
          if (explicit) {
            await poll(() => page.evaluate(async () => Boolean((await navigator.serviceWorker.getRegistration()).waiting)), 'C ready behind B');
            if (engine === webkit) {
              // WebKit does not expose service-worker execution contexts. Finish
              // its final handover through the real, explicit safety protocol.
              await new Promise(resolve => setTimeout(resolve, 3100));
              await page.evaluate(() => window.dispatchEvent(new Event('same-page-apply-update')));
              await poll(() => page.evaluate(() => new Promise(resolve => {
                const channel = new MessageChannel(); const timer = setTimeout(() => resolve(false), 250);
                channel.port1.onmessage = () => { clearTimeout(timer); channel.port1.close(); resolve(true); };
                navigator.serviceWorker.controller.postMessage({ type: 'SAME_PAGE_SHELL_IDENTITY' }, [channel.port2]);
              })), 'WebKit final controller handover');
            }
            await page.close();
          }
          if (c) await poll(() => c.evaluate(() => self.__shellTestActivated && self.registration.active?.state === 'activated').catch(() => false), 'C activated');
          const current = await context.newPage(); await current.goto(origin + '/about');
          await poll(() => current.evaluate(build => document.documentElement.dataset.buildId === build, currentBuild), 'C displayed');
          auditPhase = 'initial-current-audit';
          const complete = await audit(current);
          await current.goto(origin + '/index.html?canonical=1');
          assert.equal(new URL(current.url()).pathname, '/'); assert.equal(new URL(current.url()).search, '?canonical=1');
          await current.goto(origin + '/about');
          // Chromium can replace an empty 404 document with its own error page;
          // this explicit missing static URL must never resolve to the SPA shell.
          const assetPage = await context.newPage();
          try {
            const asset = await assetPage.goto(origin + '/assets/shell-test-missing.js').catch(error => {
              assert.match(error.message, /ERR_HTTP_RESPONSE_CODE_FAILURE/); return null;
            });
            if (asset) { assert.equal(asset.status(), 404); assert.doesNotMatch(asset.headers()['content-type'] ?? '', /html/); }
          } finally { await assetPage.close(); }
          const missingAsset = await current.evaluate(async () => { const response = await fetch('/assets/shell-test-missing.js'); return { status: response.status, type: response.headers.get('content-type') }; });
          assert.equal(missingAsset.status, 404); assert.doesNotMatch(missingAsset.type ?? '', /html/);
          const api = await current.goto(origin + '/api/shell-test-missing'); assert.equal(api.status(), 404); assert.match(api.headers()['content-type'], /json/);
          await current.goBack(); await current.getByRole('heading', { name: '关于与更新', exact: true }).waitFor();
          // Fault injection is recovery coverage, separate from the overlap above.
          await current.evaluate(async () => { for (const name of await caches.keys()) if (name.startsWith('same-page-shell-v1:')) await (await caches.open(name)).delete(location.origin + '/'); });
          auditPhase = 'root-repair-reload';
          await current.reload(); await audit(current);
          observe({ type: 'before-offline', state: await current.evaluate(snapshotShellRegistration) });
          auditPhase = 'first-offline-reload';
          offline = true; if (engine === chromium) await context.setOffline(true);
          await current.reload(); await current.getByRole('heading', { name: '关于与更新', exact: true }).waitFor(); await audit(current);
          await current.evaluate(async () => { for (const name of await caches.keys()) if (name.startsWith('same-page-shell-v1:')) await (await caches.open(name)).delete(location.origin + '/'); });
          const retry = await current.reload(); assert.equal(retry.status(), 503);
          await current.getByRole('heading', { name: '暂时无法打开合谱', exact: true }).waitFor();
          await current.screenshot({ path: `${output}/${engine.name()}-${explicit ? 'explicit' : 'automatic'}-offline-retry.png` });
          offline = false; await context.setOffline(false);
          await current.getByRole('button', { name: '重试', exact: true }).click();
          await poll(() => current.evaluate(build => document.documentElement.dataset.buildId === build, currentBuild), 'manual reconnect recovery');
          await audit(current);
          await current.screenshot({ path: `${output}/${engine.name()}-${explicit ? 'explicit' : 'automatic'}.png` });
          await writeFile(`${output}/${engine.name()}-${explicit ? 'explicit' : 'automatic'}.json`, JSON.stringify({ versions: expected, before, during, complete, finalActivation: engine === webkit ? 'explicit (no background worker inspection)' : 'automatic', scenario: 'legacy A/B + isolated C; full manifest; API; Back; repair; offline; reconnect' }, null, 2));
          console.log(`Verified ${engine.name()} ${explicit ? 'explicit' : 'automatic'} A/B/C migration and all ${manifest.length} entries`);
        } catch (error) {
          // Fixed-scope synthetic fixture only; collect before context teardown.
          // Keep the original assertion/error and do not retry or replace its target.
          const snapshots = [];
          for (const candidate of context.pages()) {
            try { snapshots.push(await candidate.evaluate(snapshotShellRegistration)); }
            catch (reason) { snapshots.push({ error: String(reason) }); }
          }
          try {
            await writeFile(`${output}/${engine.name()}-${explicit ? 'explicit' : 'automatic'}-failure.json`, JSON.stringify({ error: String(error), phase: auditPhase, observations: lifecycleObservations, snapshots }, null, 2));
          } catch (diagnosticError) { console.error('Unable to preserve shell lifecycle observation:', diagnosticError); }
          throw error;
        } finally { release?.(); gate = undefined; offline = false; await context.close(); }
      }
      if (engine === chromium) {
        active = 0;
        const context = await browser.newContext({ serviceWorkers: 'allow' });
        try {
          const page = await context.newPage(); await page.goto(origin + '/about');
          await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined)); await page.reload();
          active = 1; await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration()).update(); });
          await poll(() => page.evaluate(async () => Boolean((await navigator.serviceWorker.getRegistration()).waiting)), 'quota fixture B ready');
          const session = await context.newCDPSession(page);
          await session.send('Storage.overrideQuotaForOrigin', { origin, quotaSize: 128 });
          active = 2;
          await page.evaluate(async () => {
            window.__installStates = []; const reg = await navigator.serviceWorker.getRegistration();
            reg.addEventListener('updatefound', () => { const worker = reg.installing; worker.addEventListener('statechange', () => window.__installStates.push(worker.state)); });
            await reg.update();
          });
          await poll(() => page.evaluate(() => window.__installStates.includes('redundant')), 'quota rejects new shell');
          assert.equal(await page.evaluate(async () => Boolean((await navigator.serviceWorker.getRegistration()).waiting)), true, 'older prepared B survives quota failure');
          await page.reload(); assert.equal(await page.evaluate(() => document.documentElement.dataset.buildId), expected[0]);
          await session.send('Storage.overrideQuotaForOrigin', { origin });
          await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration()).update(); });
          await poll(() => page.evaluate(() => new Promise(async resolve => {
            const reg = await navigator.serviceWorker.getRegistration(); if (!reg.waiting) return resolve(false);
            const channel = new MessageChannel(); const timer = setTimeout(() => { channel.port1.close(); resolve(false); }, 150);
            channel.port1.onmessage = () => { clearTimeout(timer); channel.port1.close(); resolve(true); };
            reg.waiting.postMessage({ type: 'SAME_PAGE_SHELL_IDENTITY' }, [channel.port2]);
          })), 'retry C after quota restored');
          await audit(page, 'waiting'); await session.detach();
          console.log('Verified real Chromium quota rejection retains A and waiting B, then C retry verifies its complete manifest');
        } finally { await context.close(); }
      }
    } finally { await browser.close(); }
  }
} finally { release?.(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(temporary, { recursive: true, force: true }); }
