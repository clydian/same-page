import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { before, after, test } from 'node:test';
import { build } from 'esbuild';
import { chromium, webkit } from '@playwright/test';

// Exercise the actual shipped worker in real browsers, with two HTTP origins.
// The authority/handover matrix remains in test:pwa-update; this fixture disables
// channel routing and injects only tiny immutable manifests to isolate transport.
const ids = { A: 'a'.repeat(40), B: 'b'.repeat(40) };
const files = new Map(), workers = new Map(), requests = [];
let temporary, main, backup, origins, current = 'A', fault, sockets;
const prefix = id => `/_releases/${id}/`;
function html(id) {
 return `<!doctype html><meta name="same-page-build-id" content="${id}"><h1>${id}</h1><script>
 navigator.serviceWorker.register('/sw.js');
 navigator.serviceWorker.addEventListener('message', event => { if(event.data?.type==='SAME_PAGE_UPDATE_PROBE') event.ports[0]?.postMessage(true); });
 </script>`;
}
async function serve(route, request, response) {
 const pathname = new URL(request.url, origins.direct).pathname;
 requests.push({ route, pathname, cookie: request.headers.cookie ?? '' });
 if (route === 'direct' && pathname === '/sw.js') { response.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' }); response.end(workers.get(current)); return; }
 if (pathname.startsWith(prefix(ids.B))) {
  if (fault === 'both' && pathname.endsWith('two.js') || route === 'direct' && fault && fault !== 'both') {
   if (fault === 'stall') return; // Caller must abandon the connection itself.
   if (fault === 'body') { response.writeHead(200, { 'Content-Type': 'text/javascript', 'Content-Length': '99999' }); response.write('partial'); setTimeout(() => response.destroy(), 30); return; }
   response.destroy(); return;
  }
 }
 const value = pathname === '/' ? { bytes: html(ids[current]), type: 'text/html' } : files.get(pathname);
 if (!value) { response.writeHead(404); response.end(); return; }
 const headers = { 'Content-Type': value.type, 'Cache-Control': 'no-store' };
 if (route === 'backup' && fault !== 'cors') headers['Access-Control-Allow-Origin'] = origins.direct;
 response.writeHead(200, headers);
 response.end(route === 'backup' && fault === 'corrupt' ? 'different version' : value.bytes);
}
before(async () => {
 temporary = await mkdtemp(path.join(tmpdir(), 'same-page-resilient-update-'));
 sockets = new Set();
 const start = async route => {
  const server = createServer((request, response) => { void serve(route, request, response); });
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return server;
 };
 main = await start('direct'); backup = await start('backup');
 origins = { direct: `http://127.0.0.1:${main.address().port}`, backup: `http://127.0.0.1:${backup.address().port}` };
 for (const [label, id] of Object.entries(ids)) {
  const entries = [];
  for (const [file, bytes, type] of [['index.html', html(id), 'text/html'], ['one.js', `/* ${id} one */`, 'text/javascript'], ['two.js', `/* ${id} two */`, 'text/javascript']]) {
   const url = prefix(id) + file;
   files.set(url, { bytes, type });
   entries.push({ url: file === 'index.html' ? '/' : url, ...(file === 'index.html' ? { networkUrl: url } : {}), revision: id, bytes: Buffer.byteLength(bytes), integrity: 'sha256-' + createHash('sha256').update(bytes).digest('base64') });
  }
  const result = await build({ entryPoints: ['service-worker/sw.ts'], bundle: true, write: false, format: 'iife', outdir: temporary, define: {
   'self.__WB_MANIFEST': JSON.stringify(entries), __SAME_PAGE_BUILD_ID__: JSON.stringify(id), __SAME_PAGE_RELEASE_CHANNELS__: 'false',
   __SAME_PAGE_CONNECTIONS__: JSON.stringify({enabled:true,origins}),
  } });
  workers.set(label, result.outputFiles[0].text);
 }
});
after(async () => {
 for (const socket of sockets ?? []) socket.destroy();
 await Promise.all([main, backup].filter(Boolean).map(server => new Promise(resolve => server.close(resolve))));
 if (temporary) await rm(temporary, { recursive: true, force: true });
});
async function waitFor(page, condition, label) {
 const deadline = Date.now() + 20000;
 while (Date.now() < deadline) {
  if (await page.evaluate(condition)) return;
  await new Promise(resolve => setTimeout(resolve, 50));
 }
 throw new Error(`Timed out: ${label}`);
}
for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
 for (const failure of ['network', 'body', 'stall', 'both', 'corrupt', 'cors']) {
  test(`${name}: immutable update survives ${failure} without replacing a usable shell`, { timeout: 60000 }, async t => {
   current = 'A'; fault = undefined; requests.length = 0;
   const browser = await engine.launch(); t.after(() => browser.close());
   const context = await browser.newContext({ serviceWorkers: 'allow' });
   const page = await context.newPage();
   await page.goto(origins.direct);
   await page.evaluate(() => navigator.serviceWorker.ready);
   await page.reload();
   await waitFor(page, () => Boolean(navigator.serviceWorker.controller), 'A controls the page');
   await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration()).update(); document.cookie = 'private=value; Path=/'; });
   await waitFor(page, async () => { const registration = await navigator.serviceWorker.getRegistration(); return !registration.installing && !registration.waiting; }, 'A initial check settles');
   current = 'B'; fault = failure;
   await page.evaluate(async () => {
    window.installStates = [];
    const registration = await navigator.serviceWorker.getRegistration();
    registration.addEventListener('updatefound', () => {
     const worker = registration.installing;
     worker.addEventListener('statechange', () => window.installStates.push(worker.state));
    });
    await registration.update();
   });
   if (['both', 'corrupt', 'cors'].includes(failure)) {
    await waitFor(page, () => window.installStates.includes('redundant'), 'failed B install');
    await page.reload();
    assert.equal(await page.locator('h1').textContent(), ids.A, 'failed candidate cannot become the displayed version');
    if (failure === 'both') {
     const saved = await page.evaluate(async () => {
      const names = await caches.keys();
      const candidate = names.find(name => name.startsWith('same-page-shell-v2:') && name.includes('b'.repeat(40)));
      return candidate ? (await (await caches.open(candidate)).keys()).map(key => new URL(key.url).pathname) : [];
     });
     // Probe actual reuse on retry below, not only cache enumeration.

     requests.length = 0; fault = undefined;
     await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration()).update(); });
     await waitFor(page, async () => Boolean((await navigator.serviceWorker.getRegistration())?.waiting), 'resumed B waits');
     assert.ok(requests.some(item => item.pathname.endsWith('two.js')));
     // Browser eviction is allowed. Reuse every resource still present, and
     // repair those the browser discarded after rejecting the installer.
     for (const url of saved) assert.ok(!requests.some(item => item.pathname === (url === '/' ? prefix(ids.B) + 'index.html' : url)), 'retry reuses retained verified bytes');
     if (name === 'chromium') assert.ok(saved.some(url => url.endsWith('one.js')), 'candidate progress is retained when the browser preserves its cache');
    } else return;
   } else {
    await waitFor(page, async () => Boolean((await navigator.serviceWorker.getRegistration())?.waiting), 'B completes using backup');
    assert.ok(requests.some(item => item.route === 'backup' && item.pathname.startsWith(prefix(ids.B))), JSON.stringify({requests, states: await page.evaluate(async () => { const r=await navigator.serviceWorker.getRegistration(); return {states:window.installStates,waiting:r.waiting?.state,installing:r.installing?.state}; })}));
    assert.ok(requests.filter(item => item.route === 'backup').every(item => item.cookie === ''), 'public fallback never sends cookies');
   }
   const result = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    return new Promise(resolve => { const channel = new MessageChannel(); channel.port1.onmessage = event => { channel.port1.close(); resolve(event.data); }; registration.waiting.postMessage({ type: 'SAME_PAGE_SAFE_UPDATE', requested: true }, [channel.port2]); });
   });
   assert.equal(result.safe, true);
   await waitFor(page, async () => !(await navigator.serviceWorker.getRegistration())?.waiting, 'B activates');
   await page.reload();
   assert.equal(await page.locator('h1').textContent(), ids.B);
  });
 }
}
