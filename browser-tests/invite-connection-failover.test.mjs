import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium, webkit, expect } from '@playwright/test';
import { startConnectionFixture } from './connection-fixture.mjs';

for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
  test(`${name}: invitation entry survives a stalled direct response and bounds two failed routes`, { timeout: 120_000 }, async t => {
    const fixture = await startConnectionFixture({ invite: true }); t.after(() => fixture.stop());
    const browser = await engine.launch(); t.after(() => browser.close());
    const { origins, network } = fixture;
    const posts = route => network.traffic.filter(item => item.method === 'POST' && item.path.startsWith(`/api/_entry/${route}/guest/session`)).length;
    for (const scenario of ['recheck', 'headers', 'body', 'both', 'manual', 'cancel']) {
      await t.test(scenario, async () => {
        const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', ignoreHTTPSErrors: true });
        let releaseRecheck;
        try {
          network.admissionFaults.direct = scenario === 'body' ? 'body' : 'headers';
          network.admissionFaults.backup = scenario === 'both' ? 'headers' : null;
          network.traffic.length = 0;
          const page = await context.newPage();
          let sessionReads = 0;
          if (scenario === 'recheck') {
            const held = new Promise(resolve => { releaseRecheck = resolve; });
            await page.route(/\/auth\/get-session(?:\?|$)/, async route => {
              if (route.request().method() === 'GET' && ++sessionReads > 1) await held;
              await route.continue();
            });
          }
          if (scenario === 'body') {
            // This is the same invitation URL encoded by a QR card. Its secret
            // fragment is cleared before admission; never log or screenshot it.
            await page.goto(`${origins.direct}/?join=1#${new URLSearchParams({ invite: fixture.joinCode })}`);
            await expect(page.getByRole('button', { name: '正在验证…', exact: true })).toBeVisible();
          } else {
            await page.goto(origins.direct + '/drives');
            if (scenario === 'manual') {
              await page.getByRole('button', { name: /^连接线路/ }).click();
              await page.getByRole('radio', { name: '直连', exact: true }).check();
              await page.getByRole('button', { name: '关闭连接面板' }).click();
            }
            const input = page.getByRole('textbox', { name: '邀请码', exact: true });
            await input.fill(fixture.joinCode);
            if (scenario === 'recheck') {
              const entered = await input.inputValue();
              await page.getByRole('button', { name: /^连接线路/ }).click();
              await expect.poll(() => sessionReads).toBeGreaterThan(1);
              await page.getByRole('button', { name: '关闭连接面板' }).click();
              assert.equal(await input.inputValue() === entered, true, 'pending recheck must retain the invitation');
              await expect(page.getByRole('button', { name: '进入云盘', exact: true })).toBeDisabled();
              assert.equal(posts('direct') + posts('backup'), 0);
              releaseRecheck();
              await expect(page.getByRole('button', { name: '进入云盘', exact: true })).toBeEnabled();
              assert.equal(await input.inputValue() === entered, true, 'settled recheck must retain the invitation');
            }
            await page.getByRole('button', { name: '进入云盘', exact: true }).click();
          }
          if (scenario === 'cancel') {
            await page.goto(origins.direct + '/about');
            await page.waitForTimeout(4500);
            assert.equal(posts('backup'), 0, 'navigation cancellation must not retry admission');
            assert.equal(new URL(page.url()).pathname, '/about');
          } else if (scenario === 'both' || scenario === 'manual') {
            await expect(page.getByRole('alert')).toContainText('连接超时', { timeout: 10_000 });
            assert.equal((await page.getByRole('textbox', { name: '邀请码', exact: true }).inputValue()).replace('-', '') === fixture.joinCode, true, 'failed admission must retain the invitation');
            await expect(page.getByRole('button', { name: '进入云盘', exact: true })).toBeEnabled();
            assert.equal(posts('direct'), 1);
            assert.equal(posts('backup'), scenario === 'manual' ? 0 : 1);
          } else {
            await expect(page.locator('.file-row__open').first()).toBeVisible({ timeout: 12_000 });
            assert.equal(new URL(page.url()).pathname, `/choirs/${fixture.choirId}`);
            assert.equal(new URL(page.url()).hash, '');
            assert.equal(posts('direct'), 1); assert.equal(posts('backup'), 1);
            assert.equal(await page.evaluate(async () => (await import('/src/client/connection/connection.ts')).connections.getSnapshot().active), 'backup');
          }
        } finally { releaseRecheck?.(); await context.close(); }
      });
    }
  });
}
