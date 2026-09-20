import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium, webkit } from "playwright";
import { expect } from "@playwright/test";

import { startVisualServer } from "./setup.mjs";
import { resolveFixtureRequest } from "./fixtures.mjs";

const repositoryRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
let server;
let origin = process.env.LAYOUT_TEST_ORIGIN;

before(async () => {
  if (!origin) {
    server = await startVisualServer({ script: "dev", cwd: repositoryRoot });
    origin = server.origin;
  }
});
after(async () => { await server?.stop(); });

// Cover both engines and each relevant identity without testing their full
// Cartesian products. Authorization behavior is exercised by component tests;
// these tests are responsible for real-browser layout and navigation.
for (const [engineName, engine, libraryIdentity, footerIdentity] of [
  ["chromium", chromium, "member", "guest"],
  ["webkit", webkit, "admin", "member"],
]) {
  test(`${engineName}: library controls remain usable with long filenames across viewport sizes`, async (t) => {
    const browser = await engine.launch({ headless: true });
    t.after(() => browser.close());
    const page = await openPage(browser, libraryIdentity);
    await page.goto(`${origin}/choirs/visual-choir`, { waitUntil: "domcontentloaded" });
    await page.locator(".file-row").nth(99).waitFor();
    for (const width of [320, 390, 600, 768, 834, 1194, 1440]) {
      await page.setViewportSize({ width, height: 1000 });

      const boxes = await Promise.all([
        page.getByRole("searchbox", { name: /搜索.*中的乐谱/ }),
        page.getByRole("combobox", { name: "乐谱排序" }),
        page.getByRole("button", { name: "打开云盘菜单" }),
        page.getByRole("button", { name: "我在此云盘" }),
      ].map(control => control.boundingBox()));
      assert.ok(boxes.every(box => box && box.width > 0 && box.height > 0 && box.x >= 0 && box.x + box.width <= width), `${width}: library controls are reachable ${JSON.stringify(boxes)}`);
      assert.ok(boxes.slice(0, 2).every(box => box.height >= 44), "search and sort retain their touch-sized controls");
      assert.ok(boxes.every((box, i) => boxes.slice(i + 1).every(other => box.x + box.width <= other.x || other.x + other.width <= box.x || box.y + box.height <= other.y || other.y + other.height <= box.y)), `${width}: library controls do not overlap`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      for (const selector of [".file-row__open", ".offline-score-button", ".file-menu-button"]) {
        const box = await page.locator(selector).first().boundingBox();
        assert.ok(box.width >= 44 && box.height >= 44 && box.x >= 0 && box.x + box.width <= width, `${width}: ${selector} usable without clipping`);
      }
      await capture(page, `${engineName}-library-${libraryIdentity}-${width}`);
    }
    await page.getByRole("searchbox", { name: /搜索.*中的乐谱/ }).fill("晨光");
    await page.getByRole("status").filter({ hasText: "找到 1 份" }).waitFor();
    await page.getByRole("combobox", { name: "乐谱排序" }).selectOption("updated");
    assert.equal(await page.locator(".file-row").count(), 1);
    await page.getByRole("button", { name: /更多操作/ }).focus();
    await page.keyboard.press("Enter");
    const exportItem = page.getByRole("menuitem", { name: "分享 PDF", exact: true });
    await exportItem.waitFor();
    await exportItem.focus();
    await page.keyboard.press("Escape");
    assert.equal(await page.getByRole("menu").count(), 0);
    await expect(page.getByRole("button", { name: /更多操作/ })).toBeFocused();
    await page.context().close();
  });

  test(`${engineName}: public footer supports keyboard navigation and direct privacy access`, async (t) => {
    const browser = await engine.launch({ headless: true });
    t.after(() => browser.close());
    const page = await openPage(browser, footerIdentity);
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto(`${origin}/privacy`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "隐私政策", exact: true }).waitFor();
    await page.getByRole("button", { name: "返回", exact: true }).click();
    await page.waitForURL(`${origin}/drives`);
    await page.getByRole("contentinfo").getByRole("link", { name: "隐私政策", exact: true }).waitFor();
    await page.getByRole("link", { name: "合谱 Same Page 首页", exact: true }).click();
    await page.getByRole("heading", { name: "Harmony begins on the Same Page", exact: true }).waitFor();
    assert.equal(new URL(page.url()).pathname, "/");
    const footer = page.getByRole("contentinfo");
    for (const name of ["使用手册", "关于合谱", "隐私政策"]) {
      const item = footer.getByRole("link", { name, exact: true });
      const box = await item.boundingBox();
      assert.ok(box.height >= 44 && box.width >= 44);
    }
    await page.evaluate(() => { window.__layoutDocumentMarker = "same-document"; });
    for (const [name, pathname] of [["关于合谱", "/about"], ["隐私政策", "/privacy"]]) {
      const link = footer.getByRole("link", { name, exact: true });
      await link.focus();
      await capture(page, `${engineName}-footer-${footerIdentity}-320`);
      await page.keyboard.press("Enter");
      await page.getByRole("heading", { name, exact: true }).waitFor();
      assert.equal(new URL(page.url()).pathname, pathname);
      assert.equal(await page.evaluate(() => window.__layoutDocumentMarker), "same-document");
      await page.goBack();
      await footer.getByRole("link", { name, exact: true }).waitFor();
    }
    await footer.getByRole("link", { name: "使用手册", exact: true }).press("Enter");
    await page.getByRole("heading", { name: "使用手册", exact: true }).waitFor();
    await page.getByRole("link", { name: "故障诊断", exact: true }).press("Enter");
    await page.getByText("查看诊断内容", { exact: true }).click();
    await page.getByRole("textbox", { name: "可发送给支持人员的诊断内容" }).waitFor();
    assert.equal(new URL(page.url()).pathname, "/diagnostics");
    assert.equal(await page.evaluate(() => window.__layoutDocumentMarker), "same-document");
    await page.context().close();
  });
}

