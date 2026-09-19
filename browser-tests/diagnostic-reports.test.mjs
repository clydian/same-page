import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, webkit, expect } from "@playwright/test";
import { startStorageFixture } from "./storage-fixture.mjs";

// Real Worker/D1 with synthetic data. The first response is lost AFTER real persistence.
test("diagnostic feedback survives lost receipts and offline retries in Chromium/WebKit", { timeout: 150_000 }, async t => {
  const fixture = await startStorageFixture({ authenticated: true, script: "dev" });
  t.after(() => fixture.stop());
  await mkdir("artifacts/verification", { recursive: true });
  for (const [name, engine, width, height] of [["chromium", chromium, 320, 740], ["webkit", webkit, 768, 1024]]) {
    const browser = await engine.launch({ headless: true });
    let activePage;
    try {
      const context = await browser.newContext({ viewport: { width, height }, serviceWorkers: "block" });
      const page = await context.newPage();
      activePage = page;
      await page.goto(`${fixture.origin}/diagnostics`);
      await expect(page.getByRole("button", { name: "发送诊断", exact: true })).toBeEnabled();
      assert.equal(await page.locator(".diagnostic-report-form details").getAttribute("open"), null);
      const sendBounds = await page.getByRole("button", { name: "发送诊断", exact: true }).boundingBox();
      assert.ok(sendBounds.height >= 44 && sendBounds.y + sendBounds.height <= height, "send is touch-sized and reachable in the first viewport");
      await page.getByLabel("刚才遇到了什么问题？（选填）").fill("显示不正常，没有报错");
      await page.screenshot({ path: `artifacts/verification/diagnostic-${name}-form.png`, fullPage: true });
      let original, attempts = 0;
      await page.route("**/api/diagnostic-reports", async route => {
        const body = route.request().postDataJSON();
        attempts++;
        if (attempts === 1) {
          original = body;
          const persisted = await route.fetch();
          assert.equal(persisted.status(), 201);
          assert.deepEqual(await persisted.json(), { id: body.id });
          await route.abort("failed");
        } else {
          assert.deepEqual(body, original);
          await route.continue();
        }
      });
      await page.getByRole("button", { name: "发送诊断", exact: true }).click();
      await expect(page.getByRole("status")).toContainText("尚未确认收到");
      await page.screenshot({ path: `artifacts/verification/diagnostic-${name}-uncertain.png`, fullPage: true });
      await page.getByRole("button", { name: "重试发送" }).click();
      await expect(page.getByRole("button", { name: "复制反馈编号" })).toBeVisible();
      await expect(page.locator(".diagnostic-receipt")).toContainText(original.id);
      assert.equal((await context.request.get(`${fixture.origin}/api/diagnostic-reports/${original.id}`)).status(), 404);
      await page.screenshot({ path: `artifacts/verification/diagnostic-${name}-receipt.png`, fullPage: true });
      await page.getByRole("button", { name: "填写另一份反馈" }).click();
      await context.setOffline(true);
      await page.getByRole("button", { name: "发送诊断", exact: true }).click();
      await expect(page.getByRole("status")).toContainText("当前离线");
      assert.equal(attempts, 2);
      await context.setOffline(false);
      await page.unroute("**/api/diagnostic-reports");
      await page.getByRole("button", { name: "清空诊断" }).click();
      await writeFile(`artifacts/verification/diagnostic-${name}.json`, JSON.stringify({ engine: name, viewport: { width, height }, realWorkerD1: true, receiptLostAfterPersistence: true, realDevice: false }, null, 2));
      await context.close();
    } catch (error) {
      await activePage?.screenshot({ path: `artifacts/verification/diagnostic-${name}-failure.png`, fullPage: true });
      throw error;
    } finally { await browser.close(); }
  }
});
