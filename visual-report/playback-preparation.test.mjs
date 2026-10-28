import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { before, after, test } from 'node:test';
import { chromium, webkit, expect } from '@playwright/test';
import { startViteServer } from '../scripts/vite-server.mjs';
import { createVisualFixtureSession } from './fixtures.mjs';
let app;
before(async () => {
 await promisify(execFile)('npm', ['run', 'build'], { timeout: 180000, maxBuffer: 4 * 1024 * 1024 });
 app = await startViteServer({ script: 'preview' });
 await mkdir('artifacts/verification/playback-preparation', { recursive: true });
}, { timeout: 240000 });
after(async () => app?.stop());

for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
 test(`${name}: preparation exposes its real download phase and preserves the reader`, async t => {
  const browser = await engine.launch(); t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', reducedMotion: 'reduce' });
  page.setDefaultTimeout(15000);
  const fixture = createVisualFixtureSession({ id: 'reader-practice-loading' });
  let resumeDownload;
  await page.addInitScript(() => localStorage.setItem('reader-gesture-hint-seen','true'));
  await page.route('**/api/**', async route => {
   const request = route.request(), pathname = new URL(request.url()).pathname;
   const response = fixture.resolve({ pathname, method: request.method(), identity: 'member', cookie: '' });
   if (pathname.endsWith('/practice-xml/file')) await new Promise(resolve => { resumeDownload = resolve; });
   return route.fulfill(response);
  });
  await page.goto(`${app.origin}/choirs/visual-choir/scores/visual-score`);
  await page.locator('canvas[data-pdf-canvas-active]').first().waitFor();
  const reader = await page.locator('.reader-shell').elementHandle();
  await page.locator('.page-reader__viewport').click();
  await page.getByRole('button', { name: '练习谱', exact: true }).click();
  await page.getByRole('button', { name: '声部练习版.musicxml', exact: true }).click();
  try {
   await expect(page.getByText('正在下载乐谱…', { exact: true })).toBeVisible();
   await expect(page.getByRole('progressbar', { name: '正在下载乐谱…' })).toHaveAttribute('value', '0');
   assert.equal(await reader.evaluate(element => element.isConnected), true);
   await page.screenshot({ path: `artifacts/verification/playback-preparation/${name}-download.png` });
  } finally { resumeDownload?.(); }
  await expect(page.getByRole('button', { name: '播放', exact: true })).toBeEnabled({ timeout: 30000 }).catch(async error => {
   await page.screenshot({ path: `artifacts/verification/playback-preparation/${name}-failure.png` });
   console.error(await page.locator('.practice-notice').allTextContents());
   throw error;
  });
  await page.screenshot({ path: `artifacts/verification/playback-preparation/${name}-ready.png` });

  assert.equal(await reader.evaluate(element => element.isConnected), true);
 });
}
