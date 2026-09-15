import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium } from "playwright";
import { expect } from "@playwright/test";
import { startVisualServer } from "./setup.mjs";
import { createVisualFixtureSession } from "./fixtures.mjs";

test("PDF generation separates sharing activation, preserves cancelled files, and offers download after failure", async t => {
  const app = await startVisualServer({ script: "dev" });
  const browser = await chromium.launch();
  t.after(async () => { await browser.close(); await app.stop(); });
  const context = await browser.newContext({ viewport: { width: 820, height: 1180 }, serviceWorkers: "block" });
  const fixture = createVisualFixtureSession();
  await context.route("**/api/**", route => route.fulfill(fixture.resolve({ pathname: new URL(route.request().url()).pathname, method: route.request().method(), identity: "admin", cookie: "", body: route.request().postDataJSON() })));
  await context.addInitScript(() => {
    window.sharedFiles = [];
    window.shareFailure = "AbortError";
    Object.defineProperty(navigator, "canShare", { value: ({ files }) => files[0].type === "application/pdf" });
    Object.defineProperty(navigator, "share", { value: ({ files }) => {
      window.sharedFiles.push({ file: files[0], active: navigator.userActivation.isActive });
      return Promise.reject(new DOMException("test", window.shareFailure));
    } });
  });
  const page = await context.newPage();
  await page.goto(`${app.origin}/choirs/visual-choir`);
  await page.locator(".file-row").filter({ hasText: "排练示例" }).getByRole("button", { name: /更多操作/ }).click();
  await page.getByRole("menuitem", { name: "分享 PDF", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "分享 PDF" });
  await expect(dialog.getByRole("status")).toContainText("PDF 已准备好");
  await expect(dialog.getByRole("checkbox", { name: "Ensemble", exact: true })).toBeChecked();
  await expect(dialog.getByRole("checkbox", { name: "Bass", exact: true })).not.toBeChecked();
  await expect(dialog.getByRole("checkbox", { name: "我的笔记", exact: true })).toBeChecked();
  assert.equal(await page.evaluate(() => window.sharedFiles.length), 0);
  await dialog.getByRole("button", { name: "分享 PDF", exact: true }).click();
  await expect(dialog.getByRole("status")).toContainText("PDF 已准备好");
  assert.equal(await dialog.getByRole("alert").count(), 0);
  await page.evaluate(() => { window.shareFailure = "NotAllowedError"; });
  await dialog.getByRole("button", { name: "分享 PDF", exact: true }).click();
  await dialog.getByRole("button", { name: "下载 PDF", exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.sharedFiles.length === 2 && window.sharedFiles.every(item => item.active) && window.sharedFiles[0].file === window.sharedFiles[1].file && window.sharedFiles[0].file.size > 0), true);
  const [download] = await Promise.all([page.waitForEvent("download"), dialog.getByRole("button", { name: "下载 PDF", exact: true }).click()]);
  assert.equal(await download.failure(), null);
  await dialog.getByRole("radio", { name: "仅原谱", exact: true }).check();
  await expect(dialog.getByRole("status")).toHaveCount(0);
  await expect(dialog.getByRole("status")).toContainText("PDF 已准备好");
  await page.evaluate(async () => {
    const { localDatabase } = await import("/src/client/platform/local-database.ts");
    await localDatabase.annotationLayers.toCollection().modify({ displayColor: "#123456" });
  });
  await expect(dialog.getByRole("status")).toHaveCount(0);
  await expect(dialog.getByRole("status")).toContainText("PDF 已准备好");
  await page.evaluate(async () => {
    const { localDatabase } = await import("/src/client/platform/local-database.ts");
    await localDatabase.system.put({ key: "local-workspace:active-owner", value: "user:other" });
  });
  await expect(dialog.getByRole("alert")).toContainText("登录状态已变化");
  await expect(dialog.getByRole("button", { name: "分享 PDF", exact: true })).toBeDisabled();

});

for (const blockedLayerRequest of [1, 2]) test(`changed choices finish while obsolete layer request ${blockedLayerRequest} remains blocked`, async t => {
  const app = await startVisualServer({ script: "dev" });
  const browser = await chromium.launch();
  t.after(async () => { await browser.close(); await app.stop(); });
  const context = await browser.newContext({ serviceWorkers: "block" });
  const fixture = createVisualFixtureSession();
  let blockLayers = false;
  let layerRequests = 0;
  let releaseLayers;
  let announceBlocked;
  const blocked = new Promise(resolve => { announceBlocked = resolve; });
  const gate = new Promise(resolve => { releaseLayers = resolve; });
  t.after(() => releaseLayers());
  await context.route("**/api/**", async route => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (blockLayers && pathname.endsWith("/layers") && ++layerRequests === blockedLayerRequest) {
      blockLayers = false;
      announceBlocked();
      await gate;
    }
    await route.fulfill(fixture.resolve({ pathname, method: request.method(), identity: "admin", cookie: "", body: request.postDataJSON() }));
  });
  const page = await context.newPage();
  await page.goto(`${app.origin}/choirs/visual-choir`);
  const more = page.locator(".file-row").filter({ hasText: "排练示例" }).getByRole("button", { name: /更多操作/ });
  await more.click();
  await page.getByRole("menuitem", { name: "分享 PDF", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "分享 PDF" });
  await dialog.getByRole("button", { name: "下载 PDF", exact: true }).waitFor();
  blockLayers = true;
  await dialog.getByRole("radio", { name: "仅原谱", exact: true }).check();
  await blocked;
  await expect(dialog.getByRole("button", { name: "正在准备…", exact: true })).toBeDisabled();
  await dialog.getByRole("radio", { name: "包含笔记", exact: true }).check();
  await dialog.getByRole("radio", { name: "仅原谱", exact: true }).check();
  // The old request is still blocked: the new selection must finish first.
  await expect(dialog.getByRole("button", { name: "下载 PDF", exact: true })).toBeEnabled({ timeout: 5000 });
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  releaseLayers();
  await expect(dialog).toHaveCount(0);
  await more.click();
  await page.getByRole("menuitem", { name: "分享 PDF", exact: true }).click();
  await dialog.getByRole("button", { name: "下载 PDF", exact: true }).waitFor();
  await expect(dialog.getByRole("radio", { name: "包含笔记", exact: true })).toBeChecked();
  await expect(dialog.getByRole("alert")).toHaveCount(0);
});
