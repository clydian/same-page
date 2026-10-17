import { selectPracticeView } from './practice-controls.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, readFile } from 'node:fs/promises';
import { chromium, webkit, expect } from '@playwright/test';
import { startStorageFixture } from './storage-fixture.mjs';
import { musicXmlFixture } from './musicxml-fixture.mjs';

for (const [engine, type] of [['chromium', chromium], ['webkit', webkit]]) test(`comparison keeps independent PDF and XML viewports (${engine})`, { timeout: 180000 }, async t => {
  const realPdf = process.env.COMPARE_PDF;
  const fixture = await startStorageFixture({ authenticated: true, previewEntry: false, ...(realPdf ? { pdf: await readFile(realPdf) } : {}) });
  let browser;
  t.after(async () => { try { await browser?.close(); } finally { await fixture.stop(); } });
  browser = await type.launch();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', hasTouch: true });
  await context.addInitScript(() => localStorage.setItem('reader-gesture-hint-seen', 'true'));
  await context.request.post(fixture.origin + '/api/auth/sign-in/email', { headers: { origin: fixture.origin }, data: { email: fixture.accounts[0].email, password: fixture.accounts[0].password } });
  const bytes = process.env.COMPARE_XML ? await readFile(process.env.COMPARE_XML) : musicXmlFixture(128), id = crypto.randomUUID();
  assert.equal((await context.request.post(`${fixture.origin}/api/choirs/${fixture.choirId}/scores/${fixture.scoreId}/attachments/${id}/file?name=compare.xml&size=${bytes.length}`, { data: bytes, headers: { 'content-length': String(bytes.length) } })).status(), 201);
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.stack ?? error.message));
  await page.goto(`${fixture.origin}/choirs/${fixture.choirId}/scores/${fixture.scoreId}`);
  await expect(page.locator('canvas[data-pdf-canvas-active]').first()).toBeVisible({ timeout: 20000 });
  await page.locator('.page-reader__viewport').click({ position: { x: 180, y: 200 } });
  await page.getByRole('button', { name: '练习谱', exact: true }).click();
  await page.getByRole('button', { name: 'compare.xml', exact: true }).click();
  const bar = page.getByTestId('musicxml-player');
  await expect(bar.getByRole('button', { name: '播放', exact: true })).toBeEnabled({ timeout: 60000 });
  const progress = bar.getByRole('slider', { name: '播放进度', exact: true });
  await progress.fill('8');
  await selectPracticeView(page, '原始 PDF');
  await page.locator('.reader-shell').getByRole('button', { name: /展开页码网格/ }).click();
  await page.getByRole('button', { name: '第 2 页', exact: true }).click();
  await expect(page.locator('.reader-shell').getByLabel('页面位置')).toContainText('2 /');
  await selectPracticeView(page, '对照');
  const pdf = page.getByRole('region', { name: '对照原始 PDF', exact: true });
  const xml = page.getByRole('region', { name: 'MusicXML 谱面', exact: true });
  const separator = page.getByRole('separator');
  await expect(pdf.locator('canvas[data-pdf-canvas-active]').first()).toBeVisible();
  await expect(separator).toHaveAttribute('aria-valuenow', '50');
  await expect(pdf.getByLabel('页面位置')).toContainText('2 /');
  await expect(progress).toHaveValue('8');
  if (realPdf) {
    await pdf.getByRole('button', { name: /展开页码网格/ }).click();
    await page.getByRole('button', { name: '第 3 页', exact: true }).click();
    await expect(pdf.locator('[data-page-number="3"] canvas[data-pdf-canvas-active]')).toBeVisible();
    await expect(pdf.locator('.continuous-reader')).toHaveAttribute('data-zoom', '1');
  }
  const screenshot = async name => {
    if (!process.env.COMPARE_SCREENSHOTS || engine !== 'chromium') return;
    await mkdir(process.env.COMPARE_SCREENSHOTS, { recursive: true });
    await expect(xml.locator('.at-surface svg').first()).toBeVisible();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.screenshot({ path: `${process.env.COMPARE_SCREENSHOTS}/${name}.png` });
  };
  for (const [width, height, direction, name] of [[390,844,'horizontal','mobile'],[820,1180,'horizontal','ipad-portrait'],[1440,1000,'vertical','desktop'],[1180,820,'vertical','ipad-landscape'],[844,390,'vertical','mobile-landscape'],[320,740,'horizontal','small-mobile']]) {
    await page.setViewportSize({ width, height });
    await expect(separator).toHaveAttribute('aria-orientation', direction);
    await expect(page.locator('html')).toHaveAttribute('data-practice-split', direction === 'horizontal' ? 'rows' : 'columns');
    await expect(separator).toHaveAttribute('aria-valuenow', '50');
    await expect.poll(async () => {
      const a = await pdf.boundingBox(), b = await xml.boundingBox();
      return Math.abs(direction === 'horizontal' ? a.height - b.height : a.width - b.width);
    }).toBeLessThan(2);
    const a = await pdf.boundingBox(), b = await xml.boundingBox(), bottom = await bar.boundingBox();
    assert.ok(a.y >= 44 && b.y >= 44 && a.y + a.height <= bottom.y + 1 && b.y + b.height <= bottom.y + 1);
    assert.ok(a.x >= 0 && b.x >= 0 && a.x + a.width <= width + 1 && b.x + b.width <= width + 1, JSON.stringify({width,height,a,b}));
    await expect.poll(() => xml.locator('.at-surface svg').count()).toBeGreaterThan(0);
    await screenshot(name);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(separator).toHaveAttribute('aria-orientation', 'horizontal');
  // Pointer dragging, keyboard, reset, separate orientation preferences.
  await expect.poll(async () => { const a = await pdf.boundingBox(), b = await xml.boundingBox(); return Math.abs(a.height-b.height); }).toBeLessThan(2);
  const handle = await separator.boundingBox();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down(); await page.mouse.move(195, handle.y + 80, { steps: 10 }); await page.mouse.up();
  await expect.poll(async () => Number(await separator.getAttribute('aria-valuenow'))).toBeGreaterThan(55);
  await separator.press('Enter'); await expect(separator).toHaveAttribute('aria-valuenow', '50');
  await separator.press('ArrowDown'); await expect(separator).toHaveAttribute('aria-valuenow', '55');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(separator).toHaveAttribute('aria-orientation', 'vertical');
  await expect(separator).toHaveAttribute('aria-valuenow', '50');
  await separator.press('ArrowRight'); await expect(separator).toHaveAttribute('aria-valuenow', '55');
  await page.setViewportSize({ width: 390, height: 844 });
  // Both saved directions are 55% here; wait for the new axis before its reset.
  await expect(separator).toHaveAttribute('aria-orientation', 'horizontal');
  await expect(separator).toHaveAttribute('aria-valuenow', '55');
  await separator.press('Enter');
  if (engine === 'chromium') {
    await expect.poll(async () => { const a = await pdf.boundingBox(), b = await xml.boundingBox(); return Math.abs(a.height - b.height); }).toBeLessThan(2);
    const box = await separator.boundingBox(), cdp = await context.newCDPSession(page);
    const x = Math.round(box.x + box.width/2), y = Math.round(box.y + box.height/2);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
    for (let offset = 10; offset <= 60; offset += 10) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + offset, id: 1 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
    await expect.poll(async () => Number(await separator.getAttribute('aria-valuenow'))).toBeGreaterThan(55);
    await separator.press('Enter');
  }
  // Scrolling PDF must neither seek nor suspend XML following.
  const xmlScroll = xml.locator('.practice-notation-scroll'), pdfScroll = pdf.locator('.continuous-reader');
  await pdfScroll.evaluate(e => { e.scrollTop = 0; });
  await expect.poll(() => pdfScroll.evaluate(e => e.scrollTop)).toBeLessThan(2);
  const beforePdf = await pdfScroll.evaluate(e => e.scrollTop);
  await pdfScroll.hover(); await page.mouse.wheel(0, 180);
  await expect.poll(() => pdfScroll.evaluate(e => e.scrollTop)).toBeGreaterThan(beforePdf + 150);
  await expect(page.getByRole('button', { name: '恢复自动跟随', exact: true })).toHaveCount(0);
  await expect(progress).toHaveValue('8');
  const pdfTop = await pdfScroll.evaluate(e => e.scrollTop);
  const beforeXml = await xmlScroll.evaluate(e => e.scrollTop);
  await xmlScroll.hover(); await page.mouse.wheel(0, 240);
  await expect.poll(() => xmlScroll.evaluate(e => e.scrollTop)).toBeGreaterThan(beforeXml + 200);
  await expect(page.getByRole('button', { name: '恢复自动跟随', exact: true })).toBeVisible();
  const xmlTop = await xmlScroll.evaluate(e => e.scrollTop);
  await selectPracticeView(page, '原始 PDF');
  await expect(page.locator('.page-reader__viewport')).toBeVisible();
  await selectPracticeView(page, '对照');
  await expect.poll(() => pdfScroll.evaluate(e => e.scrollTop)).toBe(pdfTop);
  await expect.poll(() => xmlScroll.evaluate(e => e.scrollTop)).toBe(xmlTop);
  await expect(progress).toHaveValue('8');
  // Playback continues through view changes and geometry changes.
  await bar.getByRole('button', { name: '播放', exact: true }).click();
  await expect(bar.getByRole('button', { name: '暂停', exact: true })).toBeVisible();
  await expect.poll(() => progress.inputValue(), { timeout: 15000 }).not.toBe('8');
  await selectPracticeView(page, '重排谱面');
  await selectPracticeView(page, '对照');
  await expect(bar.getByRole('button', { name: '暂停', exact: true })).toBeVisible();
  await separator.press('ArrowDown');
  await expect(bar.getByRole('button', { name: '暂停', exact: true })).toBeVisible();
  await bar.getByRole('button', { name: '暂停', exact: true }).click();
  await page.getByRole('button', { name: '结束播放', exact: true }).click();
  await expect(page.locator('.practice-comparison-pdf')).toHaveCount(0);
  await expect(page.locator('.page-reader__viewport')).toBeVisible();
  // Pixel minimums allow ratios outside 20–80% on desktop. Every selectable
  // ratio must survive disposing/reopening the actual playback session.
  await page.setViewportSize({ width: 1440, height: 1000 });
  const openComparison = async () => {
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const entry = page.getByRole('button', { name: '练习谱', exact: true });
    if (!await entry.isVisible()) await page.locator('.page-reader__viewport').click();
    await entry.click();
    await page.getByRole('button', { name: 'compare.xml', exact: true }).click();
    await expect(bar.getByRole('button', { name: '播放', exact: true })).toBeEnabled({ timeout: 60000 });
    await selectPracticeView(page, '对照');
    await expect(separator).toHaveAttribute('aria-orientation', 'vertical');
  };
  await openComparison();
  for (const key of ['Home', 'End']) {
    await separator.press(key);
    const saved = await separator.getAttribute('aria-valuenow');
    assert.ok(key === 'Home' ? Number(saved) < 20 : Number(saved) > 80);
    await page.getByRole('button', { name: '结束播放', exact: true }).click();
    await expect(bar).toHaveCount(0);
    await openComparison();
    await expect(separator).toHaveAttribute('aria-valuenow', saved);
    await expect(progress).toHaveValue('0');
  }
  await page.getByRole('button', { name: '结束播放', exact: true }).click();
  assert.deepEqual(errors, []);
});
