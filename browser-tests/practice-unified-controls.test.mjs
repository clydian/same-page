import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, readFile } from 'node:fs/promises';
import { chromium, webkit, expect } from '@playwright/test';
import { startStorageFixture } from './storage-fixture.mjs';
import { musicXmlFixture } from './musicxml-fixture.mjs';
import { selectPracticeView, changeNotationSize } from './practice-controls.mjs';

for (const [engine, type] of [['chromium', chromium], ['webkit', webkit]]) test(`unified controls and centered playback across all views (${engine})`, { timeout: 180000 }, async t => {
  const fixture = await startStorageFixture({ authenticated: true, previewEntry: false, ...(process.env.COMPARE_PDF ? { pdf: await readFile(process.env.COMPARE_PDF) } : {}) });
  let browser;
  t.after(async () => { try { await browser?.close(); } finally { await fixture.stop(); } });
  browser = await type.launch(engine === 'chromium' && process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? {executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH} : {});
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', hasTouch: true });
  await context.addInitScript(() => localStorage.setItem('reader-gesture-hint-seen', 'true'));
  await context.request.post(fixture.origin + '/api/auth/sign-in/email', { headers: { origin: fixture.origin }, data: { email: fixture.accounts[0].email, password: fixture.accounts[0].password } });
  const bytes = process.env.COMPARE_XML ? await readFile(process.env.COMPARE_XML) : musicXmlFixture(64), id = crypto.randomUUID();
  assert.equal((await context.request.post(`${fixture.origin}/api/choirs/${fixture.choirId}/scores/${fixture.scoreId}/attachments/${id}/file?name=practice.xml&size=${bytes.length}`, { data: bytes, headers: { 'content-length': String(bytes.length) } })).status(), 201);
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${fixture.origin}/choirs/${fixture.choirId}/scores/${fixture.scoreId}`);
  await expect(page.locator('canvas[data-pdf-canvas-active]').first()).toBeVisible({ timeout: 20000 });
  await page.locator('.page-reader__viewport').click({ position: { x: 180, y: 200 } });
  if (process.env.COMPARE_PDF) {
    await page.getByRole('button', { name: /展开页码网格/ }).click();
    await page.getByRole('button', { name: '第 4 页', exact: true }).click();
    await expect(page.getByLabel('页面位置')).toContainText('4 /');
  }
  await page.getByRole('button', { name: '练习谱', exact: true }).click();
  await page.getByRole('button', { name: 'practice.xml', exact: true }).click();
  const bar = page.getByTestId('musicxml-player'), header = page.getByRole('banner', { name: '练习看谱' });
  await expect(bar.getByRole('button', { name: '播放', exact: true })).toBeEnabled({ timeout: 60000 });
  const progress = bar.getByRole('slider', { name: '播放进度', exact: true });
  await progress.fill('8');
  await expect(bar.getByRole('button', { name: '定位小节', exact: true })).toHaveText('9');
  await bar.getByRole('button', { name: '定位小节', exact: true }).click();
  const locator = page.getByRole('dialog', { name: '定位小节', exact: true });
  await expect(locator.getByRole('slider', { name: '目标小节', exact: true })).toHaveAttribute('aria-valuetext', '第 9 小节');
  await locator.getByRole('slider', { name: '目标小节', exact: true }).fill('10');
  await expect(progress).toHaveValue('8'); // Draft navigation never seeks until applied.
  await locator.getByRole('button', { name: '跳转', exact: true }).click();
  await expect(progress).toHaveValue('10');
  await expect(bar.getByRole('button', { name: '定位小节', exact: true })).toBeFocused();
  await progress.fill('8');
  await bar.getByRole('combobox', { name: '速度', exact: true }).selectOption('0.75');
  for (const [device, width, height] of [['mobile',390,844], ['desktop',1440,1000], ['small-mobile',320,740]]) {
    await page.setViewportSize({ width, height });
    for (const [view, name] of [['pdf','原始 PDF'], ['xml','重排谱面'], ['compare','对照']]) {
      await selectPracticeView(page, name);
      await expect(progress).toHaveValue('8');
      await expect(bar.getByRole('combobox', { name: '速度', exact: true })).toHaveValue('0.75');
      await expect.poll(async () => { const b = await bar.getByRole('button', { name: '播放', exact: true }).boundingBox(); return Math.abs(b.x + b.width / 2 - width / 2); }).toBeLessThan(1);
      assert.ok((await header.boundingBox()).height <= 56, 'the shared header never wraps');
      if (view === 'compare') {
        const tools = await page.locator('.practice-notation-tools').boundingBox(), pane = await page.locator('.practice-notation').boundingBox();
        assert.ok(tools.x >= pane.x && tools.y >= pane.y && tools.x + tools.width <= pane.x + pane.width, 'engraving controls belong to the XML pane');
      }
      if (view !== 'pdf') {
        const zoom = page.getByRole('button', { name: '谱面大小', exact: true });
        await expect(zoom).toHaveText('60%');
        await changeNotationSize(page, '放大谱面');
        await expect(zoom).toHaveText('70%');
        await changeNotationSize(page, '恢复默认谱面大小');
        const paper = page.locator('.practice-notation-scroll');
        const a = await paper.boundingBox(), section = await page.locator('.practice-notation').boundingBox();
        assert.ok(Math.abs(a.y - section.y) < 1, 'floating controls do not reserve a title row');
      }
      if (engine === 'chromium' && device !== 'small-mobile' && view !== 'pdf') {
        await mkdir('artifacts/verification/issue-468', { recursive: true });
        await page.screenshot({ path: `artifacts/verification/issue-468/${device}-${view}.png` });
      }
      const targets = await page.locator('.practice-header button,.practice-bar button,.practice-bar select').evaluateAll(elements => elements.map(e => e.getBoundingClientRect().toJSON()));
      assert.ok(targets.every(b => b.x >= 0 && b.right <= width + 1 && b.height >= 44));
      if (process.env.COMPARE_SCREENSHOTS && engine === 'chromium' && device !== 'small-mobile') {
        await mkdir(process.env.COMPARE_SCREENSHOTS, { recursive: true });
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        await header.click({ position: { x: width / 2, y: 24 } });
        await page.screenshot({ path: `${process.env.COMPARE_SCREENSHOTS}/${device}-${view}.png` });
      }
    }
  }
  await page.getByRole('button', { name: '结束练习', exact: true }).click();
  await expect(bar).toHaveCount(0);
  assert.deepEqual(errors, []);
});
