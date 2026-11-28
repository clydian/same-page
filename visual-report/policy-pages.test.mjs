import assert from "node:assert/strict";
import test from "node:test";
import { mkdir } from "node:fs/promises";
import { chromium, expect, webkit } from "@playwright/test";
import { createVisualFixtureSession } from "./fixtures.mjs";
import { startVisualServer } from "./setup.mjs";

// Protect public access, truthful launch status and usable navigation on narrow screens.
for (const [name, engine] of Object.entries({ chromium, webkit })) {
  test(`${name}: public policy drafts remain accessible without payment controls`, async () => {
    const server = await startVisualServer({ script: "dev" });
    let browser;
    try {
      browser = await engine.launch({ headless: true });
      for (const width of [320, 390, 1280]) {
        // Policy navigation does not exercise the home page demos. Keep them still when leaving home between cases.
        const context = await browser.newContext({ locale: "zh-CN", reducedMotion: "reduce", viewport: { width, height: 900 }, serviceWorkers: "block" });
        await context.route("**/api/**", route => route.fulfill({ status: 200, contentType: "application/json", body: "null" }));
        const page = await context.newPage();
        const errors = [];
        page.on("pageerror", error => errors.push(error.message));
        for (const [path, title] of [["pricing", "价格与方案"], ["terms", "服务条款"], ["refunds", "取消与退款"]]) {
          await page.goto(`${server.origin}/${path}`);
          await page.getByRole("heading", { level: 1, name: title }).waitFor();
          await page.getByText("审阅草稿 · 付费筹备中", { exact: true }).waitFor();
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
          assert.equal(await page.getByRole("button", { name: /购买|支付|管理订阅/ }).count(), 0);
          assert.equal(await page.locator('a[href*="checkout"], a[href*="customer-portal"]').count(), 0);
          if (path === "pricing") {
            await page.getByText(/当前新建免费云盘：20/).waitFor();
            assert.equal(await page.locator(".policy-plan").count(), 3);
          }
          if (process.env.POLICY_SCREENSHOTS === "1" && name === "chromium" && width !== 320) {
            await mkdir("docs/evidence/pricing-policies", { recursive: true });
            await page.screenshot({ path: `docs/evidence/pricing-policies/${path}-${width}.png`, fullPage: true });
          }
          await page.getByRole("navigation", { name: "价格与政策" }).getByRole("link", { name: "隐私政策" }).click();
          await page.getByRole("heading", { name: "隐私政策", level: 1 }).waitFor();
          await page.getByRole("button", { name: "返回", exact: true }).click();
          await page.getByRole("heading", { name: title, level: 1 }).waitFor();
          // Keep this policy check on document routes; home animation loading is unrelated.
          assert.equal(await page.getByRole("link", { name: "返回产品首页" }).getAttribute("href"), "/");
        }
        assert.deepEqual(errors, []);
        await context.close();
      }
    } finally { await browser?.close(); await server.stop(); }
  });

  test(`${name}: pricing opens the configured public example on request and permits retry`, async () => {
    const server = await startVisualServer({ script: "dev" });
    let browser;
    const firstLookup = Promise.withResolvers();
    try {
      browser = await engine.launch();
      const page = await browser.newPage({
        locale: "zh-CN", viewport: { width: 390, height: 844 }, hasTouch: true, serviceWorkers: "block",
      });
      const fixture = createVisualFixtureSession();
      let lookups = 0;
      const authWrites = [];
      await page.route("**/api/**", async route => {
        const request = route.request();
        const pathname = new URL(request.url()).pathname;
        const method = request.method();
        if (pathname.startsWith("/api/auth/") && method !== "GET") authWrites.push(pathname);
        if (pathname === "/api/guest/preview-choir" && ++lookups === 1) {
          await firstLookup.promise;
          return route.fulfill({ status: 503, json: {} });
        }
        return route.fulfill(fixture.resolve({ pathname, method, identity: "guest", cookie: (await request.headerValue("cookie")) ?? "" }));
      });
      await page.goto(`${server.origin}/pricing`);
      const trial = page.getByRole("region", { name: "免费体验与已有云盘" });
      const action = trial.getByRole("button", { name: "打开示例乐谱" });
      await expect(action).toBeVisible();
      assert.equal(lookups, 0);
      for (let index = 0; index < 8 && !(await action.evaluate(el => el === document.activeElement)); index++) {
        await page.keyboard.press("Tab");
      }
      await expect(action).toBeFocused();
      await expect(action).toHaveAttribute("data-focus-visible", "true");
      assert.ok((await action.boundingBox()).height >= 44);
      await page.keyboard.press("Enter");
      await expect.poll(() => lookups).toBe(1);
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(`${server.origin}/pricing`);
      firstLookup.resolve();
      await expect(page.getByRole("status").filter({ hasText: "示例没能打开，请再试一次。" })).toBeVisible();
      assert.equal(lookups, 1);

      await action.tap();
      await expect(page).toHaveURL(`${server.origin}/choirs/visual-preview-choir`);
      await expect(page.getByRole("heading", { name: "公开体验云盘", exact: true })).toBeVisible();
      assert.equal(lookups, 2);
      assert.deepEqual(authWrites, []);
    } finally {
      firstLookup.resolve();
      await browser?.close();
      await server.stop();
    }
  });
}
