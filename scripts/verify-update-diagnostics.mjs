import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, stat, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium, webkit } from '@playwright/test';

const oldBuild = 'fcb9631cab68ce3ffdeb77fcd75e91e1a49a825a';
const candidateBuild = JSON.parse(await readFile('dist/client/build.json', 'utf8')).buildId;
const supportHtml = (await readFile('worker/support/update-diagnostics.html', 'utf8')).replace('__BUILD__', /^[a-f0-9]{7,40}$/.test(candidateBuild) ? candidateBuild : 'development').replace('__LIMIT__', String(7 * 1024 * 1024));
const supportScript = await readFile('worker/support/update-diagnostics-browser.js', 'utf8');
const oldHtml = '<!doctype html><h1>旧应用</h1><script>navigator.serviceWorker.register("/sw.js")</script>';
const oldWorker = `self.addEventListener('install',e=>e.waitUntil(self.skipWaiting()));
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(u.pathname.startsWith('/api/'))return;if(e.request.mode==='navigate')e.respondWith(Promise.resolve(new Response(${JSON.stringify(oldHtml)},{headers:{'Content-Type':'text/html'}})));});
self.addEventListener('message',e=>{if(e.data?.type==='SEED_SHELLS'){e.waitUntil((async()=>{for(const record of e.data.records){await caches.open(record.cacheName);const registry=await caches.open('same-page-shell-registry-v1:'+encodeURIComponent(self.registration.scope));await registry.put(new URL('__same_page_shell__/'+encodeURIComponent(record.cacheName),self.registration.scope).href,Response.json(record));}e.ports[0].postMessage(true);})());return;}if(['SAME_PAGE_SHELL_IDENTITY','SAME_PAGE_COLLECT_SHELLS'].includes(e.data?.type))e.ports[0]?.postMessage({buildId:${JSON.stringify(oldBuild)},cacheName:'legacy-owner'});});`;
let candidate = false;
let loseReceipt = false;
const reports = [];
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  response.setHeader('Cache-Control', 'no-store');
  try {
    if (pathname === '/api/support/update') { response.setHeader('Content-Type', 'text/html'); response.end(supportHtml); return; }
    if (pathname === '/api/support/update-diagnostics.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(supportScript); return; }
    if (pathname === '/api/diagnostic-reports' && request.method === 'POST') {
      let body = ''; for await (const chunk of request) body += chunk;
      const report = JSON.parse(body); reports.push(report);
      if (loseReceipt) { loseReceipt = false; response.statusCode = 503; response.end(); return; }
      response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ id: report.id })); return;
    }
    if (pathname === '/sw.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(candidate ? await readFile('dist/client/sw.js') : oldWorker); return; }
    if (pathname === '/') { response.setHeader('Content-Type', 'text/html'); response.end(candidate ? await readFile('dist/client/index.html') : oldHtml); return; }
    const file = path.resolve('dist/client', '.' + pathname);
    if (!file.startsWith(path.resolve('dist/client') + path.sep) || !(await stat(file)).isFile()) throw new Error('missing');
    response.setHeader('Content-Type', /\.m?js$/.test(pathname) ? 'text/javascript' : pathname.endsWith('.css') ? 'text/css' : 'application/octet-stream');
    response.end(await readFile(file));
  } catch { response.statusCode = 404; response.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
await mkdir('artifacts/verification/update-diagnostics', { recursive: true });
async function pollPage(page, predicate, argument) {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (await page.evaluate(predicate, argument) === true) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('Candidate lifecycle condition timed out');
}
try {
  for (const engine of [chromium, webkit]) {
    candidate = false;
    const reportCount = reports.length;
    const browser = await engine.launch();
    try {
      const context = await browser.newContext({ serviceWorkers: 'allow', viewport: { width: 369, height: 762 } });
      const page = await context.newPage();
      await page.goto(origin);
      await page.evaluate(async () => { await navigator.serviceWorker.ready; });
      await page.waitForFunction(() => !!navigator.serviceWorker.controller);
      await page.evaluate(async oldBuild => {
        const scope = location.origin + '/';
        const prefix = 'same-page-shell-v1:' + encodeURIComponent(scope) + ':';
        const records = [];
        const digest = async text => btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))));
        for (const buildId of [oldBuild, '1111111', '2222222', '3333333']) {
          const entries = [{ url: scope, revision: buildId, integrity: 'sha256-' + await digest('root'), bytes: 3_311_372 }, { url: scope + 'assets/fixture-' + buildId + '.js', revision: buildId, integrity: 'sha256-' + await digest('script'), bytes: 3_311_371 }];
          const cacheName = prefix + encodeURIComponent(buildId) + ':' + encodeURIComponent(await digest(JSON.stringify(entries)));
          records.push({ cacheName, buildId, entries, created: Date.now(), activated: Date.now(), complete: true });
        }
        await new Promise(resolve => { const channel = new MessageChannel(); channel.port1.onmessage = () => { channel.port1.close(); resolve(); }; navigator.serviceWorker.controller.postMessage({ type: 'SEED_SHELLS', records }, [channel.port2]); });
        await new Promise((resolve, reject) => {
          const request = indexedDB.open('same-page', 1);
          request.onupgradeneeded = () => { request.result.createObjectStore('system'); request.result.createObjectStore('annotationOutbox'); };
          request.onerror = reject;
          request.onsuccess = () => {
            const db = request.result; const tx = db.transaction(['system', 'annotationOutbox'], 'readwrite');
            tx.objectStore('system').put('private-owner', 'owner');
            tx.objectStore('annotationOutbox').put('private-unsynced-note', 'draft');
            tx.oncomplete = () => { db.close(); resolve(); };
          };
        });
      }, oldBuild);
      const seededRegistry = await page.evaluate(async () => {
        const names = await caches.keys();
        const name = 'same-page-shell-registry-v1:' + encodeURIComponent(location.origin + '/');
        return { names, count: (await (await caches.open(name)).keys()).length };
      });
      assert.equal(seededRegistry.count, 4, JSON.stringify(seededRegistry));
      await page.goto(origin + '/api/support/update');
      await page.waitForFunction(() => !document.getElementById('send').disabled);
      assert.equal(await page.getByRole('heading', { name: '旧应用' }).count(), 0, 'old shell intercepted support navigation');
      const initial = JSON.parse(await page.locator('#report').inputValue());
      assert.equal(initial.update.shellCount, 4);
      assert.equal(initial.update.shellBytes, 26_490_972, JSON.stringify(initial.update));
      assert.equal(initial.update.database.status, 'ok');
      assert.equal(initial.update.activeBuild, oldBuild);
      assert.equal(reports.length, reportCount, 'opening diagnostics uploaded automatically');
      candidate = true;
      await page.getByRole('button', { name: '重试更新并记录原因' }).click();
      await pollPage(page, async () => !!(await navigator.serviceWorker.getRegistration())?.waiting);
      await page.waitForFunction(() => !document.getElementById('send').disabled);
      await page.getByRole('button', { name: '重新检查', exact: true }).click();
      await page.waitForFunction(build => {
        try { return JSON.parse(document.getElementById('report').value).update.waitingBuild === build && !document.getElementById('send').disabled; } catch { return false; }
      }, candidateBuild).catch(async error => { throw new Error(`${engine.name()} expected waiting ${candidateBuild}: ${await page.locator('#report').inputValue()}`, { cause: error }); });
      loseReceipt = true;
      await page.getByRole('button', { name: '发送诊断反馈' }).click();
      await page.getByText('尚未确认收到，请重试发送或复制诊断信息。', { exact: true }).waitFor();
      await page.getByRole('button', { name: '发送诊断反馈' }).click();
      await page.getByText(/反馈编号：/).waitFor();
      assert.equal(reports.length, reportCount + 2);
      assert.deepEqual(reports.at(-1), reports.at(-2), 'uncertain retry changed the frozen payload');
      const report = reports.at(-1);
      assert.equal(report.update.failure, null);
      assert.equal(report.update.waitingBuild, candidateBuild);
      assert.equal(report.update.shellCount, 5);
      assert.equal(report.update.shellBudgetBytes, null);
      assert.equal(report.update.shellPolicy, 'references-v2');
      assert.ok(!JSON.stringify(report).includes('private-'), 'private business data escaped');
      const retained = await page.evaluate(async () => new Promise((resolve, reject) => {
        const request = indexedDB.open('same-page'); request.onerror = reject;
        request.onsuccess = () => {
          const db = request.result; const tx = db.transaction('annotationOutbox', 'readonly'); const read = tx.objectStore('annotationOutbox').get('draft');
          read.onsuccess = () => { db.close(); resolve(read.result); };
        };
      }));
      assert.equal(retained, 'private-unsynced-note');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({ path: `artifacts/verification/update-diagnostics/${engine.name()}.png`, fullPage: true });
      // A live write transaction can stall another tab's read without throwing.
      // Exercise the real IndexedDB path rather than replacing the probe function.
      const blocker = await context.newPage();
      await blocker.goto(origin + '/api/empty');
      await blocker.evaluate(() => new Promise(resolve => {
        const request = indexedDB.open('same-page');
        request.onsuccess = () => {
          const db = request.result, tx = db.transaction('system', 'readwrite');
          let stopped = false;
          window.stopDiagnosticBlock = () => { stopped = true; };
          const next = () => { const read = tx.objectStore('system').get('owner'); read.onsuccess = () => { if (!stopped) next(); }; };
          tx.oncomplete = () => db.close(); next(); resolve();
        };
      }));
      await page.getByRole('button', { name: '重新检查', exact: true }).click();
      await page.waitForFunction(() => {
        try { return JSON.parse(document.getElementById('report').value).update.database.status === 'timeout' && !document.getElementById('send').disabled; } catch { return false; }
      }, undefined, { timeout: 10000 });
      await blocker.evaluate(() => window.stopDiagnosticBlock());
      await blocker.close();
      const fresh = await browser.newContext();
      const empty = await fresh.newPage();
      await empty.goto(origin + '/api/support/update');
      await empty.waitForFunction(() => !document.getElementById('send').disabled);
      assert.equal(JSON.parse(await empty.locator('#report').inputValue()).update.database.status, 'missing');
      assert.equal(await empty.evaluate(async () => (await indexedDB.databases()).some(db => db.name === 'same-page')), false, 'read-only probe created an absent database');
      await fresh.close();
      await page.evaluate(async () => {
        const registration = await navigator.serviceWorker.getRegistration();
        await new Promise((resolve, reject) => {
          const channel = new MessageChannel(); const timer = setTimeout(() => reject(new Error('handover timeout')), 10000);
          channel.port1.onmessage = event => { clearTimeout(timer); channel.port1.close(); event.data?.safe ? resolve() : reject(new Error('handover veto')); };
          registration.waiting.postMessage({ type: 'SAME_PAGE_SAFE_UPDATE', requested: true }, [channel.port2]);
        });
      });
      await pollPage(page, async build => {
        const active = (await navigator.serviceWorker.getRegistration())?.active;
        if (!active || active.state !== 'activated') return false;
        return new Promise(resolve => { const channel = new MessageChannel(); const timer = setTimeout(() => { channel.port1.close(); resolve(false); }, 1000); channel.port1.onmessage = event => { clearTimeout(timer); channel.port1.close(); resolve(event.data?.buildId === build); }; active.postMessage({ type: 'SAME_PAGE_SHELL_IDENTITY' }, [channel.port2]); });
      }, candidateBuild);
      assert.equal(await page.evaluate(async () => (await caches.keys()).filter(name => name.startsWith('same-page-shell-v1:')).length), 4);
      console.log(`${engine.name()}: old shell bypassed; latest candidate prepared beside four legacy shells; uncertain retry unchanged; stalled DB reported; drafts preserved; no absent DB created`);
    } finally { await browser.close(); }
  }
} finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
