import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, webkit, expect } from '@playwright/test';
import { startStorageFixture } from './storage-fixture.mjs';
import { musicXmlFixture } from './musicxml-fixture.mjs';

// Real application, local Worker and original XML fixture. Insets are synthetic;
// these checks cannot prove iOS/Android status-bar hit testing or installed PWA behavior.
for (const [engine, type] of [['chromium', chromium], ['webkit', webkit]]) {
  test(`${engine}: practice panels keep close controls and long settings inside safe areas`, { timeout: 120000 }, async t => {
    const fixture = await startStorageFixture({ authenticated: true, previewEntry: false });
    let browser;
    t.after(async () => { try { await browser?.close(); } finally { await fixture.stop(); } });
    browser = await type.launch(engine === 'chromium' && process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {});
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, serviceWorkers: 'block' });
    await context.addInitScript(() => localStorage.setItem('reader-gesture-hint-seen', 'true'));
    const login = await context.request.post(`${fixture.origin}/api/auth/sign-in/email`, { headers: { origin: fixture.origin }, data: { email: fixture.accounts[0].email, password: fixture.accounts[0].password } });
    assert.equal(login.status(), 200);
    const bytes = musicXmlFixture(32), id = crypto.randomUUID();
    const upload = await context.request.post(`${fixture.origin}/api/choirs/${fixture.choirId}/scores/${fixture.scoreId}/attachments/${id}/file?name=practice.xml&size=${bytes.length}`, { data: bytes, headers: { 'content-length': String(bytes.length) } });
    assert.equal(upload.status(), 201);
    const page = await context.newPage(), errors = [], measurements = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${fixture.origin}/choirs/${fixture.choirId}/scores/${fixture.scoreId}`);
    await expect(page.locator('canvas[data-pdf-canvas-active]').first()).toBeVisible({ timeout: 20000 });
    await page.locator('.page-reader__viewport').click({ position: { x: 180, y: 200 } });
    await page.getByRole('button', { name: '练习谱', exact: true }).click();
    await page.getByRole('button', { name: 'practice.xml', exact: true }).click();
    const bar = page.getByTestId('musicxml-player');
    await expect(bar.getByRole('button', { name: '播放', exact: true })).toBeEnabled({ timeout: 60000 });
    const evidence = `artifacts/verification/practice-panel-safe-area/${engine}`;
    await mkdir(evidence, { recursive: true });
    const cdp = engine === 'chromium' ? await context.newCDPSession(page) : null;
    const setViewport = async ({ width, height, top = 0, right = 0, bottom = 0, left = 0 }) => {
      await page.setViewportSize({ width, height });
      // CDP additionally exercises env(), used by the dock, in Chromium. Both
      // engines exercise the application's --safe-* layout contract.
      if (cdp) await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top, right, bottom, left } });
      await page.evaluate(insets => { for (const [edge, value] of Object.entries(insets)) document.documentElement.style.setProperty(`--safe-${edge}`, `${value}px`); }, { top, right, bottom, left });
    };
    const geometry = () => page.evaluate(() => {
      const popover = document.querySelector('.practice-popover'), close = popover.querySelector('header button');
      const box = close.getBoundingClientRect(), hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      return { panel: popover.getBoundingClientRect().toJSON(), title: popover.querySelector('header strong').getBoundingClientRect().toJSON(), close: box.toJSON(), closeHit: close === hit || close.contains(hit), outerScroll: popover.scrollTop };
    });
    const safe = async insets => {
      await expect.poll(async () => {
        const { panel, close, closeHit } = await geometry();
        return panel.top >= (insets.top ?? 0) + 11 && panel.left >= (insets.left ?? 0) + 11 && panel.right <= insets.width - (insets.right ?? 0) - 11 && panel.bottom <= insets.height - (insets.bottom ?? 0) - 11 && close.top >= panel.top && close.bottom <= panel.bottom && close.width >= 44 && close.height >= 44 && closeHit;
      }, { message: `safe, clickable practice panel at ${JSON.stringify(insets)}` }).toBe(true);
    };
    const settlePanel = () => page.locator('.practice-popover').evaluate(async element => {
      let previous = '', stable = 0;
      for (let frame = 0; frame < 60 && stable < 4; frame++) {
        await new Promise(requestAnimationFrame);
        const box = element.getBoundingClientRect(), current = [box.x, box.y, box.width, box.height].join(':');
        stable = current === previous ? stable + 1 : 0;
        previous = current;
      }
      if (stable < 4) throw new Error('Practice panel did not settle after viewport change');
    });
    await bar.getByRole('button', { name: '练习设置', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '练习设置', exact: true });
    await dialog.getByRole('button', { name: '声部混音', exact: true }).click();
    for (const name of ['声部关注', '片段循环', '首调数字']) await dialog.getByRole('switch', { name, exact: true }).locator('xpath=ancestor::label').click();
    const content = dialog.locator('.practice-panel-content'), close = dialog.getByRole('button', { name: '关闭练习设置', exact: true });
    // Keep the panel open across rotation, safe-area changes and desktop resize.
    for (const insets of [
      { name: 'portrait', width: 390, height: 844, top: 59, bottom: 34 },
      { name: 'landscape', width: 844, height: 390, left: 59, right: 59, bottom: 21 },
      { name: 'narrow-landscape', width: 568, height: 320, top: 24, left: 59, right: 59, bottom: 21 },
      { name: 'desktop', width: 1440, height: 900 },
    ]) {
      await setViewport(insets);
      await expect(dialog).toBeVisible();
      await safe(insets);
      await content.evaluate(element => { element.scrollTop = 0; });
      // A previous position can already satisfy the new (larger) safe area.
      // Wait for Aria/ResizeObserver rotation layout before comparing scrolling.
      await settlePanel();
      const before = await geometry();
      await page.screenshot({ path: `${evidence}/${insets.name}.png` });
      await content.locator(':scope > :last-child').scrollIntoViewIfNeeded();
      await expect.poll(() => content.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
      await safe(insets);
      const after = await geometry();
      assert.equal(after.close.top, before.close.top, 'scrolling content must leave the close button in place');
      assert.equal(after.title.top, before.title.top, 'scrolling content must leave the title in place');
      assert.equal(after.outerScroll, 0, 'only the panel body scrolls');
      await close.click({ trial: true });
      const last = await content.locator(':scope > :last-child').boundingBox(), body = await content.boundingBox();
      assert.ok(last.y >= body.y && last.y + last.height <= body.y + body.height + 1, 'last setting remains reachable');
      measurements.push({ ...insets, before, after });
      await page.screenshot({ path: `${evidence}/${insets.name}-scrolled.png` });
    }
    await close.click();
    await expect(dialog).toHaveCount(0);
    await expect(bar.getByRole('button', { name: '练习设置', exact: true })).toBeFocused();
    // Short panels use the same boundary and scrolling primitive.
    const narrow = { width: 320, height: 568, top: 44, bottom: 34, left: 12, right: 12 };
    await setViewport(narrow);
    for (const [trigger, title] of [['调节速度', '调节速度'], ['定位小节', '定位小节']]) {
      await bar.getByRole('button', { name: trigger, exact: true }).click();
      await expect(page.getByRole('dialog', { name: title, exact: true })).toBeVisible();
      await safe(narrow);
      await page.keyboard.press('Escape');
      await expect(bar.getByRole('button', { name: trigger, exact: true })).toBeFocused();
    }
    await bar.getByRole('button', { name: '收起播放控制', exact: true }).click();
    await bar.getByRole('button', { name: '练习设置', exact: true }).click();
    await safe(narrow);
    await close.click();
    assert.deepEqual(errors, []);
    await writeFile(`${evidence}/geometry.json`, JSON.stringify({ engine, browserVersion: browser.version(), syntheticInsets: true, installedPwa: false, measurements, errors }, null, 2));
  });
}
