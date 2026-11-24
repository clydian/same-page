import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium, expect, webkit } from "@playwright/test";
import { createVisualFixtureSession } from "./fixtures.mjs";
import { startVisualServer } from "./setup.mjs";

let app;
before(async () => { app = await startVisualServer({ script: "dev" }); });
after(async () => { await app?.stop(); });

for (const [name, engine] of Object.entries({ chromium, webkit })) {
  test(`${name}: reader controls keep selection inside editable text`, { timeout: 60_000 }, async t => {
    const browser = await engine.launch();
    t.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width: 834, height: 1024 }, locale: "zh-CN", hasTouch: true, reducedMotion: "reduce", serviceWorkers: "block" });
    page.setDefaultTimeout(10_000);
    const fixture = createVisualFixtureSession();
    await page.route("**/api/**", route => route.fulfill(fixture.resolve({
      pathname: new URL(route.request().url()).pathname, method: route.request().method(), identity: "admin",
    })));
    await page.addInitScript(() => localStorage.setItem("reader-gesture-hint-seen", "true"));

    await page.goto(`${app.origin}/choirs/visual-choir`);
    await page.getByRole("link", { name: "排练示例 · 秋日合唱", exact: true }).tap();
    await page.locator('[data-page-turn-current] canvas[data-pdf-canvas-active]').waitFor();
    await page.locator(".page-reader__viewport").tap();
    await expect(page.locator(".page-reader__viewport")).toHaveCSS("user-select", "none");
    await page.getByRole("button", { name: "更多", exact: true }).tap();
    await assertUnselectable(page.locator(".reader-more-menu .reader-menu-heading strong"));
    await page.getByRole("button", { name: "连续滚动", exact: true }).tap();
    await expect(page.locator(".continuous-reader")).toHaveCSS("user-select", "none");
    await expect(page.locator(".reader-more-menu")).toHaveCount(0);
    await page.getByRole("button", { name: "编辑", exact: true }).tap();

    for (const tool of ["画笔", "荧光笔", "橡皮"]) {
      const button = page.getByRole("button", { name: tool, exact: true });
      await button.tap();
      await expect(button).toHaveAttribute("aria-pressed", "true");
      await expect(button.locator(".annotation-tool-name")).toHaveCSS("user-select", "none");
    }
    await page.getByRole("button", { name: "画笔", exact: true }).tap();
    await page.getByRole("button", { name: "工具设置", exact: true }).tap();
    await assertUnselectable(page.locator(".annotation-style-popover .reader-style-heading strong"));
    const width = page.locator('.annotation-style-popover input[type="range"]').first();
    const initialWidth = await width.inputValue();
    await width.press("ArrowRight");
    assert.ok(Number(await width.inputValue()) > Number(initialWidth));
    await page.getByRole("button", { name: "工具设置", exact: true }).tap();

    await page.locator(".reader-edit-layer-trigger").tap();
    await assertUnselectable(page.locator(".reader-edit-layer-popover h2"));
    await page.getByRole("button", { name: "我的笔记", exact: true }).tap();
    await expect(page.locator(".reader-edit-layer-trigger")).toHaveAccessibleName(/我的笔记/);

    await page.getByRole("button", { name: "文字", exact: true }).tap();
    await page.locator(".annotation-overlay[data-editing] svg").first().tap({ position: { x: 150, y: 200 } });
    const text = page.getByRole("textbox", { name: "笔记文本", exact: true });
    await text.fill("Allegro");
    await text.dblclick({ position: { x: 12, y: 7 } });
    assert.equal(await text.evaluate(input => input.value.slice(input.selectionStart, input.selectionEnd)), "Allegro");
    await page.getByRole("button", { name: "完成文字输入", exact: true }).tap();
    await page.getByRole("button", { name: "完成编辑", exact: true }).tap();
    await expect(page.locator(".annotation-controls")).toHaveCount(0);
  });
}

async function assertUnselectable(label) {
  await label.dblclick();
  assert.equal(await label.page().evaluate(() => getSelection()?.toString()), "");
  await expect(label).toHaveCSS("user-select", "none");
}
