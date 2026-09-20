import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium, webkit, expect } from '@playwright/test';
import { startVisualServer } from './setup.mjs';
import { createVisualFixtureSession } from './fixtures.mjs';

for (const [engineName, engine] of Object.entries({ chromium, webkit })) {
  test(`${engineName}: layer rename and deletion controls remain reachable on narrow screens`, async t => {
    const app = await startVisualServer({ script: 'dev' });
    const browser = await engine.launch();
    t.after(async () => { await browser.close(); await app.stop(); });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', reducedMotion: 'reduce' });
    const fixture = createVisualFixtureSession();
    await page.route('**/api/**', async route => {
      const request = route.request(), pathname = new URL(request.url()).pathname;
      const result = fixture.resolve({ pathname, method: request.method(), identity: 'admin', cookie: '' });
      if ((pathname.endsWith('/layers') || pathname.endsWith('/sync')) && request.method() === 'GET') {
        const body = JSON.parse(result.body);
        const readerLayers = pathname.endsWith('/sync') ? body.layers : body;
        const own = readerLayers.layers.find(layer => layer.kind === 'personal');
        readerLayers.layers.push({ ...own, id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: '成员分享的演出笔记', canEdit: false, canShare: false, sharing: true });
        result.body = JSON.stringify(body);
      }
      await route.fulfill(result);
    });
    await page.addInitScript(() => localStorage.setItem("reader-gesture-hint-seen", "true"));
    await page.goto(`${app.origin}/choirs/visual-choir/scores/visual-score`);
    await page.locator('.pdf-page-canvas [data-pdf-canvas-active]').first().waitFor();
    const viewport = page.locator('.page-reader__viewport');
    const bounds = await viewport.boundingBox();
    await viewport.click({ position: { x: bounds.width / 2, y: bounds.height / 2 } });
    await page.getByRole('button', { name: '笔记图层', exact: true }).click();
    await page.getByRole('checkbox', { name: '显示 成员分享的演出笔记' }).waitFor();
    for (const width of [320, 390, 834]) {
      await page.setViewportSize({ width, height: 844 });
      const panel = page.locator('.reader-layer-panel');
      assert.ok(await panel.evaluate(element => element.scrollWidth <= element.clientWidth), `panel overflow at ${width}`);
    }
    await page.setViewportSize({ width: 834, height: 1400 });
    await page.setViewportSize({ width: 390, height: 844 });
    const actions = page.getByRole('tab', { name: '管理', exact: true });
    await expect(page.getByRole('button', { name: '重命名 我的笔记' })).toHaveCount(0);
    await actions.click();
    await expect(page.getByRole('switch', { name: '分享 我的笔记' })).toBeVisible();
    await expect(page.getByRole('checkbox', { name: '显示 我的笔记', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: '重命名 我的笔记', exact: true }).scrollIntoViewIfNeeded();
    await page.getByRole('button', { name: '重命名 我的笔记', exact: true }).click();
    const input = page.getByRole('textbox', { name: '我的笔记的名称' });
    await expect(input).toBeFocused();
    const inputBounds = await input.boundingBox();
    assert.ok(inputBounds.y >= 0 && inputBounds.y + inputBounds.height <= 844);
    await input.press('Escape');
    await page.getByRole('button', { name: '删除 我的笔记', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '确认删除此层' })).toBeVisible();
    const confirmBounds = await page.getByRole('button', { name: '确认删除', exact: true }).boundingBox();
    assert.ok(confirmBounds.width >= 44 && confirmBounds.height >= 44);
    await page.getByRole('dialog', { name: '确认删除此层' }).getByRole('button', { name: '取消' }).click();
    await expect(page.getByRole('button', { name: '删除 我的笔记', exact: true })).toBeFocused();
    await page.getByRole('tab', { name: '显示', exact: true }).click();
    await expect(page.getByRole('checkbox', { name: '显示 我的笔记', exact: true })).toBeVisible();
  });
}
