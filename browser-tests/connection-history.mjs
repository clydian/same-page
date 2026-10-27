import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { expect } from '@playwright/test';

// Synthetic health outcomes only; called by the live-panel browser test so
// both engines reuse its local Worker fixture and keep the CI shard budget.
export async function verifyConnectionHistory(page, name) {
  await page.setViewportSize({ width: 320, height: 900 });
  const startCounts = await page.evaluate(async () => {
    const { samples } = (await import('/src/client/connection/connection.ts')).connections.getSnapshot();
    return { direct: samples.direct.length, backup: samples.backup.length };
  });
  const startCount = startCounts.direct;
  let outcomes = { direct: true, backup: true }, release;
  let held = null;
  await page.route(/\/api\/_entry\/(direct|backup)\/health$/, async route => {
    const entry = new URL(route.request().url()).pathname.includes('/direct/') ? 'direct' : 'backup';
    if (held) await held;
    await route.fulfill({ status: outcomes[entry] ? 200 : 503, contentType: 'application/json', body: JSON.stringify({ status: outcomes[entry] ? 'ok' : 'unavailable' }) });
  });
  await page.getByRole('button', { name: /^连接线路/ }).click();
  const samples = () => page.evaluate(async () => (await import('/src/client/connection/connection.ts')).connections.getSnapshot().samples);
  await expect.poll(async () => (await samples()).direct.length).toBe(startCount + 1);
  await expect(page.locator('.connection-spinner')).toHaveCount(0);
  const sequence = [
    { direct: false, backup: true },
    { direct: true, backup: true },
    { direct: true, backup: false },
    { direct: false, backup: false },
    { direct: true, backup: true },
  ];
  for (const [i, result] of sequence.entries()) {
    outcomes = result;
    await page.clock.fastForward(10_000);
    await expect.poll(async () => { const state = await samples(); return [state.direct.length, state.backup.length]; }).toEqual([startCounts.direct + i + 2, startCounts.backup + i + 2]);
  }
  const history = await samples();
  assert.deepEqual(history.direct.slice(-6).map(sample => sample.state), ['reachable', 'unreachable', 'reachable', 'reachable', 'unreachable', 'reachable']);
  await expect(page.locator('.connection-trail i[data-result="unreachable"]')).toHaveCount(history.direct.filter(s => s.state === 'unreachable').length + history.backup.filter(s => s.state === 'unreachable').length);
  await mkdir('artifacts/verification/connection-sampling', { recursive: true });
  await page.screenshot({ path: `artifacts/verification/connection-sampling/${name}-mixed-320.png` });
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.clock.fastForward(65_000);
  assert.equal((await samples()).direct.length, startCount + 6, 'a paused gap must not create samples');
  held = new Promise(resolve => { release = resolve; });
  await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
  await expect(page.getByText('结果已过期', { exact: true })).toHaveCount(2);
  await expect(page.getByText('检测已过期', { exact: true })).toHaveCount(2);
  assert.equal(await page.locator('.connection-dialog').evaluate(el => el.scrollWidth <= el.clientWidth), true);
  await page.screenshot({ path: `artifacts/verification/connection-sampling/${name}-mixed-stale-320.png` });
  await page.getByLabel(/^直连检测详情/).click();
  await expect(page.getByText(/间隔不等/).first()).toBeVisible();
  await expect(page.locator('.connection-samples').first().locator('ol li')).toHaveCount(startCount + 6);
  await expect(page.locator('.connection-samples').first().locator('time').first()).toHaveAttribute('datetime', new Date(history.direct.at(-1).at).toISOString());
  await page.screenshot({ path: `artifacts/verification/connection-sampling/${name}-mixed-stale-details.png` });
  held = null; release();
  await expect.poll(async () => { const state = await samples(); return [state.direct.length, state.backup.length]; }).toEqual([startCounts.direct + 7, startCounts.backup + 7]);
  const resumed = await samples();
  assert.ok(resumed.direct.at(-1).at - resumed.direct.at(-2).at >= 65_000);
  await expect(page.getByText('结果已过期', { exact: true })).toHaveCount(0);
  await expect(page.locator('.connection-spinner')).toHaveCount(0);
  await page.screenshot({ path: `artifacts/verification/connection-sampling/${name}-mixed-gap-details.png` });
  // Real component freshness arbitration: a later probe can replace the
  // display evidence from an old business failure without clearing cooldown.
  await page.getByRole('radio', { name: '备用', exact: true }).check();
  await expect(page.locator('.connection-spinner')).toHaveCount(0);
  // A route sample records each completed response separately. Await the
  // whole round so an older in-flight response cannot become newer evidence
  // after the synthetic business failure below. This preserves the assertion.
  await page.evaluate(async () => { const { connections } = await import('/src/client/connection/connection.ts'); await connections.sample(new AbortController().signal); });
  await page.route('**/api/_entry/backup/choirs', route => route.abort('failed'));
  await page.clock.fastForward(1000);
  const failure = await page.evaluate(async () => {
    const { connections } = await import('/src/client/connection/connection.ts');
    let failed = false;
    await connections.fetch('/api/choirs').catch(() => { failed = true; });
    const state = connections.getSnapshot();
    return { failed, active: state.active, mode: state.mode, attempting: state.attempting, business: state.health.backup, sample: state.samples.backup.at(-1) };
  });
  assert.equal(failure.failed, true, JSON.stringify(failure));
  assert.equal(failure.business.state, 'unreachable', JSON.stringify(failure));
  assert.ok(failure.business.checkedAt >= failure.sample.at, JSON.stringify(failure));
  await expect(page.getByText('当前线路：备用（暂时连不上）', { exact: true })).toBeVisible();
  await page.clock.fastForward(1000);
  await page.evaluate(async () => { const { connections } = await import('/src/client/connection/connection.ts'); await connections.sample(new AbortController().signal); });
  await expect(page.getByText('当前线路：备用', { exact: true })).toBeVisible();
  assert.equal(await page.evaluate(async () => (await import('/src/client/connection/connection.ts')).connections.getSnapshot().health.backup.state), 'unreachable');
  await page.screenshot({ path: `artifacts/verification/connection-sampling/${name}-newer-probe.png` });
  await page.getByRole('button', { name: '关闭连接面板' }).click();
}
