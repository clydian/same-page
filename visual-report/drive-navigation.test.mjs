import { chooseLibrarySort, refreshLibrary } from "./navigation-actions.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium, webkit, expect } from "@playwright/test";
import { startVisualServer } from "./setup.mjs";
import { createVisualFixtureSession } from "./fixtures.mjs";
import { withBrowserEvidence } from "../browser-tests/browser-evidence.mjs";

for (const [name, engine] of [["chromium", chromium], ["webkit", webkit]]) {
  test(`${name}: mobile drive navigation`, async t => {
    const app = await startVisualServer({ script: "dev" });
    t.after(() => app.stop());
    const browser = await engine.launch();
    t.after(() => browser.close());
    async function scenario(label, run, { attachments = false, height = 844, safeBottom = 0, delayed = false, emptyFirstAttachments = false } = {}) {
      await t.test(label, async () => {
        const context = await browser.newContext({ viewport: { width: 390, height }, serviceWorkers: "block" });
        try {
          await withBrowserEvidence(context, `artifacts/verification/drive-navigation/${name}-${label}`, async () => {
            const page = await context.newPage();
            const fixture = createVisualFixtureSession(attachments ? { id: "reader-practice", multipleSources: true } : {});
            let attachmentReads = 0;
            let releaseAttachments;
            const attachmentReady = new Promise(resolve => { releaseAttachments = resolve; });
            await page.route("**/api/**", async route => {
              const request = route.request();
              const pathname = new URL(request.url()).pathname;
              if (delayed && pathname.endsWith("/attachments")) await attachmentReady;
              const result = fixture.resolve({ pathname, method: request.method(), identity: "admin", cookie: "" });
              if (pathname.endsWith("/attachments") && ++attachmentReads === 1 && emptyFirstAttachments) result.body = JSON.stringify({ attachments: [] });
              if (pathname.endsWith("/bootstrap")) {
                const data = JSON.parse(result.body);
                data.scores = attachments ? data.scores.slice(0, 2) : Array.from({ length: 50 }, (_, i) => ({ ...data.scores[0], id: `score-${i}`, fileName: `排练乐谱 ${i + 1}.pdf` }));
                result.body = JSON.stringify(data);
              }
              return route.fulfill(result);
            });
            if (safeBottom) await page.addInitScript(value => { addEventListener("DOMContentLoaded", () => document.documentElement.style.setProperty("--safe-bottom", `${value}px`)); }, safeBottom);
            await run(page, releaseAttachments);
          });
        } finally { await context.close(); }
      });
    }
    await scenario("history-and-destinations", async page => {
      await page.goto("data:text/html,<h1>Previous document</h1>");
      await page.goto(`${app.origin}/choirs/visual-choir`);
      await page.getByRole("button", { name: "我的" }).waitFor();
      await page.getByRole("button", { name: /^切换云盘/ }).click();
      await page.getByRole("dialog", { name: "切换云盘" }).waitFor();
      await page.evaluate(() => history.back());
      await expect(page.getByRole("dialog", { name: "切换云盘" })).toBeHidden();
      assert.equal(new URL(page.url()).pathname, "/choirs/visual-choir");
      await page.evaluate(() => history.back());
      await page.getByRole("heading", { name: "Previous document" }).waitFor();
      await page.goto(`${app.origin}/choirs/visual-choir`);
      await page.getByRole("button", { name: "我的" }).waitFor();
      await page.getByRole("button", { name: /^切换云盘/ }).click();
      await page.getByRole("dialog", { name: "切换云盘" }).waitFor();
      await page.getByRole("link", { name: "云盘列表", exact: true }).click();
      await page.getByRole("heading", { name: "我已加入的云盘" }).waitFor();
      assert.equal(new URL(page.url()).pathname, "/drives");
      await page.getByRole("link", { name: "合谱 Same Page 首页" }).click();
      await page.getByRole("heading", { name: "Harmony begins on the Same Page", exact: true }).waitFor();
      assert.equal(new URL(page.url()).pathname, "/");
      await page.getByRole("link", { name: "我的云盘", exact: true }).click();
      await page.getByRole("heading", { name: "我已加入的云盘", exact: true }).waitFor();
      assert.equal(new URL(page.url()).pathname, "/drives");
      await page.getByRole("link", { name: /示例云盘/ }).click();
      await page.getByRole("dialog").waitFor({ state: "hidden" });
    });
    await scenario("personal-menu-scope", async page => {
      await page.goto(`${app.origin}/choirs/visual-choir`);
      const trigger = page.getByRole("button", { name: "我的", exact: true });
      await trigger.click();
      await expect(page.getByRole("menuitem", { name: "阅读偏好", exact: true })).toBeVisible();
      await expect(page.getByRole("menuitem", { name: "本机存储", exact: true })).toBeVisible();
      for (const name of ["账户", "使用手册", "问题反馈", "退出登录", "刷新列表"]) await expect(page.getByRole("menuitem", { name, exact: true })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(trigger).toBeFocused();
      await page.getByRole("button", { name: /^切换云盘/ }).click();
      for (const name of ["阅读偏好", "本机存储", "使用手册"]) await expect(page.getByRole("link", { name, exact: true })).toHaveCount(0);
      await page.getByRole("button", { name: "关闭云盘选择", exact: true }).click();
      await expect(page.getByRole("button", { name: /^切换云盘/ })).toBeFocused();
    });
    await scenario("drawer-keyboard-focus", async page => {
      await page.goto(`${app.origin}/choirs/visual-choir`);
      await page.getByRole("button", { name: /^切换云盘/ }).waitFor();
      await expect(page.getByRole("button", { name: /^切换云盘/ })).toBeEnabled();
      await page.getByRole("button", { name: /^切换云盘/ }).focus();
      await page.keyboard.press("Enter");
      await page.getByRole("dialog").waitFor();
      await page.keyboard.press("Escape");
      // React Aria restores focus on the next animation frame after unmount.
      await expect(page.getByRole("dialog", { name: "切换云盘" })).toBeHidden();
      await expect(page.getByRole("button", { name: /^切换云盘/ })).toBeFocused();
    });
    await scenario("scroll-upload", async page => {
      await page.goto(`${app.origin}/choirs/visual-choir`);
      const fab = page.getByRole("button", { name: "上传 PDF", exact: true });
      await expect(fab).toBeVisible();
      await page.evaluate(() => window.scrollTo(0, 500));
      await expect(fab).toBeHidden();
      // Hidden upload is neither a pointer target nor a keyboard stop.
      await page.locator(".upload-fab").evaluate(button => button.focus());
      await expect(page.locator(".upload-fab")).not.toBeFocused();
      await page.evaluate(() => window.scrollTo(0, 350));
      await expect(fab).toBeVisible();
      await fab.click();
      await expect(page.getByRole("dialog", { name: "上传 PDF", exact: true })).toBeVisible();
    });
    await scenario("focused-upload", async page => {
      await page.goto(`${app.origin}/choirs/visual-choir`);
      const fab = page.getByRole("button", { name: "上传 PDF", exact: true });
      await fab.focus();
      await page.evaluate(() => window.scrollTo(0, 500));
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(500);
      await expect(fab).toBeFocused();
      await fab.press("Enter");
      await expect(page.getByRole("dialog", { name: "上传 PDF", exact: true })).toBeVisible();
    });
    for (const safeBottom of [0, 34]) {
      await scenario(`short-attachments-${safeBottom}`, async page => {
        await page.goto(`${app.origin}/choirs/visual-choir`);
        await page.getByRole("button", { name: /2 个附件/ }).click();
        const menu = page.getByRole("button", { name: "示范录音.wav 更多操作" });
        await menu.waitFor();
        await expect.poll(() => page.evaluate(() => {
          const button = document.querySelector('[aria-label="示范录音.wav 更多操作"]');
          const rect = button.getBoundingClientRect();
          return button.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
        })).toBe(true);
        const displacement = await page.evaluate(() => window.scrollY);
        assert.ok(displacement > 0 && displacement < 110, `Only a small reveal scroll: ${displacement}`);
        // Click coordinates, so Playwright cannot scroll the target to repair the bug for us.
        const box = await menu.boundingBox();
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        await expect(page.getByRole("menu", { name: /示范录音.wav/ })).toBeVisible();
        await expect(page.getByRole("dialog", { name: "上传 PDF", exact: true })).toHaveCount(0);
        await page.keyboard.press("Escape");
        await page.getByRole("button", { name: /2 个附件/ }).click();
        await page.evaluate(() => window.scrollTo(0, 0));
        await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
        await expect(page.locator(".upload-fab")).toHaveAttribute("data-visible", "true");
        await page.getByRole("button", { name: /2 个附件/ }).click();
        await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
      }, { attachments: true, height: 675, safeBottom });
    }
    await scenario("delayed-attachments", async (page, release) => {
      await page.goto(`${app.origin}/choirs/visual-choir`);
      await page.getByRole("button", { name: /2 个附件/ }).click();
      await page.getByText("正在读取附件…").waitFor();
      assert.equal(await page.evaluate(() => window.scrollY), 0);
      release();
      await page.getByRole("button", { name: "示范录音.wav 更多操作" }).waitFor();
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    }, { attachments: true, height: 675, delayed: true });
    await scenario("collapsed-before-attachments", async (page, release) => {
      await page.goto(`${app.origin}/choirs/visual-choir`);
      const toggle = page.getByRole("button", { name: /2 个附件/ });
      await toggle.click();
      await page.getByText("正在读取附件…").waitFor();
      await toggle.click();
      release();
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      assert.equal(await page.evaluate(() => window.scrollY), 0);
      await expect(page.getByRole("button", { name: "上传 PDF", exact: true })).toBeVisible();
    }, { attachments: true, height: 675, delayed: true });
    await scenario("manual-scroll-during-attachments", async (page, release) => {
      await page.goto(`${app.origin}/choirs/visual-choir`);
      await page.getByRole("button", { name: /2 个附件/ }).click();
      await page.getByText("正在读取附件…").waitFor();
      await page.evaluate(() => window.scrollTo(0, 40));
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(40);
      release();
      await page.getByRole("button", { name: "示范录音.wav 更多操作" }).waitFor();
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await page.evaluate(() => window.scrollY), 40);
    }, { attachments: true, height: 675, delayed: true });
    await scenario("manual-scroll-back-during-attachments", async (page, release) => {
      await page.goto(`${app.origin}/choirs/visual-choir`);
      await page.getByRole("button", { name: /2 个附件/ }).click();
      await page.getByText("正在读取附件…").waitFor();
      await page.evaluate(() => window.scrollTo(0, 40));
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(40);
      await expect(page.locator(".upload-fab")).toHaveAttribute("data-visible", "false");
      await page.evaluate(() => window.scrollTo(0, 0));
      await expect(page.locator(".upload-fab")).toHaveAttribute("data-visible", "true");
      release();
      await page.getByRole("button", { name: "示范录音.wav 更多操作" }).waitFor();
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await page.evaluate(() => window.scrollY), 0);
    }, { attachments: true, height: 675, delayed: true });
    await scenario("filtered-pending-attachments", async (page, release) => {
      await page.goto(`${app.origin}/choirs/visual-choir`);
      await page.getByRole("button", { name: /2 个附件/ }).click();
      await page.getByText("正在读取附件…").waitFor();
      await page.getByRole("searchbox").fill("不存在");
      await page.getByText(/没有找到包含/).waitFor();
      release();
      assert.equal(await page.evaluate(() => window.scrollY), 0);
      await page.getByRole("searchbox").fill("");
      await page.getByRole("button", { name: "示范录音.wav 更多操作" }).waitFor();
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await page.evaluate(() => window.scrollY), 0, "Restoring filtered rows must not replay expansion intent");
    }, { attachments: true, height: 675, delayed: true });
    await scenario("sorted-pending-attachments", async (page, release) => {
      await page.goto(`${app.origin}/choirs/visual-choir`);
      await page.getByRole("button", { name: /2 个附件/ }).click();
      await page.getByText("正在读取附件…").waitFor();
      await chooseLibrarySort(page, "updated");
      await chooseLibrarySort(page, "name");
      release();
      await page.getByRole("button", { name: "示范录音.wav 更多操作" }).waitFor();
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await page.evaluate(() => window.scrollY), 0, "Changing sort must cancel pending expansion intent");
    }, { attachments: true, height: 675, delayed: true });
    await scenario("empty-attachments-then-refresh", async page => {
      await page.goto(`${app.origin}/choirs/visual-choir`);
      const loaded = page.waitForResponse(response => new URL(response.url()).pathname.endsWith("/attachments"));
      await page.getByRole("button", { name: /2 个附件/ }).click();
      await loaded;
      await expect(page.getByText("正在读取附件…")).toBeHidden();
      await expect(page.locator(".attachment-list")).toHaveCount(0);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await page.evaluate(() => window.scrollY), 0);
      await refreshLibrary(page);
      await page.getByRole("button", { name: "示范录音.wav 更多操作" }).waitFor();
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await page.evaluate(() => window.scrollY), 0, "A later refresh must not inherit the completed empty expansion");
    }, { attachments: true, height: 675, emptyFirstAttachments: true });
    await scenario("unobstructed-attachments", async page => {
      await page.goto(`${app.origin}/choirs/visual-choir`);
      await page.getByRole("button", { name: /2 个附件/ }).click();
      await page.getByRole("button", { name: "示范录音.wav 更多操作" }).waitFor();
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await page.evaluate(() => window.scrollY), 0);
      await expect(page.getByRole("button", { name: "上传 PDF", exact: true })).toBeVisible();
    }, { attachments: true });
    await scenario("empty-search-upload", async page => {
      await page.goto(`${app.origin}/choirs/visual-choir`);
      const fab = page.getByRole("button", { name: "上传 PDF", exact: true });
      await page.getByRole("searchbox", { name: /搜索.*中的乐谱/ }).fill("不存在");
      await page.getByText(/没有找到包含/).waitFor();
      await fab.click();
      await expect(page.getByRole("dialog", { name: "上传 PDF", exact: true })).toBeVisible();
    });
  });
}