async function openPage(browser, identity) {
  const context = await browser.newContext({ serviceWorkers: "block", locale: "zh-CN", colorScheme: "light" });
  await context.route("**/api/**", async route => {
    const pathname = new URL(route.request().url()).pathname;
    const response = resolveFixtureRequest({ pathname, method: route.request().method(), identity, cookie: route.request().headers().cookie ?? "" });
    if (pathname === "/api/choirs/visual-choir/bootstrap") {
      const data = JSON.parse(response.body);
      data.scores.push(...Array.from({ length: 100 - data.scores.length }, (_, i) => ({
        ...data.scores[0], id: `long-${i}`, fileName: `${i} ${"秋日合唱排练与正式演出全声部附歌词".repeat(5)}.pdf`,
      })));
      // Put a long filename first regardless of the default sort.
      data.scores[0].fileName = `000 ${"秋日合唱排练与正式演出全声部附歌词".repeat(5)}.pdf`;
      response.body = JSON.stringify(data);
    }
    await route.fulfill(response);
  });
  return context.newPage();
}

async function capture(page, name) {
  if (!process.env.LAYOUT_CAPTURE_DIR) return;
  await mkdir(process.env.LAYOUT_CAPTURE_DIR, { recursive: true });
  await page.screenshot({ path: path.join(process.env.LAYOUT_CAPTURE_DIR, `${name}.png`) });
}

test("phone home primary entry remains reachable on the narrowest screen", async t => {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await openPage(browser, "guest");
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto(`${origin}/#home`);
  await page.getByRole("link", { name: "先看示例", exact: true }).waitFor();
  const primary = page.getByRole("button", { name: "进入云盘", exact: true });
  await primary.click();
  await expect(page.getByRole("dialog")).toBeVisible();
});
