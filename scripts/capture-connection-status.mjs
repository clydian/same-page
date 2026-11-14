import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, expect } from '@playwright/test';

// Run in the selected source worktree. The fixture alone seeds synthetic
// membership, operator authority and a dev-only release catalog. No app DOM,
// navigator getter, health response or identity state is patched for the capture.
const [variant, outputDirectory] = process.argv.slice(2);
assert.ok(['before', 'after'].includes(variant));
assert.ok(outputDirectory && path.isAbsolute(outputDirectory));
process.env.SAME_PAGE_RELEASE_CHANNELS = '1';
const { startConnectionFixture } = await import(pathToFileURL(path.join(process.cwd(), 'browser-tests/connection-fixture.mjs')).href);
const source = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const fixture = await startConnectionFixture({ productAdmin: true, releaseChannels: true });
let browser;
const shots = [];
try {
  browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {});
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, ignoreHTTPSErrors: true, serviceWorkers: 'block', reducedMotion: 'reduce', isMobile: true, hasTouch: true });
  context.setDefaultTimeout(15_000);
  const page = await context.newPage();
  let adminRequests = 0, channelPosts = 0;
  page.on('request', request => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.endsWith('/admin/session')) adminRequests++;
    if (pathname.endsWith('/client-release') && request.method() === 'POST') channelPosts++;
  });
  await page.clock.install();
  await page.goto(fixture.origins.direct + '/login');
  const login = await page.evaluate(async account => (await fetch('/api/_entry/direct/auth/sign-in/email', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(account) })).status, fixture.accounts[1]);
  assert.equal(login, 200);
  await page.goto(`${fixture.origins.direct}/choirs/${fixture.choirId}`);
  await expect(page.locator('.file-row__open').first()).toBeVisible();
  // Load the real About module and let the dev SW registration deadline settle
  // while online; later SPA navigation needs no uncached module during outage.
  await page.getByRole('button', { name: '我的', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: '产品后台', exact: true })).toBeVisible();
  await page.getByRole('menuitem', { name: /^关于与更新/ }).click();
  await expect(page.getByRole('button', { name: /^测试版/ })).toBeVisible();
  await page.clock.fastForward(31_000);
  await expect(page.getByRole('button', { name: /^测试版/ })).toBeEnabled();
  await page.goBack();
  await expect(page.locator('.file-row__open').first()).toBeVisible();
  await page.getByRole('button', { name: '我的', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: '产品后台', exact: true })).toBeVisible();
  await mkdir(outputDirectory, { recursive: true });
  const shot = async (name, locator) => {
    const filename = `${variant}-${name}.png`;
    if (locator) await locator.screenshot({ path: path.join(outputDirectory, filename) });
    else await page.screenshot({ path: path.join(outputDirectory, filename) });
    shots.push(filename);
  };
  await page.clock.runFor(250);
  if (variant === 'before') await shot('online-menu', page.getByRole('menu'));
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /^连接线路/ }).click();
  const snapshot = () => page.evaluate(async () => (await import('/src/client/connection/connection.ts')).connections.getSnapshot());
  await expect.poll(async () => (await snapshot()).samples.direct.at(-1)?.state).toBe('reachable');
  await expect.poll(async () => (await snapshot()).checking || (await snapshot()).preparing).toBe(false);
  await expect(page.locator('.connection-health').filter({ hasText: variant === 'before' ? '可连接' : '线路可达' })).toHaveCount(2);
  await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now() + 1000)));
  const lastSuccess = (await snapshot()).samples.direct.at(-1);
  await context.setOffline(true);
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
  assert.deepEqual((await snapshot()).samples.direct.at(-1), lastSuccess);
  await shot('offline-panel');
  await page.clock.resume();
  await page.getByRole('button', { name: '关闭连接面板' }).click();
  if (variant === 'after') {
    await expect(page.getByRole('button', { name: /连接线路，浏览器离线/ })).toBeVisible();
    const notice = await page.locator('.drive-connection-notice').boundingBox();
    const entry = await page.getByRole('button', { name: /连接线路，浏览器离线/ }).boundingBox();
    assert.ok(notice && entry && notice.y + notice.height <= entry.y, 'offline notice must not overlap the connection entry');
    await shot('offline-entry');
  }
  const adminRequestsBeforeMenu = adminRequests;
  await page.getByRole('button', { name: '我的', exact: true }).click();
  await expect(page.getByRole('menu')).toBeVisible();
  await expect(page.getByRole('menuitem', { name: '产品后台', exact: true })).toHaveCount(0);
  assert.equal(adminRequests, adminRequestsBeforeMenu);
  await page.clock.runFor(250);
  if (variant === 'before') await shot('offline-menu');
  await page.getByRole('menuitem', { name: /^关于与更新/ }).click();
  await expect(page.getByText('当前离线，请联网后重试。', { exact: true })).toBeVisible();
  const postsBeforeSelection = channelPosts;
  await page.getByRole('button', { name: /^测试版/ }).click();
  await expect(page.getByText('当前离线，请联网后再切换版本。', { exact: true })).toBeVisible();
  assert.equal(channelPosts, postsBeforeSelection);
  await shot('offline-channel', page.locator('.release-channel-picker'));
  await writeFile(path.join(outputDirectory, `${variant}-capture.json`), JSON.stringify({ source, browser: browser.version(), viewport: { width: 390, height: 844 }, scenario: 'isolated fixture; actual browser offline after a successful health sample', serviceWorkers: 'block', clock: 'paused after one second to make both versions comparable; not evidence of sustained fresh success', navigatorOnline: false, healthSample: 'same previous successful sample', productAdmin: 'synthetic operator confirmed online; no new admin request after offline', channel: 'synthetic local catalog; offline selection blocked before POST', shots }, null, 2) + '\n');
  console.log(JSON.stringify({ variant, source, shots, adminGateVerified: true, channelGateVerified: true }));
} finally {
  await browser?.close();
  await fixture.stop();
}
