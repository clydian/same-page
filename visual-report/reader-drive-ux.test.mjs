import { test } from 'node:test';
import { chromium, webkit, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { createHash } from 'node:crypto';
import { createSampleScorePdf, createVisualFixtureSession } from './fixtures.mjs';
import { startVisualServer } from './setup.mjs';

const source = await PDFDocument.load(createSampleScorePdf());
const document = await PDFDocument.create();
for (let i = 0; i < 40; i++) document.addPage((await document.copyPages(source, [i % 2]))[0]);
const pdf = Buffer.from(await document.save());
for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) test(`${name}: cold pickers keep pressed actions stable, long-score controls stay separate and first-open layers own Escape`, async t => {
  const app = await startVisualServer({ script: 'dev' });
  t.after(() => app.stop());
  const browser = await engine.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, serviceWorkers: 'block' });
  const fixture = createVisualFixtureSession({ id: 'reader-practice-ux', multipleSources: true });
  let finishDirectory;
  const directoryReady = new Promise(resolve => { finishDirectory = resolve; });
  await page.route('**/api/**', async route => {
    const request = route.request(), pathname = new URL(request.url()).pathname;
    const result = fixture.resolve({ pathname, method: request.method(), identity: 'member' });
    if (pathname.endsWith('/sync')) {
      const body = JSON.parse(result.body);
      body.score.currentVersion = { ...body.score.currentVersion, pageCount: 40, sizeBytes: pdf.length, sha256: createHash('sha256').update(pdf).digest('hex') };
      result.body = JSON.stringify(body);
    }
    if (pathname.endsWith('/pdf')) result.body = pdf;
    if (pathname === '/api/choirs') await directoryReady;
    return route.fulfill(result);
  });
  await page.addInitScript(() => localStorage.setItem('reader-gesture-hint-seen', 'true'));
  await page.goto(`${app.origin}/choirs/visual-choir`);
  await page.getByRole('button', { name: /^切换云盘/ }).click();
  const picker = page.getByRole('dialog', { name: '切换云盘', exact: true });
  const create = picker.getByRole('button', { name: '创建云盘', exact: true });
  const before = await create.boundingBox();
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
  await page.mouse.down();
  finishDirectory();
  await expect(picker.getByRole('link', { name: /示例云盘/ })).toBeVisible();
  expect((await create.boundingBox()).y).toBe(before.y);
  await page.mouse.up();
  await page.getByRole('dialog', { name: '创建云盘', exact: true }).getByRole('button', { name: '取消', exact: true }).click();
  await expect(picker).toBeVisible();
  // Reopening with the now-known single drive is compact and leaves the row intact.
  expect((await picker.boundingBox()).height).toBeLessThan(300);
  const row = await picker.getByRole('link', { name: /示例云盘/ }).boundingBox();
  expect(row.height).toBeGreaterThanOrEqual(72);
  await picker.getByRole('button', { name: '关闭云盘选择' }).click();
  await page.goto(`${app.origin}/choirs/visual-choir/scores/visual-score`);
  await page.locator('[data-pdf-canvas-active]').first().waitFor();
  await page.locator('.page-reader__viewport').click();
  const practice = page.getByRole('button', { name: '练习谱', exact: true });
  await expect(practice).toBeVisible();
  for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 568 }, { width: 844, height: 390 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport);
    await expect.poll(async () => {
      const a = await practice.boundingBox(), b = await page.getByRole('navigation', { name: '页面缩略图' }).boundingBox();
      return a && b ? b.y - (a.y + a.height) : -1;
    }).toBeGreaterThanOrEqual(11);
  }
  // This must be the first opening: loading the lazy panel previously lost focus to body.
  const trigger = page.getByRole('button', { name: '笔记图层', exact: true });
  await trigger.click();
  await expect(page.getByRole('button', { name: '关闭笔记显示' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: '笔记图层', exact: true })).toHaveCount(0);
  await expect(trigger).toBeFocused();
  // A normal browser Back consumes only the open layer; it keeps this score.
  await trigger.click();
  await page.goBack();
  await expect(page.getByRole('dialog', { name: '笔记图层', exact: true })).toHaveCount(0);
  await expect(page).toHaveURL(/\/scores\/visual-score$/);
});
