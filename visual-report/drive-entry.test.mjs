import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium, webkit, expect } from "@playwright/test";
import { startVisualServer } from "./setup.mjs";
import { createVisualFixtureSession } from "./fixtures.mjs";
import { withBrowserEvidence } from "../browser-tests/browser-evidence.mjs";

for (const [name, engine] of [["chromium", chromium], ["webkit", webkit]]) {
  test(`${name}: first-join and direct library entry use existing product flows`, async t => {
    const app = await startVisualServer({ script: "dev" }); t.after(() => app.stop());
    const browser = await engine.launch(); t.after(() => browser.close());
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
    t.after(() => context.close());
    await withBrowserEvidence(context, `artifacts/verification/drive-entry/${name}`, async () => {
      const fixture = createVisualFixtureSession();
      let empty = true, failed = false, admission;
      await context.route("**/api/**", async route => {
        const request = route.request(), pathname = new URL(request.url()).pathname;
        if (pathname === "/api/choirs" && request.method() === "GET") {
          if (failed) return route.fulfill({ status: 503, json: {} });
          if (empty) return route.fulfill({ json: { memberships: [] } });
        }
        if (pathname === "/api/guest/session" && request.method() === "POST") {
          admission = request.postDataJSON();
          return route.fulfill({ json: { choir: { id: "visual-choir", name: "受邀云盘", guestAdmissionMode: "invite" }, entryKind: "admission" } });
        }
        if (pathname === "/api/choirs/join-current-guest") { empty = false; return route.fulfill({ json: { ok: true } }); }
        if (pathname === "/api/choirs/current-guest/join-state") return route.fulfill({ json: { status: "display-name-required", choir: { id: "visual-choir", name: "受邀云盘", guestAdmissionMode: "invite" } } });
        return route.fulfill(fixture.resolve({ pathname, method: request.method(), identity: "admin", cookie: "" }));
      });
      const page = await context.newPage();
      await page.goto(app.origin);
      await expect(page.getByRole("heading", { name: "先加入你的云盘", exact: true })).toBeVisible();
      assert.equal(new URL(page.url()).pathname, "/drives");
      await expect(page.getByRole("button", { name: "扫一扫", exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "从相册识别", exact: true })).toBeVisible();
      await expect(page.locator(".join-code-slot")).toHaveCount(8);
      await expect(page.getByRole("button", { name: "进入云盘", exact: true })).toBeDisabled();
      await page.getByRole("textbox", { name: "邀请码", exact: true }).fill("abcd-efgh");
      await page.getByRole("button", { name: "进入云盘", exact: true }).click();
      await expect(page.getByRole("heading", { name: "加入「受邀云盘」", exact: true })).toBeVisible();
      assert.deepEqual(admission, { admission: "invite", joinCode: "ABCDEFGH" });
      await page.getByRole("textbox", { name: "显示名", exact: true }).fill("小花");
      await page.getByRole("button", { name: "加入并进入", exact: true }).click();
      await expect(page.getByRole("button", { name: /^切换云盘/ })).toBeEnabled();
      await expect(page).toHaveURL(`${app.origin}/choirs/visual-choir`);
      // Reopening /drives with a valid remembered target also skips selection.
      await page.goto(`${app.origin}/drives`);
      await expect(page.getByRole("button", { name: /^切换云盘/ })).toBeEnabled();
      await expect(page).toHaveURL(`${app.origin}/choirs/visual-choir`);
      // A missing remembered target requires an explicit choice even with one remaining drive.
      await page.evaluate(() => {
        for (const key of Object.keys(localStorage)) if (key.startsWith("same-page:last-drive:")) localStorage.setItem(key, "gone");
      });
      await page.goto(`${app.origin}/drives`);
      await expect(page.getByRole("heading", { name: "选择云盘", exact: true })).toBeVisible();
      await page.getByRole("link", { name: /示例云盘.*拥有者/ }).click();
      await page.getByRole("button", { name: /^切换云盘/ }).waitFor();
      await page.goBack();
      await expect(page.getByRole("button", { name: /^切换云盘/ })).toBeEnabled();
      await page.goto(app.origin);
      await expect(page.getByRole("button", { name: /^切换云盘/ })).toBeEnabled();
      await expect(page).toHaveURL(`${app.origin}/choirs/visual-choir`);
      // An explicit product homepage visit retains its intent.
      await page.goto(`${app.origin}/about`);
      await page.getByRole("link", { name: /^产品介绍/ }).click();
      await expect(page.getByRole("heading", { name: "Harmony begins on the Same Page", exact: true })).toBeVisible();
      await page.evaluate(() => {
        for (const key of Object.keys(localStorage)) if (key.startsWith("same-page:last-drive:")) localStorage.setItem(key, "gone");
      });
      failed = true;
      await page.goto(`${app.origin}/drives`);
      await expect(page.getByText("暂时无法加载已加入的云盘。", { exact: false })).toBeVisible();
      await expect(page.getByRole("heading", { name: "先加入你的云盘", exact: true })).toHaveCount(0);
      await expect(page.getByRole("link", { name: /示例云盘/ })).toBeVisible();
    });
  });
}
