import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import test from 'node:test';
import { chromium, webkit, expect } from '@playwright/test';
import { startConnectionFixture } from './connection-fixture.mjs';

for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
  test(`${name}: real same-session host-only cookies`, { timeout: 120_000 }, async t => {
    const fixture = await startConnectionFixture();
    const { origins } = fixture;
    t.after(() => fixture.stop());
    const browser = await engine.launch(name === "chromium" && process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}); t.after(() => browser.close());
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', ignoreHTTPSErrors: true }); t.after(() => context.close());
    const page = await context.newPage();
    await page.goto(origins.direct + '/login');
    const status = await page.evaluate(async account => (await fetch('/api/_entry/direct/auth/sign-in/email', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(account),
    })).status, { email: fixture.accounts[0].email, password: fixture.accounts[0].password });
    assert.equal(status, 200);
    await page.goto(`${origins.direct}/choirs/${fixture.choirId}`);
    await expect(page.locator('.file-row__open').first()).toBeVisible();
    await page.getByRole('button', { name: /^连接线路/ }).click();
    await expect.poll(() => page.evaluate(async () => Object.values((await import('/src/client/connection/connection.ts')).connections.getSnapshot().identity).every(value => value === 'ready'))).toBe(true);
    await expect(page.getByText('当前线路：直连')).toBeVisible();
    await mkdir('artifacts/verification/issue-580', { recursive: true });
    await page.screenshot({ path: `artifacts/verification/issue-580/${name}-mobile-panel.png` });
    const cookies = await context.cookies();
    assert.ok(cookies.some(cookie => cookie.name === '__Host-same_page_entry' && cookie.domain === new URL(origins.backup).hostname && cookie.httpOnly && cookie.secure));
    assert.ok(cookies.filter(cookie => cookie.name.includes('session_token') || cookie.name === '__Host-same_page_entry').every(cookie => !cookie.domain.startsWith('.')));
  });
}
