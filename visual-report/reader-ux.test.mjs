import { after, before, test } from 'node:test';
import { expect } from '@playwright/test';
import { chromium, webkit } from 'playwright';
import { PDFDocument } from 'pdf-lib';
import { createHash } from 'node:crypto';
import { createSampleScorePdf, resolveFixtureRequest } from './fixtures.mjs';
import { startVisualServer } from './setup.mjs';

let server;
before(async () => { server = await startVisualServer({ script: 'dev' }); });
after(async () => { await server?.stop(); });
const source = await PDFDocument.load(createSampleScorePdf());
const document = await PDFDocument.create();
for (let i = 0; i < 8; i++) document.addPage((await document.copyPages(source, [i % 2]))[0]);
const pdf = Buffer.from(await document.save());
const selectedScore = { id: 'visual-score', choirId: 'visual-choir', fileName: 'Eight pages.pdf', updatedAt: 1,
  currentVersion: { id: 'visual-version-1', versionNumber: 1, sizeBytes: pdf.length, sha256: createHash('sha256').update(pdf).digest('hex'), etag: 'eight-pages', pageCount: 8, createdAt: 1 } };
async function open(t, engine = chromium) {
  const browser = await engine.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 834, height: 700 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
  await page.route('**/api/**', route => route.fulfill(resolveFixtureRequest({ pathname: new URL(route.request().url()).pathname,
    method: route.request().method(), identity: 'member', scenarioId: 'reader-ux', pdf, selectedScore })));
  await page.addInitScript(() => {
    localStorage.setItem('reader-gesture-hint-seen', 'true');
    localStorage.setItem('reader-edit-page-gesture-seen', 'true');
    localStorage.setItem('reader-edit-continuous-gesture-seen', 'true');
  });
  await page.goto(`${server.origin}/choirs/visual-choir/scores/visual-score`);
  await page.locator('[data-page-turn-current] [data-pdf-canvas-active]').waitFor();
  await page.locator('.page-reader__viewport').click();
  return page;
}

for (const [engineName, engine] of Object.entries({ chromium, webkit })) {
  for (const editing of [false, true]) test(`${engineName}: resizing continuous ${editing ? 'editing' : 'reading'} preserves page and paper position`, async t => {
    const page = await open(t, engine);
    await page.getByRole('button', { name: '更多', exact: true }).click();
    await page.getByRole('button', { name: '连续滚动', exact: true }).click();
    const reader = page.locator('.continuous-reader');
    // Scroll to the middle of page 6 without requesting whole-page fitting.
    await reader.evaluate(el => { el.scrollTop = (el.scrollHeight - el.clientHeight) * .7; });
    await expect(page.getByRole('slider', { name: '跳转页码' })).not.toHaveValue('1');
    const current = Number(await page.getByRole('slider', { name: '跳转页码' }).inputValue());
    const paper = reader.locator(`.continuous-reader__page[data-index="${current - 1}"] .annotated-pdf-page`);
    const anchor = () => paper.evaluate(el => {
      const box = el.getBoundingClientRect(), viewport = el.closest('.continuous-reader').getBoundingClientRect();
      return (viewport.top + viewport.height / 2 - box.top) / box.height;
    });
    const position = await anchor();
    if (editing) await page.getByRole('button', { name: '编辑', exact: true }).click();
    for (const viewport of [{ width: 1194, height: 834 }, { width: 834, height: 1194 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      await expect.poll(async () => Math.abs(await anchor() - position)).toBeLessThan(.025);
      if (editing) await expect(reader.locator('.annotation-overlay[data-editing]').getByRole('img', { name: `第 ${current} 页笔记层`, exact: true })).toBeVisible();
      else await expect(page.getByRole('slider', { name: '跳转页码' })).toHaveValue(String(current));
    }
  });
}

test('page grid selects a numbered page and Escape returns without turning', async t => {
  const page = await open(t);
  const trigger = page.getByRole('button', { name: /展开页码网格/ });
  await trigger.click({ timeout: 5000 });
  const grid = page.getByRole('dialog', { name: '页面总览' });
  await grid.getByRole('button', { name: '第 7 页', exact: true }).click();
  await expect(grid).not.toBeVisible();
  await expect(page.locator('[data-page-turn-current]')).toHaveAttribute('data-page-number', '7');
  await trigger.click();
  await expect(grid.getByRole('button', { name: '第 7 页', exact: true })).toHaveAttribute('aria-current', 'page');
  await page.keyboard.press('Escape');
  await expect(grid).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await expect(page.getByRole('slider', { name: '跳转页码' })).toHaveValue('7');
});

test('editing keeps gesture guidance and reflects available history without collapsing tools', async t => {
  const page = await open(t);
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  const hint = page.locator('.reader-edit-gesture-hint__detail');
  await expect(hint).toBeVisible();
  await expect(hint).toHaveText('·双指左右翻页');
  const undo = page.getByRole('button', { name: '撤销', exact: true });
  const redo = page.getByRole('button', { name: '重做', exact: true });
  await expect(undo).toBeDisabled();
  await expect(redo).toBeDisabled();
  for (const name of ['选择', '画笔', '荧光笔', '橡皮', '文字', '矩形', '椭圆']) await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
  await page.getByLabel('第 1 页笔记层', { exact: true }).click({ position: { x: 200, y: 250 } });
  await page.getByRole('textbox', { name: '笔记文本' }).fill('排练提示');
  await expect(hint).not.toBeVisible();
  await page.getByRole('textbox', { name: '笔记文本' }).press('Escape');
  await expect(undo).toBeEnabled();
  await undo.click();
  await expect(undo).toBeDisabled();
  await expect(redo).toBeEnabled();
  await redo.click();
  await expect(redo).toBeDisabled();
  await expect(undo).toBeEnabled();
  await expect(hint).toBeVisible();
});
