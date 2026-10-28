import { mkdir } from 'node:fs/promises';
import { before, after, test } from 'node:test';
import { chromium, webkit, expect } from '@playwright/test';
import { startVisualServer } from './setup.mjs';
import { createVisualFixtureSession } from './fixtures.mjs';
let app;
before(async () => { app = await startVisualServer({ script: 'dev' }); await mkdir('artifacts/verification/personal-menu', { recursive: true }); });
after(async () => { await app?.stop(); });
for (const [name, engine] of Object.entries({ chromium, webkit })) test(`${name}: personal menu explains drive/app scope and keeps navigation and keyboard access`, async t => {
  const browser = await engine.launch(); t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', locale: 'zh-CN', colorScheme: 'light' });
  const fixture = createVisualFixtureSession({ id: 'personal-menu-scopes' });
  await page.route('**/api/**', async route => {
    const request = route.request();
    await route.fulfill(fixture.resolve({ pathname: new URL(request.url()).pathname, method: request.method(), identity: 'member', cookie: '' }));
  });
  await page.goto(`${app.origin}/choirs/visual-choir`);
  const trigger = page.getByRole('button', { name: '我的', exact: true });
  for (const mode of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: mode });
    await trigger.click();
    const menu = page.getByRole('menu', { name: '我的', exact: true });
    await expect(menu.getByText('当前云盘', { exact: true })).toBeVisible();
    await expect(menu.getByText('示例云盘', { exact: true })).toHaveCount(0);
    await expect(menu.getByText('应用设置', { exact: true })).toBeVisible();
    await expect(menu.getByText('member@visual.invalid', { exact: true })).toHaveCount(0);
    for (const [label, href] of [['阅读偏好','/choirs/visual-choir/preferences'],['本机存储','/choirs/visual-choir/storage'],['账户','/user'],['外观','/appearance']]) {
      await expect(menu.getByRole('menuitem', { name: label, exact: true })).toHaveAttribute('href', href);
    }
    await page.locator('.account-menu-popover').screenshot({ path: `artifacts/verification/personal-menu/${name}-${mode}.png` });
    await page.screenshot({ path: `artifacts/verification/personal-menu/${name}-${mode}-phone.png` });
    await page.keyboard.press('End');
    await expect(menu.getByRole('menuitem', { name: '退出登录', exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
  }
  await page.setViewportSize({ width: 740, height: 320 });
  await trigger.click();
  const popover = page.locator('.account-menu-popover');
  await expect.poll(async () => { const box=await popover.boundingBox(); return box.y >= 0 && box.y + box.height <= 320; }).toBe(true);
  await page.keyboard.press('End');
  const logout = page.getByRole('menuitem', { name: '退出登录', exact: true });
  await expect(logout).toBeFocused();
  // Keyboard focus can settle before the browser finishes scrolling its menu.
  await expect.poll(async () => { const box = await logout.boundingBox(); return box.y >= 0 && box.y + box.height <= 320; }).toBe(true);
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 390, height: 844 });
  await trigger.click();
  await page.getByRole('menuitem', { name: '外观', exact: true }).click();
  await expect(page.getByRole('heading', { name: '外观', level: 1 })).toBeVisible();
});
