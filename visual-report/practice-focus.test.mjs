import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { chromium, webkit, expect } from '@playwright/test';
import { startViteServer } from '../scripts/vite-server.mjs';
import { createVisualFixtureSession } from './fixtures.mjs';

let server;
before(async () => {
  // Visual shards start from a clean checkout and do not download build's
  // artifact. Compile these exact sources before exercising alphaTab workers.
  await promisify(execFile)('npm', ['run', 'build'], { cwd: process.cwd(), timeout: 180000, maxBuffer: 4 * 1024 * 1024 });
  server = await startViteServer({ script: 'preview', cwd: process.cwd() });
}, { timeout: 240000 });
after(async () => { await server?.stop(); });
const engines = process.env.PRACTICE_TEST_ENGINES?.split(',') ?? ['chromium', 'webkit'];
const evidence = 'artifacts/verification/practice-focus';
for (const name of engines) test(`${name}: low-height player controls, rotation, following and fullscreen fallback`, { timeout: 120000 }, async t => {
  const browser = await ({ chromium, webkit })[name].launch({ headless: true, ...(name === 'chromium' && process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
  const page = await browser.newPage({ viewport: { width: 844, height: 390 }, hasTouch: true, reducedMotion: 'reduce', locale: 'zh-CN' });
  let completed = false;
  t.after(async () => {
    if (!completed) {
      await mkdir(evidence, { recursive: true });
      await page.screenshot({ path: `${evidence}/${name}-failure.png` });
      console.error(await page.locator('.practice-play').evaluate(el => { const r=el.getBoundingClientRect(); return { rect:r.toJSON(), hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.outerHTML.slice(0,400), viewport: {width:innerWidth,height:innerHeight}, body:document.body.getBoundingClientRect().toJSON() }; }).catch(() => ({})));
    }
    await browser.close();
  });
  await page.addInitScript(() => localStorage.setItem('reader-gesture-hint-seen', 'true'));
  const errors = []; page.on('pageerror', error => errors.push(String(error))); page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); }); page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${new URL(response.url()).pathname}`); });
  const fixture = createVisualFixtureSession({ id: 'reader-practice-focus' });
  await page.route('**/api/**', async route => {
    const request = route.request();
    await route.fulfill(fixture.resolve({ pathname: new URL(request.url()).pathname, method: request.method(), identity: 'member', cookie: request.headers().cookie ?? '' }));
  });
  // Real DOM rendering and playback engine; only authenticated APIs use fixtures.
  await page.goto(`${server.origin}/choirs/visual-choir/scores/visual-score`);
  await page.locator('.page-reader__sheet[data-page-turn-current] [data-pdf-canvas-active]').waitFor();
  await page.locator('.page-reader__viewport').click();
  await page.getByRole('button', { name: '练习谱', exact: true }).click();
  await page.getByRole('button', { name: '声部练习版.musicxml', exact: true }).click();
  await page.locator('.practice-notation[data-visible] .at-surface').waitFor({ timeout: 15000 }).catch(async error => {
    await mkdir(evidence, { recursive: true });
    await page.screenshot({ path: `${evidence}/${name}-failure.png` });
    console.error({ errors, body: await page.locator('body').innerText() });
    throw error;
  });
  await expect(page.getByRole('button', { name: '播放', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: '展开看谱控制' })).toBeVisible();
  await expect(page.getByRole('button', { name: '展开播放控制' })).toBeVisible();
  const region = page.getByRole('region', { name: '滚动谱面' });
  const frame = () => page.locator('.practice-notation').evaluate(el => {
    const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, height: r.height };
  });
  assert.deepEqual(await frame(), { top: 0, bottom: 390, height: 390 });
  await mkdir(evidence, { recursive: true });
  await page.screenshot({ path: `${evidence}/${name}-landscape-collapsed.png` });
  await page.getByRole('button', { name: '展开看谱控制' }).click();
  await page.getByRole('button', { name: '展开播放控制' }).click();
  await page.screenshot({ path: `${evidence}/${name}-landscape-expanded.png` });
  await page.getByRole('button', { name: '收起看谱控制' }).click();
  await page.getByRole('button', { name: '收起播放控制' }).click();
  await page.addStyleTag({ content: ':root { --safe-top: 20px; --safe-left: 28px; --safe-right: 28px; }' });
  await expect.poll(async () => (await frame()).top).toBe(20);
  const headerSafe = await page.locator('.practice-header').boundingBox(); assert.ok(headerSafe.x >= 28 && headerSafe.y >= 20);
  await page.addStyleTag({ content: ':root { --safe-top: 0px; --safe-left: 0px; --safe-right: 0px; }' });
  await page.getByRole('button', { name: '播放', exact: true }).click();
  await expect(page.getByRole('button', { name: '暂停', exact: true })).toBeVisible();
  await region.evaluate(el => { el.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 120 })); el.scrollTop = 120; el.dispatchEvent(new Event('scroll'));  });
  const follow = page.getByRole('button', { name: '恢复自动跟随' });
  await expect(follow).toBeVisible();
  await page.addStyleTag({ content: ':root { --safe-left: 28px; --safe-right: 28px; }' });
  await expect.poll(async () => (await follow.boundingBox()).x).toBeGreaterThanOrEqual(28);
  await page.addStyleTag({ content: ':root { --safe-left: 0px; --safe-right: 0px; }' });
  const followedFrame = await frame();
  const followPosition = await follow.evaluate(el => getComputedStyle(el).position);
  assert.equal(followPosition, 'absolute');
  assert.deepEqual(followedFrame, { top: 0, bottom: 390, height: 390 });
  await page.screenshot({ path: `${evidence}/${name}-landscape-follow.png` });
  await follow.click(); await expect(follow).toBeHidden();
  assert.deepEqual(await frame(), followedFrame);
  await page.getByRole('button', { name: '展开看谱控制' }).click();
  await page.getByRole('button', { name: '展开播放控制' }).click();
  await expect(page.getByRole('button', { name: '暂停', exact: true })).toBeVisible();
  const expanded = await frame(); assert.ok(expanded.height < 300 && expanded.height >= 280, JSON.stringify(expanded));
  await page.getByRole('button', { name: '显示谱面' }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('menu', { name: '显示谱面' })).toBeVisible();
  await page.locator('.practice-view-option').filter({ hasText: '重排谱面' }).click();
  await expect(page.getByRole('menu', { name: '显示谱面' })).toBeHidden();
  await expect(page.getByRole('button', { name: '收起看谱控制' })).toBeVisible();
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await page.getByRole('button', { name: '练习设置', exact: true }).click();
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(page.getByRole('dialog', { name: '练习设置' })).toBeVisible();
  await page.getByRole('button', { name: '关闭练习设置' }).click();
  const timeline = page.getByRole('slider', { name: '播放进度' });
  // An ongoing range interaction survives viewport changes without collapsing.
  await timeline.focus(); await page.keyboard.down('ArrowRight');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(timeline).toBeFocused(); await page.keyboard.up('ArrowRight');
  await expect(page.getByRole('button', { name: '收起播放控制' })).toBeVisible();
  await page.screenshot({ path: `${evidence}/${name}-portrait-expanded.png` });
  await page.setViewportSize({ width: 320, height: 568 });
  const boxes = await page.locator('.practice-bar button:visible, .practice-bar select:visible').evaluateAll(els => els.map(el => { const r=el.getBoundingClientRect(); return { label: el.getAttribute('aria-label'), left:r.left,right:r.right,width:r.width,height:r.height }; }));
  for (let index = 1; index < boxes.length; index++) assert.ok(boxes[index].left >= boxes[index - 1].right, `Overlapping controls: ${JSON.stringify(boxes.slice(index - 1, index + 1))}`);
  for (const b of boxes) assert.ok(b.left >= 0 && b.right <= 320 && b.width >= 44 && b.height >= 44, JSON.stringify(b));
  await page.screenshot({ path: `${evidence}/${name}-small-phone.png` });
  if (await page.evaluate(() => document.fullscreenEnabled && typeof document.documentElement.requestFullscreen === 'function')) {
    await page.getByRole('button', { name: '全屏看谱' }).click();
    await expect(page.getByRole('button', { name: '退出专注' })).toBeEnabled();
    const nativeFullscreen = await page.evaluate(() => document.fullscreenElement === document.documentElement);
    if (!nativeFullscreen) await expect(page.getByRole('status')).toContainText('全屏未能开启');
    await page.getByRole('button', { name: '展开看谱控制' }).click();
    await page.getByRole('button', { name: '显示谱面' }).click();
    await page.locator('.practice-view-option').filter({ hasText: '对照' }).click();
    await expect(page.locator('.practice-notation[data-compare]')).toBeVisible();
    await expect(page.getByRole('button', { name: '退出专注' })).toBeVisible();
    if (nativeFullscreen) await expect.poll(() => page.evaluate(() => document.fullscreenElement === document.documentElement)).toBe(true);
    await page.getByRole('button', { name: '显示谱面' }).click();
    await page.locator('.practice-view-option').filter({ hasText: '重排谱面' }).click();
    await page.getByRole('button', { name: '退出专注' }).click();
    await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true);
    await expect(timeline).toBeVisible();
  }
  // Force a supported-but-rejected request, then exercise the real fallback UI.
  await page.evaluate(() => {
    Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: true });
    document.documentElement.requestFullscreen = () => Promise.reject(new Error('fixture denial'));
  });
  await page.getByRole('button', { name: /全屏看谱|专注看谱/ }).click();
  await expect(page.getByRole('status')).toContainText('全屏未能开启');
  await expect(page.getByRole('button', { name: '退出专注' })).toBeVisible();
  await page.getByRole('button', { name: '退出专注' }).click();
  await expect(timeline).toBeVisible();
  await expect(page.getByRole('button', { name: '收起看谱控制' })).toBeVisible();
  // Unsupported iPhone/PWA-like capability path: honest focus mode, no manifest changes.
  await page.evaluate(() => Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: false }));
  await page.getByRole('button', { name: '收起看谱控制' }).click();
  await page.getByRole('button', { name: '专注看谱' }).click();
  await expect(page.getByRole('status')).toContainText('此浏览器不能全屏');
  await page.getByRole('button', { name: '退出专注' }).click();
  assert.equal(fixture.diagnostics.unmatchedRequests.length, 0);
  completed = true;
  await writeFile(`${evidence}/${name}-geometry.json`, JSON.stringify({ collapsed: followedFrame, expanded, smallPhoneControls: boxes }, null, 2));
});
