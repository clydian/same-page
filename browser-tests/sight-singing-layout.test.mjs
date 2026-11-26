import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium, expect } from '@playwright/test';
import { musicXmlFixture } from './musicxml-fixture.mjs';
import { startStorageFixture } from './storage-fixture.mjs';

test('sight singing keeps score scope, scroll direction and bottom controls independent', { timeout: 90000 }, async t => {
  const fixture = await startStorageFixture({ authenticated: true, previewEntry: false });
  let browser;
  t.after(async () => { try { await browser?.close(); } finally { await fixture.stop(); } });
  browser = await chromium.launch();
  const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 320, height: 650 }, serviceWorkers: 'block' });
  const { email, password } = fixture.accounts[0];
  const login = await context.request.post(`${fixture.origin}/api/auth/sign-in/email`, {
    headers: { origin: fixture.origin }, data: { email, password },
  });
  assert.equal(login.status(), 200);
  const page = await context.newPage();
  await page.goto(`${fixture.origin}/choirs/${fixture.choirId}`);
  await page.locator('button.drive-avatar').click();
  await page.getByRole('menuitem', { name: '视唱挑战' }).click();
  await page.getByRole('button', { name: '新建题目' }).click();
  await page.locator('select[name=source]').selectOption('upload');
  await page.locator('input[type=file]').setInputFiles({ name: '示例.musicxml', mimeType: 'application/xml', buffer: musicXmlFixture(24) });
  await page.locator('input[name=title]').fill('视唱布局测试');
  await page.getByRole('button', { name: '发布到云盘' }).click();

  const scope = page.getByRole('combobox', { name: '谱面范围' });
  const direction = page.getByRole('combobox', { name: '滚动方向' });
  const score = page.locator('.challenge-notation');
  const graph = page.locator('.challenge-graph');
  const controls = page.locator('.challenge-controls');
  const note = page.locator('.challenge-notation-note');
  const contextNote = note.and(page.locator('[data-focused-part=false]'));
  await expect(scope).toHaveValue('part');
  await expect(direction).toHaveValue('vertical');
  await expect(note).toHaveCount(24);
  await expect.poll(() => score.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
  await score.evaluate(el => { el.scrollTop = el.scrollHeight; });
  await expect.poll(() => score.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  const before = await controls.boundingBox();
  const bottom = before.y + before.height;
  assert(Math.abs(bottom - 650) <= 1);
  const tallScore = (await score.boundingBox()).height;

  await scope.selectOption('full');
  await expect(direction).toHaveValue('vertical');
  await expect(contextNote).toHaveCount(24);
  await direction.selectOption('horizontal');
  await expect(scope).toHaveValue('full');
  await expect(contextNote).toHaveCount(24);
  await expect.poll(() => score.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
  await scope.selectOption('part');
  await expect(direction).toHaveValue('horizontal');
  await expect(note).toHaveCount(24);
  await expect(contextNote).toHaveCount(0);
  await direction.selectOption('vertical');
  await expect(note).toHaveCount(24);

  const togglePitch = async () => {
    await page.getByRole('button', { name: '练习设置' }).click();
    await page.getByRole('switch', { name: '音高轨迹' }).press('Space');
    await page.getByRole('button', { name: '关闭', exact: true }).click();
  };
  await togglePitch();
  await expect(graph).toBeVisible();
  const sheetBox = await score.boundingBox(), pitchBox = await graph.boundingBox(), controlsBox = await controls.boundingBox();
  assert(sheetBox.height < tallScore && sheetBox.height > 0);
  assert(sheetBox.y + sheetBox.height <= pitchBox.y);
  assert(pitchBox.y + pitchBox.height <= controlsBox.y);
  assert(Math.abs(controlsBox.y + controlsBox.height - bottom) <= 1);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 320);
  await togglePitch();
  await expect(graph).toHaveCount(0);
  assert.equal((await score.boundingBox()).height, tallScore);
});
