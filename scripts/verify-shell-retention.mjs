import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium, webkit } from '@playwright/test';

// Bundle the production SW and recovery guard, rather than a second lifecycle
// implementation. Tiny verified manifests let us exercise forty real updates.
const workerCode = (await build({ entryPoints: ['service-worker/sw.ts'], bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2022' })).outputFiles[0].text;
const recoveryCode = (await build({ stdin: { contents: `
  import { ShellRecovery } from './src/client/updates/shell-recovery';
  import { setUpdateRoute, holdUpdate } from './src/client/updates/update-safety';
  setUpdateRoute('/drives');
  const recovery = new ShellRecovery(() => location.reload());
  let release;
  window.setRecoverySafe = safe => { release?.(); release = safe ? undefined : holdUpdate(); };
  addEventListener('pageshow', event => { if (event.persisted) void recovery.check(); });
  setInterval(() => recovery.tick(), 250);
`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2022' })).outputFiles[0].text;
const digest = text => 'sha256-' + createHash('sha256').update(text).digest('base64');
let version = 1;
const buildId = number => number.toString(16).padStart(7, '0');
function probes(own) {
  return `navigator.serviceWorker.addEventListener('message',async event=>{
    if(window.unknown)return;
    if(event.data?.type==='SAME_PAGE_SHELL_PROBE') {
      const buildId=${own ? JSON.stringify(own) : "await new Promise(resolve=>{const c=new MessageChannel();c.port1.onmessage=e=>{c.port1.close();resolve(e.data.buildId)};navigator.serviceWorker.controller.postMessage({type:'SAME_PAGE_SHELL_IDENTITY'},[c.port2])})"};
      event.ports[0]?.postMessage({buildId,cacheName:''});
    }
    if(event.data?.type==='SAME_PAGE_UPDATE_PROBE'){window.probeCount=(window.probeCount||0)+1;event.ports[0]?.postMessage(event.data.requested===true&&window.safe!==false&&!(window.rejectSecond&&window.probeCount>=2));}
  });`;
}
function release(number) {
  const id = buildId(number);
  const script = `window.lazyChunk=${JSON.stringify(id)};`;
  const html = `<!doctype html><meta name="same-page-build-id" content="${id}"><h1>Retention fixture</h1><script>
    const __SAME_PAGE_BUILD_ID__=${JSON.stringify(id)};
    window.fixtureBuild=${JSON.stringify(id)};
    window.restores=[];addEventListener('pageshow',e=>{window.restores.push(e.persisted);const events=JSON.parse(localStorage.getItem('fixture-restores')||'[]');events.push({build:window.fixtureBuild,persisted:e.persisted});localStorage.setItem('fixture-restores',JSON.stringify(events))});
    ${probes(id)}
    navigator.serviceWorker.register('/sw.js');
    ${recoveryCode}
  </script>`;
  return { id, html, script };
}
const server = createServer((request, response) => {
  const current = release(version);
  const pathname = new URL(request.url, 'http://localhost').pathname;
  response.setHeader('Cache-Control', 'no-cache');
  if (pathname === '/sw.js') {
    const entries = [
      { url: '/', revision: current.id, bytes: Buffer.byteLength(current.html), integrity: digest(current.html) },
      { url: `/assets/${current.id}.js`, revision: current.id, bytes: Buffer.byteLength(current.script), integrity: digest(current.script) },
    ];
    response.setHeader('Content-Type', 'text/javascript');
    response.end(`const __SAME_PAGE_BUILD_ID__=${JSON.stringify(current.id)};self.__WB_MANIFEST=${JSON.stringify(entries)};\n${workerCode}`);
  } else if (pathname === '/api/outside') {
    response.setHeader('Content-Type', 'text/html');
    response.end(`<!doctype html><h1>Outside shell</h1><script>${probes(null)}</script>`);
  } else if (pathname.startsWith('/assets/')) {
    if (pathname !== `/assets/${current.id}.js`) { response.writeHead(404); response.end(); return; }
    response.setHeader('Content-Type', 'text/javascript'); response.end(current.script);
  } else { response.setHeader('Content-Type', 'text/html'); response.end(current.html); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
await mkdir('artifacts/verification/shell-retention', { recursive: true });
async function pollPage(page, predicate, argument) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (await page.evaluate(predicate, argument) === true) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('Service worker lifecycle condition timed out: ' + JSON.stringify(await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    return { active: reg?.active?.state, waiting: reg?.waiting?.state, installing: reg?.installing?.state, locks: await navigator.locks.query(), records: await Promise.all((await (await caches.open('same-page-shell-registry-v1:' + encodeURIComponent(location.origin + '/'))).keys()).map(async key => { const record = await (await caches.match(key)).json(); return { buildId: record.buildId, activated: record.activated }; })) };
  })));
}
async function waiting(page, expected) {
  await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration()).update(); });
  await pollPage(page, async expected => {
    const worker = (await navigator.serviceWorker.getRegistration())?.waiting;
    if (!worker) return false;
    return new Promise(resolve => {
      const channel = new MessageChannel(); const timer = setTimeout(() => { channel.port1.close(); resolve(false); }, 1000);
      channel.port1.onmessage = event => { clearTimeout(timer); channel.port1.close(); resolve(event.data?.buildId === expected); };
      worker.postMessage({ type: 'SAME_PAGE_SHELL_IDENTITY' }, [channel.port2]);
    });
  }, expected);
}
async function apply(page) {
  return page.evaluate(async () => {
    const waiting = (await navigator.serviceWorker.getRegistration()).waiting;
    return new Promise(resolve => {
      const channel = new MessageChannel(); const timer = setTimeout(() => { channel.port1.close(); resolve(false); }, 10000);
      channel.port1.onmessage = event => { clearTimeout(timer); channel.port1.close(); resolve(event.data?.safe === true); };
      waiting.postMessage({ type: 'SAME_PAGE_SAFE_UPDATE', requested: true }, [channel.port2]);
    });
  });
}
async function active(page, expected) {
  await pollPage(page, async expected => {
    const worker = (await navigator.serviceWorker.getRegistration())?.active;
    if (!worker || worker.state !== 'activated') return false;
    return new Promise(resolve => {
      const channel = new MessageChannel(); const timer = setTimeout(() => { channel.port1.close(); resolve(false); }, 1000);
      channel.port1.onmessage = event => { clearTimeout(timer); channel.port1.close(); resolve(event.data?.buildId === expected); };
      worker.postMessage({ type: 'SAME_PAGE_SHELL_IDENTITY' }, [channel.port2]);
    });
  }, expected);
}
const shells = page => page.evaluate(async () => (await caches.keys()).filter(name => name.startsWith('same-page-shell-v2:')));
try {
  for (const engine of [chromium, webkit]) {
    version = 1;
    const browser = await engine.launch({ channel: engine === chromium ? 'chromium' : undefined, ignoreDefaultArgs: engine === chromium ? ['--disable-back-forward-cache'] : undefined });
    try {
      const context = await browser.newContext({ serviceWorkers: 'allow' });
      const page = await context.newPage();
      await page.goto(origin); await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
      await active(page, buildId(1)); await page.reload();
      await page.waitForFunction(() => !!navigator.serviceWorker.controller);
      await page.evaluate(() => new Promise((resolve, reject) => {
        const request = indexedDB.open('same-page', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('annotationOutbox');
        request.onerror = reject;
        request.onsuccess = () => { const db = request.result, tx = db.transaction('annotationOutbox', 'readwrite'); tx.objectStore('annotationOutbox').put('unsynced-retained-draft', 'draft'); tx.oncomplete = () => { db.close(); resolve(); }; };
      }));
      await page.evaluate(() => { window.unknown = true; });
      for (version = 2; version <= 21; version++) {
        await waiting(page, buildId(version));
        assert.ok((await shells(page)).length <= 3, 'unknown window caused abandoned candidates to accumulate');
      }
      console.log(`${engine.name()}: twenty unknown-window candidate replacements verified`);
      version = 21;
      await page.evaluate(() => { window.unknown = false; window.safe = false; });
      assert.equal(await apply(page), false, 'unsafe window allowed activation');
      await page.evaluate(() => { window.safe = true; window.rejectSecond = true; window.probeCount = 0; });
      assert.equal(await apply(page), false, 'changed safety in the confirmation round allowed activation');
      await active(page, buildId(1));
      await page.evaluate(() => { window.rejectSecond = false; });
      assert.equal(await apply(page), true); await active(page, buildId(version));
      await page.reload(); assert.equal(await page.evaluate(() => window.fixtureBuild), buildId(version));
      for (version = 22; version <= 41; version++) {
        await waiting(page, buildId(version)); assert.equal(await apply(page), true);
        await active(page, buildId(version)); await page.reload();
        assert.equal(await page.evaluate(() => window.fixtureBuild), buildId(version));
        assert.ok((await shells(page)).length <= 2, 'same-day history grew beyond current and rollback');
      }
      version = 41;
      await page.goto(origin + '/api/outside'); await page.goBack({ waitUntil: 'commit' }); await page.waitForFunction(() => typeof window.fixtureBuild === 'string');
      const baselineRestored = await page.evaluate(() => window.restores.includes(true));
      if (!baselineRestored) console.log(engine.name(), 'BFCache not restored:', await page.evaluate(() => JSON.stringify(performance.getEntriesByType('navigation')[0]?.notRestoredReasons)));
      if (engine === chromium) assert.equal(baselineRestored, true, 'BFCache baseline did not really restore; do not count a fresh navigation as BFCache coverage');
      await page.evaluate(() => window.setRecoverySafe(false));
      await page.goto(origin + '/api/outside');
      for (version = 42; version <= 43; version++) {
        await waiting(page, buildId(version)); assert.equal(await apply(page), true); await active(page, buildId(version));
      }
      version = 43;
      await page.goBack({ waitUntil: 'commit' }); await page.waitForFunction(() => typeof window.fixtureBuild === 'string');
      const restoredBuild = await page.evaluate(() => window.fixtureBuild);
      if (restoredBuild === buildId(41)) {
        assert.ok(await page.evaluate(() => window.restores.includes(true)), 'old page came from ordinary navigation');
        assert.equal(await page.evaluate(() => sessionStorage.getItem('same-page-shell-recovery:000002b')), null, 'recovery reloaded while local work was held');
        await page.evaluate(() => window.setRecoverySafe(true));
      }
      await page.waitForFunction(expected => window.fixtureBuild === expected, buildId(43));
      const draft = await page.evaluate(() => new Promise(resolve => { const r = indexedDB.open('same-page'); r.onsuccess = () => { const db = r.result; const get = db.transaction('annotationOutbox').objectStore('annotationOutbox').get('draft'); get.onsuccess = () => { db.close(); resolve(get.result); }; }; }));
      assert.equal(draft, 'unsynced-retained-draft');
      await page.evaluate(async expected => { const response = await fetch('/assets/' + expected + '.js'); if (!response.ok) throw new Error('lazy chunk unavailable'); await response.text(); }, buildId(43));
      const evidence = { browser: browser.version(), baselineRestored, afterActivationRestoredBuild: restoredBuild, finalBuild: buildId(43), unknownCandidates: 20, activeUpdates: 20, finalShells: (await shells(page)).length, draftPreserved: true, restores: await page.evaluate(() => JSON.parse(localStorage.getItem('fixture-restores'))) };
      await writeFile(`artifacts/verification/shell-retention/${engine.name()}.json`, JSON.stringify(evidence, null, 2));
      console.log(`${engine.name()}: twenty superseded candidates and twenty activations stayed bounded; BFCache baseline=${baselineRestored ? 'real persisted restore' : 'not observed (ordinary return only)'}; restoration=${restoredBuild}; drafts preserved`);
    } finally { await browser.close(); }
  }
} finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
