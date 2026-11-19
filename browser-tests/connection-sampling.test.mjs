import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import test from 'node:test';
import { chromium, webkit, expect } from '@playwright/test';
import { startConnectionFixture } from './connection-fixture.mjs';
import { verifyConnectionHistory } from './connection-history.mjs';

for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
  test(`${name}: live health samples, browser offline signal and keyboard details`, { timeout: 120_000 }, async t => {
    const fixture = await startConnectionFixture(); t.after(() => fixture.stop());
    const browser = await engine.launch(name === 'chromium' && process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}); t.after(() => browser.close());
    const context = await browser.newContext({ viewport: { width: 320, height: 760 }, ignoreHTTPSErrors: true, serviceWorkers: 'block', reducedMotion: 'reduce', isMobile: true, hasTouch: true }); t.after(() => context.close());
    const page = await context.newPage();
    await page.clock.install();
    await page.goto(fixture.origins.direct + '/login');
    assert.equal(await page.evaluate(async account => (await fetch('/api/_entry/direct/auth/sign-in/email', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(account) })).status, fixture.accounts[0]), 200);
    await page.goto(`${fixture.origins.direct}/choirs/${fixture.choirId}`);
    await expect(page.locator('.file-row__open').first()).toBeVisible();
    await page.getByRole('button', { name: /^连接线路/ }).click();
    const snapshot = () => page.evaluate(async () => (await import('/src/client/connection/connection.ts')).connections.getSnapshot());
    await expect.poll(async () => (await snapshot()).samples.direct.length).toBe(1);
    await expect.poll(async () => (await snapshot()).identity.backup).toBe('ready');
    await expect(page.getByText('当前线路：直连', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '重新检测', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '恢复连接', exact: true })).toHaveCount(0);
    assert.equal(await page.locator('.connection-dialog').evaluate(el => el.scrollWidth <= el.clientWidth), true);
    await expect(page.locator('.connection-spinner')).toHaveCount(0);
    assert.equal(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), true);
    // A real browser offline event changes the immediate platform signal while
    // the panel still truthfully retains its previous discrete health sample.
    // Do not override navigator or return a fake successful offline response.
    const sampledBeforeOffline = (await snapshot()).samples.direct.at(-1);
    await context.setOffline(true);
    await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
    await expect(page.locator('.connection-current')).toContainText('浏览器离线');
    const help = page.getByText('状态与连接帮助', { exact: true });
    const explanation = page.getByText(/线路检测只确认服务能否响应/);
    await expect(explanation).toBeHidden();
    await help.focus(); await page.keyboard.press('Enter');
    await expect(explanation).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(explanation).toBeHidden();
    await expect(page.getByRole('button', { name: /连接线路，浏览器离线/ })).toBeVisible();
    await expect(page.locator('.connection-health').filter({ hasText: '线路可达' })).toHaveCount(2);
    assert.deepEqual((await snapshot()).samples.direct.at(-1), sampledBeforeOffline);
    await mkdir('artifacts/verification/connection-sampling', { recursive: true });
    await page.screenshot({ path: `artifacts/verification/connection-sampling/${name}-offline-previous-success.png` });
    await page.clock.fastForward(10_000);
    await expect.poll(async () => (await snapshot()).samples.direct.at(-1)?.state).toBe('unreachable');
    await expect(page.locator('.connection-health').filter({ hasText: '暂时连不上' })).toHaveCount(2);
    await context.setOffline(false);
    await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(true);
    await page.evaluate(async () => (await import('/src/client/connection/connection.ts')).connections.sample(new AbortController().signal));
    await expect(page.locator('.connection-current')).not.toContainText('浏览器离线');
    await expect(page.locator('.connection-health').filter({ hasText: '线路可达' })).toHaveCount(2);
    await expect.poll(async () => (await snapshot()).checking || (await snapshot()).preparing).toBe(false);
    await mkdir('artifacts/verification/connection-sampling', { recursive: true });
    await page.screenshot({ path: `artifacts/verification/connection-sampling/${name}-320.png` });
    const details = page.getByLabel(/^直连检测详情/);
    await details.focus(); await page.keyboard.press('Enter');
    await expect(page.getByText(/仅代表各次检测/).first()).toBeVisible();
    await page.screenshot({ path: `artifacts/verification/connection-sampling/${name}-details.png` });
    await page.keyboard.press('Enter');
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.screenshot({ path: `artifacts/verification/connection-sampling/${name}-desktop.png` });
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: '连接线路', exact: true })).toHaveCount(0);
    const samples = (await snapshot()).samples.direct.length;
    await page.clock.fastForward(11_000);
    assert.equal((await snapshot()).samples.direct.length, samples);
    await verifyConnectionHistory(page, name);
  });
}
