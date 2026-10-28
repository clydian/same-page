import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { after, before, test } from "node:test";
import { chromium, webkit, expect } from "@playwright/test";
import { startVisualServer } from "./setup.mjs";
import { createVisualFixtureSession } from "./fixtures.mjs";

let app;
before(async () => {
  app = await startVisualServer({ script: "dev" });
  if (process.env.LAYOUT_CAPTURE_DIR) await mkdir(process.env.LAYOUT_CAPTURE_DIR, { recursive: true });
});
after(async () => app?.stop());

for (const [name, engine] of [["chromium", chromium], ["webkit", webkit]]) {
  for (const [entry, width, height] of [["home", 390, 844], ["library", 390, 844], ["first-drive", 390, 844], ["landscape", 844, 390]]) {
    test(`${name}: ${entry} join code stays above keyboard`, async t => {
      const browser = await engine.launch(); t.after(() => browser.close());
      const page = await browser.newPage({ viewport: { width, height } });
      page.setDefaultTimeout(10000);
      await page.addInitScript(height => {
        const viewport = Object.assign(new EventTarget(), { height, offsetTop: 0, scale: 1 });
        Object.defineProperty(window, "visualViewport", { value: viewport });
      }, height);
      const fixture = createVisualFixtureSession({ id: "library-long-list" });
      await page.route("**/api/**", route => {
        const request = route.request(), pathname = new URL(request.url()).pathname;
        return route.fulfill(fixture.resolve({ pathname, method: request.method(), identity: entry === "library" ? "admin" : "guest", cookie: "" }));
      });
      if (entry === "home" || entry === "landscape") {
        await page.goto(`${app.origin}/?join=1`);
      } else if (entry === "first-drive") {
        await page.goto(`${app.origin}/drives`);
      } else {
        await page.goto(`${app.origin}/choirs/visual-choir`);
        await expect(page.locator(".file-row")).toHaveCount(30);
        await page.evaluate(() => scrollTo(0, 350));
        await expect.poll(() => page.evaluate(() => scrollY)).toBe(350);
        await page.getByRole("button", { name: /^切换云盘/ }).click();
        await page.getByRole("dialog", { name: "切换云盘" }).getByRole("button", { name: "加入新云盘", exact: true }).click();
      }
      const input = page.getByRole("textbox", { name: "邀请码", exact: true });
      await input.fill("ABCD");
      for (const visibleHeight of entry === "landscape" ? [375, 350, 335, 300, 220, 200, 335] : [335]) {
        await page.evaluate(height => {
          window.visualViewport.height = height;
          window.visualViewport.dispatchEvent(new Event("resize"));
          window.dispatchEvent(new Event("pageshow"));
        }, visibleHeight);
        await expect.poll(() => input.evaluate(inputIsVisible), {
          message: `${entry}: invitation input must fit both keyboard viewport and dialog clipping at ${visibleHeight}px`, timeout: 2000,
        }).toBe(true);
      }
      await expect(input).toBeFocused();
      await expect(input).toHaveValue("ABCD");
      assert.equal(await page.evaluate(() => innerHeight), height);
      if (process.env.LAYOUT_CAPTURE_DIR) {
        await page.evaluate(() => {
          const keyboard = document.createElement("div");
          keyboard.id = "keyboard-screenshot-overlay";
          keyboard.textContent = "模拟软键盘遮挡区域 · 可见页面截止 y=335";
          keyboard.style.cssText = "position:fixed;inset:335px 0 0;z-index:2147483647;background:#d0d3d9;color:#48515c;text-align:center;padding:24px 8px;font:14px system-ui;pointer-events:none;border-top:1px solid #aab0b6";
          document.body.append(keyboard);
        });
        await page.screenshot({ path: path.join(process.env.LAYOUT_CAPTURE_DIR, `${name}-${entry}.png`) });
        await page.evaluate(() => document.getElementById("keyboard-screenshot-overlay").remove());
      }
      // A pan without a resize and app resume must preserve the same draft.
      await page.evaluate(() => {
        window.visualViewport.offsetTop = 40;
        window.visualViewport.dispatchEvent(new Event("scroll"));
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await expect.poll(() => input.evaluate(inputIsVisible)).toBe(true);
      await expect(input).toBeFocused();
      await expect(input).toHaveValue("ABCD");
      await page.evaluate(height => {
        window.visualViewport.height = height;
        window.visualViewport.offsetTop = 0;
        window.visualViewport.dispatchEvent(new Event("resize"));
      }, height);
      const selector = entry === "first-drive" ? ".join-drive-panel" : ".join-drive-overlay";
      const property = entry === "first-drive" ? "--input-keyboard-inset" : "--input-viewport-height";
      await expect.poll(() => page.locator(selector).evaluate((element, key) => element.style.getPropertyValue(key), property)).toBe(entry === "first-drive" ? "0px" : `${height}px`);
      if (entry === "library") {
        await page.getByRole("button", { name: "返回切换云盘", exact: true }).click();
        await page.getByRole("button", { name: "关闭云盘选择", exact: true }).click();
        await expect.poll(() => page.evaluate(() => scrollY)).toBe(350);
        await page.getByRole("button", { name: /^切换云盘/ }).click();
        await page.getByRole("dialog", { name: "切换云盘" }).getByRole("button", { name: "加入新云盘", exact: true }).click();
        await input.fill("EFGH");
        await page.evaluate(() => {
          window.visualViewport.height = 335;
          window.visualViewport.dispatchEvent(new Event("resize"));
        });
        await expect.poll(() => input.evaluate(element => element.getBoundingClientRect().bottom)).toBeLessThanOrEqual(335);
        await expect(input).toHaveValue("EFGH");
      }
    });
  }
}

function inputIsVisible(element) {
  const bounds = element.getBoundingClientRect(), viewport = window.visualViewport;
  const dialog = element.closest(".app-dialog")?.getBoundingClientRect();
  const top = Math.max(viewport.offsetTop, dialog?.top ?? -Infinity);
  const bottom = Math.min(viewport.offsetTop + viewport.height, dialog?.bottom ?? Infinity);
  return bounds.top >= top && bounds.bottom <= bottom;
}
