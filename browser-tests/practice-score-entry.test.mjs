import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir } from 'node:fs/promises';
import { chromium, webkit, expect } from '@playwright/test';
import { startStorageFixture } from './storage-fixture.mjs';
import { musicXmlFixture } from './musicxml-fixture.mjs';
import { practiceWave } from '../visual-report/practice-fixture.mjs';

for (const [engine, type] of [['chromium', chromium], ['webkit', webkit]]) {
  test(`generated practice marker, attachment counts and XML-only reader (${engine})`, { timeout: 180000 }, async t => {
    const fixture = await startStorageFixture({ authenticated: true, previewEntry: false });
    let browser;
    t.after(async () => { try { await browser?.close(); } finally { await fixture.stop(); } });
    browser = await type.launch();
    const context = await browser.newContext({ viewport: { width: 1024, height: 768 }, serviceWorkers: 'block' });
    const signedIn = await context.request.post(`${fixture.origin}/api/auth/sign-in/email`, {
      headers: { origin: fixture.origin }, data: { email: fixture.accounts[0].email, password: fixture.accounts[0].password },
    });
    assert.equal(signedIn.status(), 200);
    const base = `${fixture.origin}/api/choirs/${fixture.choirId}/scores/${fixture.scoreId}/attachments`;
    const upload = async (name, content, generated = false) => {
      const bytes = Buffer.from(content), id = crypto.randomUUID();
      const query = new URLSearchParams({ name, size: String(bytes.length), ...(generated ? { source: 'generated' } : {}) });
      const response = await context.request.post(`${base}/${id}/file?${query}`, { data: bytes });
      assert.equal(response.status(), 201, await response.text());
      return id;
    };
    const generated = await upload('后台文件名.musicxml', musicXmlFixture(), true);
    const page = await context.newPage();
    await page.addInitScript(() => localStorage.setItem('reader-gesture-hint-seen', 'true'));
    const library = `${fixture.origin}/choirs/${fixture.choirId}`;
    const reader = `${library}/scores/${fixture.scoreId}`;
    // A legacy worker/cache summary has the total count but no new display fields.
    await page.route(url => url.pathname === `/api/choirs/${fixture.choirId}/bootstrap`, async route => {
      const response = await route.fetch();
      const body = await response.json();
      for (const score of body.scores ?? []) { delete score.hasGeneratedXml; delete score.musicXmlCount; }
      await route.fulfill({ response, json: body });
    });
    const output = 'artifacts/verification/practice-score-entry';
    await mkdir(output, { recursive: true });
    await page.goto(library);
    await expect(page.getByRole('img', { name: '有自动生成练习版', exact: true })).toBeVisible();
    await expect(page.getByText('自动练习版', { exact: true })).toHaveCount(0);
    const preparation = page.getByRole('button', { name: '暂时不用，关闭排练准备', exact: true });
    if (await preparation.isVisible()) await preparation.click();
    await expect(page.locator('.attachment-count')).toHaveCount(0);
    await page.screenshot({ path: `${output}/${engine}-library-generated-only.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: `${output}/${engine}-library-mobile.png` });
    await page.locator('.library-workspace').screenshot({ path: `${output}/${engine}-library-detail.png` });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'library fits mobile');
    const user = await upload('女高声部练习.musicxml', musicXmlFixture());
    await upload('排练录音.wav', practiceWave());
    await page.reload();
    const attachments = page.getByRole('button', { name: /2 个附件/ });
    await expect(attachments).toBeVisible();
    await attachments.click();
    await expect(page.getByRole('button', { name: '女高声部练习.musicxml', exact: true })).toBeVisible();
    await expect(page.locator('.attachment-list')).not.toContainText('后台文件名');
    await expect(page.locator('.attachment-list')).toContainText('排练录音.wav');
    await page.screenshot({ path: `${output}/${engine}-library-attachments.png` });
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto(reader);
    await expect(page.locator('canvas[data-pdf-canvas-active]').first()).toBeVisible();
    const reveal = async () => {
      if (await page.locator('.reader-shell').getAttribute('data-chrome-visible') === null) {
        const viewport = page.locator('.page-reader__viewport');
        const box = await viewport.boundingBox();
        await viewport.click({ position: { x: box.width / 2, y: box.height / 2 } });
      }
    };
    await reveal();
    await page.getByRole('button', { name: '练习谱', exact: true }).click();
    const panel = page.getByRole('dialog', { name: '练习谱', exact: true });
    await expect(panel.getByRole('button', { name: '自动生成练习版', exact: true })).toBeVisible();
    await expect(panel.getByRole('button', { name: '女高声部练习.musicxml', exact: true })).toBeVisible();
    await expect(panel).not.toContainText('排练录音');
    assert.equal(await panel.locator('.reader-practice-source').first().getAttribute('aria-label'), '自动生成练习版');
    await page.screenshot({ path: `${output}/${engine}-reader-practice.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: `${output}/${engine}-reader-mobile.png` });
    await panel.getByRole('button', { name: '自动生成练习版', exact: true }).click();
    const bar = page.getByRole('region', { name: '乐谱练习' });
    await expect(bar.getByRole('button', { name: '播放', exact: true })).toBeEnabled({ timeout: 60000 });
    await page.screenshot({ path: `${output}/${engine}-generated-player.png` });
    await page.getByRole('button', { name: '结束播放', exact: true }).click();
    for (const id of [generated, user]) assert.equal((await context.request.delete(`${base}/${id}?expectedRevision=1`)).status(), 204);
    let staleSummaryServed = false;
    await page.route(url => url.pathname === `/api/choirs/${fixture.choirId}/scores/${fixture.scoreId}/sync`, async route => {
      const response = await route.fetch();
      const body = await response.json();
      if (body.score) { body.score.musicXmlCount = 1; body.score.attachmentCount = 2; staleSummaryServed = true; }
      await route.fulfill({ response, json: body });
    });
    await page.reload();
    await expect.poll(() => staleSummaryServed).toBe(true);
    await expect(page.locator('canvas[data-pdf-canvas-active]').first()).toBeVisible();
    await reveal();
    await expect(page.getByRole('button', { name: '编辑', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '练习谱', exact: true })).toHaveCount(0);
    await page.goto(library);
    await expect(page.getByRole('button', { name: /1 个附件/ })).toBeVisible();
    await expect(page.getByRole('img', { name: '有自动生成练习版', exact: true })).toHaveCount(0);
  });
}
