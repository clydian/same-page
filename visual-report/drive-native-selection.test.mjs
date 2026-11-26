import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium, webkit, expect } from "@playwright/test";
import { startVisualServer } from "./setup.mjs";
import { createVisualFixtureSession } from "./fixtures.mjs";
let app;
before(async () => { app = await startVisualServer({ script: "dev" }); });
after(async () => { await app?.stop(); });
for (const [name, engine] of Object.entries({ chromium, webkit })) {
  test(`${name}: library bottom whitespace cannot select the page while editing and file actions remain available`, async t => {
    const browser = await engine.launch(); t.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: "zh-CN", hasTouch: true });
    const fixture = createVisualFixtureSession();
    await page.route("**/api/**", route => route.fulfill(fixture.resolve({ pathname: new URL(route.request().url()).pathname, method: route.request().method(), identity: "admin" })));
    await page.goto(`${app.origin}/choirs/visual-choir`);
    await expect(page.locator(".file-row")).toHaveCount(3);
    const libraryBottom = () => page.locator(".bottom-navigation").evaluate(nav => nav.getBoundingClientRect().top - 16);
    const bottom = await page.evaluate(y => {
      const target = document.elementFromPoint(24, y);
      const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
      target.dispatchEvent(event);
      return { inLibrary: !!target.closest(".drive-page"), onFile: !!target.closest(".file-row"), select: getComputedStyle(target).userSelect, prevented: event.defaultPrevented };
    }, await libraryBottom());
    assert.deepEqual(bottom, { inLibrary: true, onFile: false, select: "none", prevented: true });
    await page.setViewportSize({ width: 390, height: 300 });
    // Check native page scrolling without taking over touch gestures.
    await page.keyboard.press("PageDown");
    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => scrollTo(0, 0));
    const text = await page.locator(".file-row__name").first().boundingBox();
    await page.mouse.move(24, await libraryBottom()); await page.mouse.down();
    await page.mouse.move(text.x + text.width / 2, text.y + text.height / 2, { steps: 10 }); await page.mouse.up();
    assert.equal(await page.evaluate(() => getSelection().toString()), "");

    const selectable = async locator => locator.evaluate(element => {
      element.focus(); element.select();
      const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true }); element.dispatchEvent(event);
      return { select: getComputedStyle(element).userSelect, prevented: event.defaultPrevented, length: element.selectionEnd - element.selectionStart };
    });
    const search = page.getByRole("searchbox"); await search.fill("排练");
    assert.deepEqual(await selectable(search), { select: "text", prevented: false, length: 2 });
    await search.fill("");
    const link = page.locator(".file-row__open").first();
    const context = await link.evaluate(element => {
      const mouse = new MouseEvent("contextmenu", { bubbles: true, cancelable: true }); element.dispatchEvent(mouse);
      const touch = new PointerEvent("contextmenu", { bubbles: true, cancelable: true, pointerType: "touch" }); element.dispatchEvent(touch);
      return { mouse: mouse.defaultPrevented, touch: touch.defaultPrevented };
    });
    assert.deepEqual(context, { mouse: false, touch: true });
    await page.locator(".file-menu-button").first().click();
    await page.getByRole("menuitem", { name: "重命名", exact: true }).click();
    const rename = page.getByRole("dialog").getByRole("textbox");
    const value = await rename.inputValue();
    const selection = await selectable(rename);
    assert.equal(selection.prevented, false); assert.equal(selection.length, value.length);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await page.goto(`${app.origin}/about`);
    await expect(page.locator(".drive-page")).toHaveCount(0);
    const outside = await page.locator("main").first().evaluate(element => {
      const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true }); element.dispatchEvent(event);
      return { select: getComputedStyle(element).userSelect, prevented: event.defaultPrevented };
    });
    assert.notEqual(outside.select, "none"); assert.equal(outside.prevented, false);
  });
}
