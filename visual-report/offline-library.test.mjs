import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';
import { chromium, webkit, expect } from '@playwright/test';
import { startVisualServer } from './setup.mjs';
import { createVisualFixtureSession } from './fixtures.mjs';
const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const evidence = path.join(root, 'artifacts/verification/issue-404');
let server;
before(async () => { server = await startVisualServer({ script: 'dev', cwd: root }); await mkdir(evidence, { recursive: true }); });
after(async () => { await server?.stop(); });
for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
  test(`${name}: row preparation retains only attachment metadata and offline clicks stay in the library`, async t => {
    const profile = await mkdtemp(path.join(tmpdir(), `same-page-404-${name}-`));
    const context = await engine.launchPersistentContext(profile, { headless: true, viewport: { width: 390, height: 844 }, locale: 'zh-CN', serviceWorkers: 'block' });
    t.after(async () => { try { await context.close(); } finally { await rm(profile, { recursive: true, force: true }); } });
    const fixture = createVisualFixtureSession({ id: 'reader-practice-offline', multipleSources: true });
    let fileRequests = 0;
    await context.route('**/api/**', async route => {
      const pathname = new URL(route.request().url()).pathname;
      if (/\/attachments\/[^/]+\/file$/.test(pathname)) fileRequests++;
      const result = fixture.resolve({ pathname, method: route.request().method(), identity: 'member', cookie: route.request().headers().cookie ?? '' });
      await route.fulfill(result);
    });
    await context.addInitScript(() => {
      // This test covers row interaction and storage, not PWA installation.
      navigator.serviceWorker.getRegistration = async () => ({ active: {} });
      let held = false;
      const original = window.fetch;
      window.fetch = async (...args) => {
        const response = await original(...args);
        if (!held && String(args[0]).includes('/versions/') && String(args[0]).endsWith('/pdf')) {
          held = true;
          const bytes = new Uint8Array(await response.arrayBuffer());
          const split = Math.floor(bytes.length / 2);
          const body = new ReadableStream({ start(controller) {
            controller.enqueue(bytes.slice(0, split));
            window.__releaseScoreDownload = () => { controller.enqueue(bytes.slice(split)); controller.close(); };
          } });
          return new Response(body, { status: response.status, headers: response.headers });
        }
        return response;
      };
    });
    let page = await context.newPage();
    await page.goto(`${server.origin}/choirs/visual-choir`);
    const target = page.locator('a.file-row__open[href$="/scores/visual-score"]');
    await target.click();
    await expect(page.getByRole('progressbar', { name: '下载乐谱' })).toHaveAttribute('aria-valuenow', /4[0-9]|50/);
    await expect(page).toHaveURL(/\/choirs\/visual-choir$/);
    await page.screenshot({ path: path.join(evidence, `${name}-download.png`) });
    await expect(page.locator('.pdf-file-icon').filter({ hasText: 'PDF' })).toHaveCount(3);
    await expect(page.getByRole('progressbar')).toHaveCount(1);
    await expect(page.getByRole('button', { name: '取消打开' })).toHaveCount(0);
    await page.evaluate(() => window.__releaseScoreDownload());
    await expect(page).toHaveURL(/\/scores\/visual-score$/);
    await page.locator('[data-pdf-canvas-active]').first().waitFor();
    await page.close();
    page = await context.newPage();
    await page.goto(`${server.origin}/choirs/visual-choir`);
    await page.evaluate(() => { Object.defineProperty(navigator, 'onLine', { configurable: true, value: false }); window.dispatchEvent(new Event('offline')); });
    await page.locator('.attachment-count').first().click();
    await expect(page.getByRole('button', { name: '示范录音.wav', exact: true })).toBeVisible();
    await expect(page.getByText('连接网络后可打开此附件。')).toHaveCount(0);
    await page.screenshot({ path: path.join(evidence, `${name}-offline-list.png`) });
    await page.getByRole('button', { name: '示范录音.wav', exact: true }).click();
    await expect(page.getByText('连接网络后可打开此附件。')).toBeVisible();
    await expect(page).toHaveURL(/\/choirs\/visual-choir$/);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    assert.equal(overflow, false);
    assert.equal(fileRequests, 0, 'attachment content must never be downloaded for preparing a score');
    await page.screenshot({ path: path.join(evidence, `${name}-offline-feedback.png`) });
  });
}
