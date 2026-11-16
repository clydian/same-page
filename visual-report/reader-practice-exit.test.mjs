import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { chromium, webkit, expect } from '@playwright/test';
import { startProductionPreview } from './production-preview.mjs';
import { createVisualFixtureSession } from './fixtures.mjs';

let server;
before(async () => { server = await startProductionPreview(); }, { timeout: 240000 });
after(async () => { await server?.stop(); });

for (const name of (process.env.PRACTICE_TEST_ENGINES?.split(',') ?? ['chromium', 'webkit'])) test(`${name}: XML exit restores PDF thumbnails and reading position`, async t => {
  const browser = await ({ chromium, webkit })[name].launch({ headless: true, ...(name === 'chromium' && process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, reducedMotion: 'reduce', locale: 'zh-CN', serviceWorkers: 'block' });
  const fixture = createVisualFixtureSession({ id: 'reader-practice-exit', dense: true, buildId: server.buildId });
  await page.addInitScript(() => localStorage.setItem('reader-gesture-hint-seen', 'true'));
  await page.route('**/api/**', route => route.fulfill(fixture.resolve({ pathname: new URL(route.request().url()).pathname, method: route.request().method(), identity: 'member', cookie: route.request().headers().cookie ?? '' })));
  const evidence = `artifacts/verification/reader-practice-exit/${name}`;
  await mkdir(evidence, { recursive: true });
  const states = [];
  const record = async label => {
    states.push({ label, ...await page.evaluate(() => ({ position: document.querySelector('[aria-label="页面位置"]')?.textContent, thumbnails: document.querySelectorAll('.page-preview-strip__thumbnail').length, stripWidth: document.querySelector('.page-preview-strip')?.clientWidth, max: document.querySelector('.page-preview-strip__slider')?.max, shell: document.querySelector('.reader-shell')?.dataset, pages: [...document.querySelectorAll('.page-reader__sheet')].map(el => el.dataset.pageNumber) })) });
    console.log(states.at(-1));
    await page.screenshot({ path: `${evidence}/${label}.png` });
    await writeFile(`${evidence}/states.json`, JSON.stringify(states, null, 2));
  };
  await page.goto(`${server.origin}/choirs/visual-choir/scores/visual-score`);
  await page.locator('.page-reader__sheet[data-page-turn-current] [data-pdf-canvas-active]').waitFor();
  await page.locator('.page-reader__viewport').click();
  await page.getByRole('slider', { name: '跳转页码' }).fill('3');
  await page.getByRole('slider', { name: '跳转页码' }).press('ArrowRight');
  await page.locator('.page-reader__sheet[data-page-turn-current][data-page-number="4"]').waitFor();
  await expect(page.locator('.page-preview-strip__thumbnail')).toHaveCount(8);
  const shell = await page.locator('.reader-shell').elementHandle();
  const pdfRequests = () => fixture.diagnostics.requests.filter(request => request.pathname.endsWith('/pdf')).length;
  const initialPdfRequests = pdfRequests();
  await record('before');
  for (let cycle = 1; cycle <= 2; cycle++) {
    await page.getByRole('button', { name: '练习谱', exact: true }).click();
    await page.getByRole('button', { name: '声部练习版.musicxml', exact: true }).click();
    await page.locator('.practice-notation[data-visible] .at-surface').waitFor();
    await expect(page.getByRole('button', { name: '播放', exact: true })).toBeEnabled();
    await record(`xml-${cycle}`);
    if (cycle === 2) {
      for (const view of ['原始 PDF', '对照', '重排谱面']) {
        await page.getByRole('button', { name: '显示谱面', exact: true }).click();
        await page.locator('.practice-view-option').filter({ hasText: view }).click();
        if (view !== '重排谱面') await expect(page.locator('.reader-shell').getByLabel('页面位置')).toHaveText('4 / 8');
      }
      await page.getByRole('button', { name: '收起练习控制', exact: true }).click();
    }
    await page.getByRole('button', { name: '退出练习', exact: true }).click();
    await expect(page.locator('.practice-bar')).toHaveCount(0);
    await page.locator('.page-preview-strip').waitFor();
    await expect(page.locator('.reader-shell').getByLabel('页面位置')).toHaveText('4 / 8');
    await expect(page.locator('.page-preview-strip__thumbnail')).toHaveCount(8);
    await expect(page.getByRole('slider', { name: '跳转页码' })).toHaveAttribute('max', '8');
    await expect(page.locator('.page-reader__sheet[data-page-turn-current]')).toHaveAttribute('data-page-number', '4');
    assert.equal(await shell.evaluate(element => element === document.querySelector('.reader-shell')), true);
    assert.equal(pdfRequests(), initialPdfRequests);
    await record(`exit-${cycle}`);
    await expect(page.locator('.reader-shell')).toBeFocused();
    await page.getByRole('button', { name: '展开页码网格：第 4 页，共 8 页' }).click();
    await expect(page.getByRole('dialog', { name: '页面总览' }).getByRole('button', { name: /^第 \d+ 页$/ })).toHaveCount(8);
    await page.getByRole('button', { name: '关闭页面总览' }).click();
  }
  assert.equal(fixture.diagnostics.unmatchedRequests.length, 0);
});
