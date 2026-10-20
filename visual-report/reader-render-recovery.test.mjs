import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { after, before, test } from 'node:test';
import { chromium, webkit, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { createSampleScorePdf, resolveFixtureRequest } from './fixtures.mjs';
import { startVisualServer } from './setup.mjs';

let app;
before(async () => { app = await startVisualServer({ script: 'dev' }); });
after(async () => { await app?.stop(); });
const sample = await PDFDocument.load(createSampleScorePdf());
const document = await PDFDocument.create();
for (let index = 0; index < 60; index++) document.addPage((await document.copyPages(sample, [index % 2]))[0]);
const pdf = Buffer.from(await document.save());
const score = { id: 'visual-score', choirId: 'visual-choir', fileName: 'Synthetic sixty pages.pdf', updatedAt: 1,
  currentVersion: { id: 'visual-version-1', versionNumber: 1, sizeBytes: pdf.length, sha256: createHash('sha256').update(pdf).digest('hex'), etag: 'sixty-pages', pageCount: 60, createdAt: 1 } };
const engines = process.env.READER_TEST_CHROMIUM_ONLY ? { chromium } : { chromium, webkit };
for (const [name, engine] of Object.entries(engines)) test(`${name}: high-DPR continuous scrolling keeps visible pages painted and page recovery preserves ink and position`, { timeout: 90000 }, async t => {
  const browser = await engine.launch({ headless: true, ...(name === 'chromium' && process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1200, height: 2200 }, deviceScaleFactor: 2, serviceWorkers: 'block', reducedMotion: 'reduce' });
  await page.route('**/api/**', route => route.fulfill(resolveFixtureRequest({ pathname: new URL(route.request().url()).pathname, method: route.request().method(), identity: 'member', scenarioId: 'reader-controls-narrow', pdf, selectedScore: score })));
  await page.addInitScript(() => localStorage.setItem('reader-gesture-hint-seen', 'true'));
  await page.goto(`${app.origin}/choirs/visual-choir/scores/visual-score`);
  await page.locator('[data-page-turn-current] [data-pdf-canvas-active]').waitFor();
  await page.locator('.page-reader__viewport').click({ position: { x: 600, y: 450 } });
  await page.getByRole('button', { name: '更多', exact: true }).click();
  await page.getByRole('button', { name: '连续滚动', exact: true }).click();
  const reader = page.locator('.continuous-reader');
  const painted = () => reader.evaluate(el => {
    const viewport = el.getBoundingClientRect();
    const visible = [...el.querySelectorAll('.continuous-reader__page')].filter(p => {
      const box = p.getBoundingClientRect(); return box.bottom > viewport.top && box.top < viewport.bottom;
    });
    return visible.length > 0 && visible.every(p => { const canvas = p.querySelector('[data-pdf-canvas-active]'); return canvas && canvas.width > 1 && !p.querySelector('[role=alert]'); });
  });
  const budget = () => page.evaluate(async () => (await import('/src/client/reader/render-budget.ts')).renderBudgetFacts());
  for (const top of [0, 1700, 8500, 15300, 17000, 34000, 17000, 8500, 0]) {
    await reader.evaluate((el, top) => { el.scrollTop = top; }, top);
    await expect.poll(painted).toBe(true);
    assert.ok((await budget()).residentPixels <= 24 * 1024 * 1024);
  }
  // Multiple destinations before settling exercise cancellation of stale queued renders.
  for (const top of [40000, 17000, 34000, 1700, 15300, 300]) await reader.evaluate((el, top) => { el.scrollTop = top; }, top);
  await expect.poll(painted).toBe(true);
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await page.locator('.annotation-overlay[data-editing]').waitFor();
  await page.getByRole('button', { name: '画笔', exact: true }).click();
  const editing = page.locator('.continuous-reader .annotation-overlay[data-editing]');
  const box = await editing.boundingBox();
  await page.mouse.move(box.x + 350, Math.max(150, box.y + 450));
  await page.mouse.down(); await page.mouse.move(box.x + 500, Math.max(150, box.y + 450), { steps: 10 }); await page.mouse.up();
  await expect.poll(() => editing.locator('[data-ink-stroke]').count()).toBeGreaterThan(0);
  await expect.poll(() => editing.locator('[data-ink-stroke]').last().evaluate(p => { const b = p.getBBox(); return b.x + b.width; })).toBeGreaterThan(415);
  const pageNumber = await editing.locator('svg').getAttribute('aria-label');
  const paths = await editing.locator('[data-ink-stroke]').evaluateAll(ink => ink.map(p => p.getAttribute('d')));
  const top = await reader.evaluate(el => el.scrollTop);
  const canvas = editing.locator('..').locator('[data-pdf-canvas-active]');
  await canvas.dispatchEvent('contextlost');
  await expect.poll(painted).toBe(true);
  assert.equal(await reader.evaluate(el => el.scrollTop), top);
  assert.deepEqual(await editing.locator('[data-ink-stroke]').evaluateAll(ink => ink.map(p => p.getAttribute('d'))), paths);
  await expect(page.getByRole('button', { name: '完成编辑', exact: true })).toBeVisible();
  assert.equal(await page.locator('.reader-display-recovery').count(), 0);
  const report = await page.evaluate(async () => JSON.parse((await import('/src/client/diagnostics/diagnostics.ts')).exportDiagnostics()));
  assert.ok(report.records.some(record => record.render?.reason === 'context-lost'));
  assert.doesNotMatch(JSON.stringify(report), /Synthetic sixty|visual-choir|visual-score/);
  // Persistent context failure exposes document reload, which must first finish
  // local editing. Restore the browser API before the explicit recovery action.
  await page.evaluate(() => { window.originalCanvasGetContext = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = () => null; });
  await editing.locator('..').locator('[data-pdf-canvas-active]').dispatchEvent('contextlost');
  const reload = page.getByRole('button', { name: '重新加载 PDF', exact: true }).first();
  await reload.waitFor();
  // Wait for the bounded retries to finish before repairing the injected API;
  // otherwise a slow runner could auto-recover between waitFor and click.
  await expect.poll(() => page.evaluate(async () => JSON.parse((await import('/src/client/diagnostics/diagnostics.ts')).exportDiagnostics()).records.some(record => record.render?.reason === 'canvas-unavailable' && record.render.automaticRetries === 2))).toBe(true);
  await page.evaluate(() => { HTMLCanvasElement.prototype.getContext = window.originalCanvasGetContext; });
  await reload.click();
  await expect.poll(painted).toBe(true);
  await expect.poll(() => reader.evaluate(el => el.scrollTop)).toBe(top);
  await expect.poll(() => page.getByLabel(pageNumber, {exact: true}).locator('[data-ink-stroke]').evaluateAll(ink => ink.map(p => p.getAttribute('d')))).toEqual(paths);
  assert.equal(await page.getByRole('link', {name: /下载原 PDF/}).count(), 0);
  const directory = 'artifacts/verification/reader-render-recovery';
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: `${directory}/${name}.png` });
  await writeFile(`${directory}/${name}.json`, JSON.stringify({ budget: await budget(), report }, null, 2));
});
