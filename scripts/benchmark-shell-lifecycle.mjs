import { createServer } from 'node:http';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';
const root = path.resolve(process.env.SHELL_BUILD ?? 'dist/client');
const delay = Number(process.env.SHELL_RTT ?? 200);
let inFlight = 0, peak = 0, installRequests = 0;
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) { res.setHeader('Content-Type', 'application/json'); res.end(url.pathname.includes('social-providers') ? '{"providers":[]}' : 'null'); return; }
    let file = path.resolve(root, '.' + url.pathname);
    try { if (!(await stat(file)).isFile()) throw new Error(); } catch { file = path.join(root, 'index.html'); }
    if (url.pathname !== '/sw.js' && req.headers['sec-fetch-dest'] === 'empty') {
      installRequests++; peak = Math.max(peak, ++inFlight);
      await new Promise(resolve => setTimeout(resolve, delay)); inFlight--;
    }
    res.writeHead(200, { 'Cache-Control': 'no-cache', 'Content-Type': ({ '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.wasm': 'application/wasm' })[path.extname(file)] ?? 'application/octet-stream' });
    res.end(await readFile(file));
  } catch { res.statusCode = 500; res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch();
const context = await browser.newContext({ serviceWorkers: 'allow', viewport: { width: 390, height: 844 } });
const page = await context.newPage();
try {
  const start = performance.now(); await page.goto(origin + '/about');
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  const installMs = performance.now() - start;
  await page.reload(); await page.getByRole('heading', { name: '关于合谱', exact: true }).waitFor();
  const session = await context.newCDPSession(page);
  await session.send('ServiceWorker.enable');
  await session.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const samples = [];
  for (const kind of ['warm', 'cold']) for (let i = 0; i < 5; i++) {
    if (kind === 'cold') await session.send('ServiceWorker.stopAllWorkers');
    const start = performance.now(); await page.goto(origin + '/about?sample=' + kind + i);
    const timing = await page.evaluate(() => { const n = performance.getEntriesByType('navigation')[0]; return { ttfbMs: n.responseStart - n.requestStart, workerMs: n.responseStart - n.workerStart }; });
    samples.push({ kind, elapsedMs: performance.now() - start, ...timing });
  }
  const build = JSON.parse(await readFile(path.join(root, 'build.json'), 'utf8')).buildId;
  const result = { build, latencyPerInstallResponseMs: delay, cpuThrottle: 4, installMs, installRequests, peak, samples };
  const output = process.env.SHELL_BENCH_OUTPUT ?? 'artifacts/verification/shell-lifecycle/performance.json';
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} finally { await context.close(); await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
