import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium, webkit, expect } from '@playwright/test';
import { startStorageFixture } from './storage-fixture.mjs';
import { musicXmlFixture } from './musicxml-fixture.mjs';

for (const [engine, type] of [['chromium', chromium], ['webkit', webkit]]) {
  test(`MusicXML score suppresses browser selection and context menus (${engine})`, { timeout: 120000 }, async t => {
    const fixture = await startStorageFixture({ authenticated: true, previewEntry: false });
    let browser;
    t.after(async () => { try { await browser?.close(); } finally { await fixture.stop(); } });
    browser = await type.launch();
    const context = await browser.newContext({ viewport: { width: 1024, height: 768 }, serviceWorkers: 'block' });
    await context.addInitScript(() => localStorage.setItem('reader-gesture-hint-seen', 'true'));
    assert.equal((await context.request.post(fixture.origin + '/api/auth/sign-in/email', {
      headers: { origin: fixture.origin },
      data: { email: fixture.accounts[0].email, password: fixture.accounts[0].password },
    })).status(), 200);
    const bytes = musicXmlFixture(48), id = crypto.randomUUID();
    assert.equal((await context.request.post(`${fixture.origin}/api/choirs/${fixture.choirId}/scores/${fixture.scoreId}/attachments/${id}/file?name=selection.xml&size=${bytes.length}`, {
      data: bytes, headers: { 'content-length': String(bytes.length) },
    })).status(), 201);
    const page = await context.newPage();
    await page.goto(`${fixture.origin}/choirs/${fixture.choirId}/scores/${fixture.scoreId}`);
    await expect(page.locator('canvas[data-pdf-canvas-active]').first()).toBeVisible({ timeout: 20000 });
    await page.locator('.page-reader__viewport').click({ position: { x: 400, y: 300 } });
    await page.getByRole('button', { name: '练习谱', exact: true }).click();
    await page.getByRole('button', { name: 'selection.xml', exact: true }).click();
    const player = page.getByTestId('musicxml-player');
    await expect(player.getByRole('button', { name: '播放', exact: true })).toBeEnabled({ timeout: 60000 });
    const title = page.locator('.practice-notation .at-surface svg text').filter({ hasText: '练习乐谱' }).first();
    await expect(title).toBeVisible();
    // Exercise native text selection on the rendered score, rather than only checking CSS.
    const bounds = await title.boundingBox();
    assert.ok(bounds);
    const point = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
    await page.mouse.click(point.x, point.y, { clickCount: 3 });
    const selected = await page.evaluate(() => window.getSelection()?.toString() ?? '');
    await page.evaluate(() => {
      window.getSelection()?.removeAllRanges();
      document.addEventListener('contextmenu', event => { window.__scoreMenuPrevented = event.defaultPrevented; });
    });
    await page.mouse.click(point.x, point.y, { button: 'right' });
    const menuPrevented = await page.evaluate(() => window.__scoreMenuPrevented);
    assert.deepEqual({ selected, menuPrevented }, { selected: '', menuPrevented: true });
    await expect(title).toHaveCSS('user-select', 'none');
    // iOS callouts are separate; desktop Playwright WebKit does not expose this property.
    if (await page.evaluate(() => CSS.supports('-webkit-touch-callout', 'none'))) {
      await expect(title).toHaveCSS('-webkit-touch-callout', 'none');
    } else {
      t.diagnostic('Native iOS touch callouts require device verification; this engine does not support -webkit-touch-callout.');
    }
    await expect(page.locator('.practice-notation-scroll')).toHaveCSS('touch-action', 'pan-x pan-y');
  });
}
