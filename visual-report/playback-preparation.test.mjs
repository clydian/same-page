import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { before, after, test } from 'node:test';
import { chromium, webkit, expect } from '@playwright/test';
import { startProductionPreview } from './production-preview.mjs';
import { createVisualFixtureSession } from './fixtures.mjs';
let app;
before(async () => {
 app = await startProductionPreview();
 await mkdir('artifacts/verification/playback-preparation', { recursive: true });
}, { timeout: 240000 });
after(async () => app?.stop());

for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
 test(`${name}: preparation exposes its real download phase and preserves the reader`, async t => {
  const browser = await engine.launch(); t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', reducedMotion: 'reduce' });
  page.setDefaultTimeout(15000);
  const fixture = createVisualFixtureSession({ id: 'reader-practice-loading', buildId: app.buildId });
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

// Use sealed version-prefixed production output: a successful fresh load alone
// cannot catch WebKit retaining a failed modulepreload across reloads.
for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
 for (const [target, failureKind] of [['musicxml-player', '404'], ['musicxml-engine', '404'], ['audio-player', '404'], ['musicxml-player', 'network']]) {
  test(`${name}: ${target} recovers after ${failureKind} without applying an update`, { timeout: 90000 }, async t => {
   const browser = await engine.launch(); t.after(() => browser.close());
   const page = await browser.newPage({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', reducedMotion: 'reduce' });
   page.setDefaultTimeout(15000);
   const fixture = createVisualFixtureSession({ id: 'reader-practice-recovery', multipleSources: true, buildId: app.buildId });
   await page.addInitScript(() => localStorage.setItem('reader-gesture-hint-seen', 'true'));
   await page.route('**/api/**', route => {
    const request = route.request();
    return route.fulfill(fixture.resolve({ pathname: new URL(request.url()).pathname, method: request.method(), identity: 'member', cookie: '' }));
   });
   let unavailable = true, requests = 0;
   await page.route(`**/assets/${target}-*.js`, route => {
    requests++;
    assert.match(new URL(route.request().url()).pathname, /^\/_releases\/[a-f0-9]{40}\/assets\//);
    if (!unavailable) return route.continue();
    return failureKind === 'network' ? route.abort('failed') : route.fulfill({ status: 404, contentType: 'text/plain', headers: { 'Cache-Control': 'no-store' }, body: 'temporarily unavailable' });
   });
   const url = `${app.origin}/choirs/visual-choir${target === 'audio-player' ? '' : '/scores/visual-score'}`;
   const open = async () => {
    if (target === 'audio-player') {
     if (!await page.getByRole('button', { name: '示范录音.wav', exact: true }).isVisible()) await page.locator('.attachment-count').first().click();
     await page.getByRole('button', { name: '示范录音.wav', exact: true }).click();
     return;
    }
    await page.locator('canvas[data-pdf-canvas-active]').first().waitFor();
    if (!await page.getByRole('button', { name: '练习谱', exact: true }).isVisible()) await page.locator('.page-reader__viewport').click();
    await page.getByRole('button', { name: '练习谱', exact: true }).click();
    await page.getByRole('button', { name: target === 'audio-player' ? '示范录音.wav' : '声部练习版.musicxml', exact: true }).click();
   };
   await page.goto(url); await open();
   const failure = page.getByRole('complementary', { name: '播放器加载失败' });
   await expect(failure).toBeVisible();
   const reader = await page.locator(target === 'audio-player' ? 'main' : '.reader-shell').first().elementHandle();
   const firstRequests = requests;
   unavailable = false;
   await failure.getByRole('button', { name: '关闭播放器', exact: true }).click();
   await open(); await expect(failure).toBeVisible();
   assert.equal(requests, firstRequests, 'same-document React.lazy failure is retained');
   assert.equal(await reader.evaluate(element => element.isConnected), true);
   const readerNavigations = [];
   page.on('request', request => { if (request.isNavigationRequest() && request.frame() === page.mainFrame()) readerNavigations.push(request.url()); });
   await failure.getByRole('button', { name: '恢复播放器', exact: true }).click();
   await expect(page.getByRole('heading', { name: '恢复播放器', exact: true })).toBeVisible();
   assert.equal(readerNavigations.length, 0, 'guarded SPA navigation must precede any document reload');
   if (target === 'musicxml-player' && failureKind === '404') await page.locator('section[aria-labelledby="playback-recovery-heading"]').screenshot({ path: `artifacts/verification/playback-preparation/${name}-recovery-action.png` });
   await page.getByRole('button', { name: '重新加载页面', exact: true }).click();
   await expect.poll(() => readerNavigations.length).toBe(1);
   await page.goto(url); await open();
   await expect(page.getByRole('button', { name: '播放', exact: true })).toBeEnabled({ timeout: 30000 });
   assert.ok(requests > firstRequests, 'restored module must actually be requested again');
   assert.ok(await page.getByRole('button', { name: '播放', exact: true }).evaluate(element => parseFloat(getComputedStyle(element).width) >= 44), 'player CSS is still loaded');
   if (target === 'musicxml-player' && failureKind === '404') await page.screenshot({ path: `artifacts/verification/playback-preparation/${name}-recovered.png` });
  });
 }
}
