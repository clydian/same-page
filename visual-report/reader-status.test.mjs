import assert from "node:assert/strict";
import { test } from "node:test";
import { expect } from "@playwright/test";
import { chromium } from "playwright";
import { startVisualServer } from "./setup.mjs";
import { resolveFixtureRequest } from "./fixtures.mjs";

// Real client, IndexedDB, PDF canvas and outbox; API fixtures and network events
// are simulated. This is not physical-device or airplane-mode acceptance.
test("failed local save blocks browser back and retains the draft through reconnect", async (t) => {
  const app = await startVisualServer({ script: "dev" });
  const browser = await chromium.launch();
  t.after(async () => { await browser.close(); await app.stop(); });
  {
    const width = 390;
    const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: "block", reducedMotion: "reduce" });
    await context.addInitScript(() => {
      localStorage.setItem("reader-gesture-hint-seen", "true");
      window.fixtureOnline = true;
      const originalPut = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (...args) {
        if (window.fixtureStorageFailed && this.name === "annotations") throw new DOMException("full", "QuotaExceededError");
        return originalPut.apply(this, args);
      };
      Object.defineProperty(navigator, "onLine", { get: () => window.fixtureOnline });
    });
    let pushes = 0;
    let failSync = false;
    await context.route("**/api/**", async route => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      if (pathname.endsWith("/annotations/push")) {
        pushes++;
        if (failSync) return route.fulfill({ status: 503, body: "unavailable" });
        const { operations } = request.postDataJSON();
        return route.fulfill({ json: { results: operations.map(op => ({ opId: op.opId, status: "accepted", object: {
          id: op.annotationId, layerId: op.layerId, version: op.baseVersion + 1, deleted: op.type === "delete", payload: op.payload,
          createdByDisplayName: "周宁", updatedByDisplayName: "周宁", updatedAt: Date.now(),
        } })) } });
      }
      await route.fulfill(resolveFixtureRequest({ pathname, method: request.method(), identity: "member", scenarioId: "reader-status", cookie: "" }));
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${app.origin}/choirs/visual-choir`);
    await page.getByRole("link", { name: /排练示例 · 秋日合唱/ }).click();
    await page.locator("[data-page-turn-current] [data-pdf-canvas-active]").waitFor();
    const stage = page.locator(".page-reader__viewport");
    const box = await stage.boundingBox();
    await stage.click({ position: { x: box.width / 2, y: box.height / 2 } });
    await page.getByRole("button", { name: "更多", exact: true }).click();
    const menu = page.getByRole("dialog", { name: "更多阅读选项" });
    await menu.waitFor();
    await menu.getByRole("region", { name: "笔记保存与同步" }).waitFor();
    await page.getByRole("button", { name: "关闭更多阅读选项" }).click();
    await page.getByRole("button", { name: /^(编辑|完成编辑)$/, exact: true }).click();
    await page.locator(".annotation-controls").waitFor();
    await page.evaluate(() => { window.fixtureOnline = false; window.dispatchEvent(new Event("offline")); });
    const svg = page.locator("[data-page-turn-current] .annotation-overlay svg");
    // A layout change cancels an unfinished placement. Its release must not
    // open text, and the next touch must still be able to create a note.
    await svg.dispatchEvent("pointerdown", { pointerId: 2, pointerType: "touch", clientX: width / 2, clientY: 450, bubbles: true });
    await resizeAndSettle(page, 834);
    await svg.dispatchEvent("pointerup", { pointerId: 2, pointerType: "touch", clientX: width / 2, clientY: 450, bubbles: true });
    await expect(page.getByRole("textbox", { name: "笔记文本" })).toHaveCount(0);
    await resizeAndSettle(page, width);
    await svg.dispatchEvent("pointerdown", { pointerId: 1, pointerType: "touch", clientX: width / 2, clientY: 450, bubbles: true });
    await svg.dispatchEvent("pointerup", { pointerId: 1, pointerType: "touch", clientX: width / 2, clientY: 450, bubbles: true });
    await page.getByRole("textbox", { name: "笔记文本" }).fill("本机草稿等待重连");
    assert.equal(await page.locator(".annotation-controls").count(), 0);
    await page.evaluate(() => { window.fixtureStorageFailed = true; history.back(); });
    await page.getByText("本机保存失败", { exact: true }).waitFor();
    assert.equal(await page.getByRole("textbox", { name: "笔记文本" }).inputValue(), "本机草稿等待重连");
    await page.evaluate(() => { window.fixtureStorageFailed = false; });
    await page.evaluate(() => history.back());
    await page.getByRole("form", { name: "文字输入" }).waitFor({ state: "hidden" });
    await page.getByRole("button", { name: "编辑", exact: true }).waitFor();
    await page.getByRole("button", { name: "更多", exact: true }).click();
    await page.getByText("已保存在本机 · 等待联网", { exact: true }).waitFor();
    assert.equal(pushes, 0);
    await page.getByText("已保存在本机 · 等待联网", { exact: true }).scrollIntoViewIfNeeded();
    failSync = true;
    await page.evaluate(() => { window.fixtureOnline = true; window.dispatchEvent(new Event("online")); });
    await menu.getByRole("button", { name: "重试同步", exact: true }).waitFor();
    failSync = false;
    await menu.getByRole("button", { name: "重试同步", exact: true }).click();
    await page.getByText("没有待上传的修改", { exact: true }).waitFor();
    assert.ok(pushes > 0);
    await page.getByRole("button", { name: "关闭更多阅读选项" }).click();
    assert.equal(await page.locator("[data-page-turn-current] [data-pdf-canvas-active]").count(), 1);
    assert.deepEqual(errors, []);
    await context.close();
  }
});

async function resizeAndSettle(page, width) {
  await page.setViewportSize({ width, height: 900 });
  // setViewportSize finishes before ResizeObserver and React's layout commit.
  // Observe the paper across frames before sending another pointer sequence.
  await expect.poll(() => page.evaluate(async width => {
    const geometry = () => [...document.querySelectorAll(".page-reader__viewport, [data-page-turn-current] .annotation-overlay")]
      .map(element => {
        const rect = element.getBoundingClientRect();
        return [rect.x, rect.y, rect.width, rect.height];
      });
    const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
    await frame();
    const before = JSON.stringify(geometry());
    await frame();
    await frame();
    return innerWidth === width && before === JSON.stringify(geometry());
  }, width)).toBe(true);
}
