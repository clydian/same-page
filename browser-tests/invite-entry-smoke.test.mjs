import { mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
import test from "node:test";
import { chromium, expect } from "@playwright/test";
import { startStorageFixture } from "./storage-fixture.mjs";

test("valid invitations automatically admit guests, existing members and named new members", { timeout: 90000 }, async t => {
  const fixture = await startStorageFixture({ authenticated: true, invite: true, nonMember: true });
  t.after(() => fixture.stop());
  const browser = await chromium.launch(); t.after(() => browser.close());
  for (const mode of ["fresh", "warm", "member", "new-member"]) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    try {
      if (mode === "member" || mode === "new-member") {
        const account = fixture.accounts[mode === "new-member" ? 1 : 0];
        assert.equal((await context.request.post(`${fixture.origin}/api/auth/sign-in/email`, { headers: { origin: fixture.origin }, data: { email: account.email, password: account.password } })).status(), 200);
      }
      const page = await context.newPage();
      await page.addInitScript(() => localStorage.setItem("reader-gesture-hint-seen", "true"));
      let admissions = 0;
      page.on("request", request => {
        if (new URL(request.url()).pathname === "/api/guest/session" && request.method() === "POST") {
          admissions += 1;
          // Record only credential-free state; never emit the invitation URL.
          assert.equal(new URL(page.url()).hash === "", true, "invitation fragment must be cleared");
        }
      });
      if (mode === "warm") {
        await page.goto(fixture.origin + "/?join=1");
        await page.getByRole("button", { name: "关闭", exact: true }).click();
        await page.evaluate(code => { location.hash = new URLSearchParams({ invite: code }).toString(); }, fixture.joinCode);
      } else {
        await page.goto(`${fixture.origin}/?join=1#${new URLSearchParams({ invite: fixture.joinCode })}`);
      }
      if (mode === "new-member") {
        await page.getByLabel("显示名", { exact: true }).fill("新排练成员");
        await page.getByRole("button", { name: "加入并进入", exact: true }).click();
      }
      await expect(page.getByRole("heading", { name: "本地链路云盘", exact: true })).toBeVisible();
      assert.equal(new URL(page.url()).pathname, `/choirs/${fixture.choirId}`);
      assert.equal(new URL(page.url()).hash === "", true, "invitation fragment must be cleared");
      await expect(page.getByLabel("显示名", { exact: true })).toHaveCount(0);
      await expect(page.locator(".file-row__open")).toHaveCount(1);
      assert.equal(admissions, 1);
      if (mode === "fresh") {
        await expect(page.getByRole("link", { name: "暂不添加，直接登录", exact: true })).toBeVisible();
        if (process.env.LAYOUT_CAPTURE_DIR) {
          await mkdir(process.env.LAYOUT_CAPTURE_DIR, { recursive: true });
          await page.screenshot({ path: `${process.env.LAYOUT_CAPTURE_DIR}/guest-drive-phone.png`, fullPage: true });
        }
        await page.getByRole("button", { name: "暂时不用，关闭排练准备" }).click();
        await expect(page.getByRole("complementary", { name: "排练准备" })).toHaveCount(0);
        await page.locator(".file-row__open").click();
        await page.locator("canvas[data-pdf-canvas-active]").first().waitFor();
        await page.locator(".page-reader__viewport").click({ position: { x: 195, y: 340 } });
        await page.getByRole("button", { name: "返回云盘", exact: true }).click();
        await expect(page.getByRole("heading", { name: "本地链路云盘", exact: true })).toBeVisible();
        await expect(page.getByRole("complementary", { name: "排练准备" })).toHaveCount(0);
        await page.reload();
        await expect(page.getByRole("complementary", { name: "排练准备" })).toBeVisible();
        await page.evaluate(() => window.dispatchEvent(new Event("appinstalled")));
        await expect(page.getByText("已添加到桌面", { exact: true })).toBeVisible();
        await expect(page.getByRole("link", { name: "注册 / 登录，开始记笔记", exact: true })).toBeVisible();
        if (process.env.LAYOUT_CAPTURE_DIR) await page.screenshot({ path: `${process.env.LAYOUT_CAPTURE_DIR}/login-remaining-phone.png`, fullPage: true });
        await page.locator(".file-row__open").click();
        await page.locator("canvas[data-pdf-canvas-active]").first().waitFor();
        await page.locator(".page-reader__viewport").click({ position: { x: 195, y: 340 } });
        await page.getByRole("button", { name: "编辑", exact: true }).click();
        const dialog = page.getByRole("dialog", { name: "登录后，记下你的排练笔记" });
        await expect(dialog).toBeVisible();
        await expect(page.locator(".annotation-controls")).toHaveCount(0);
        if (process.env.LAYOUT_CAPTURE_DIR) await page.screenshot({ path: `${process.env.LAYOUT_CAPTURE_DIR}/guest-reader-phone.png` });
        await dialog.getByRole("button", { name: "继续看谱" }).click();
        await page.getByRole("button", { name: "编辑", exact: true }).click();
        await dialog.getByRole("link", { name: "注册 / 登录，开始记笔记" }).click();
        const target = `/choirs/${fixture.choirId}/scores/${fixture.scoreId}`;
        await expect.poll(() => new URL(page.url()).searchParams.get("returnTo")).toBe(target);
        await page.getByLabel("邮箱", { exact: true }).fill(fixture.accounts[0].email);
        await page.getByRole("button", { name: "继续", exact: true }).click();
        await page.getByLabel("密码", { exact: true }).fill(fixture.accounts[0].password);
        await page.getByRole("button", { name: "登录", exact: true }).click();
        await expect(page).toHaveURL(fixture.origin + target);
        await page.locator("canvas[data-pdf-canvas-active]").first().waitFor();
        await page.locator(".page-reader__viewport").click({ position: { x: 195, y: 340 } });
        await page.getByRole("button", { name: "编辑", exact: true }).click();
        await expect(page.locator(".annotation-controls")).toBeVisible();

      }
      if (mode === "member") {
        await expect(page.getByText("已登录并加入云盘", { exact: true })).toBeVisible();
        await expect(page.getByRole("link", { name: "暂不添加，直接登录", exact: true })).toHaveCount(0);
        if (process.env.LAYOUT_CAPTURE_DIR) await page.screenshot({ path: `${process.env.LAYOUT_CAPTURE_DIR}/install-remaining-phone.png`, fullPage: true });
        await page.evaluate(() => window.dispatchEvent(new Event("appinstalled")));
        await expect(page.getByRole("complementary", { name: "排练准备" })).toHaveCount(0);
        if (process.env.LAYOUT_CAPTURE_DIR) await page.screenshot({ path: `${process.env.LAYOUT_CAPTURE_DIR}/ready-phone.png`, fullPage: true });
      }
    } finally { await context.close(); }
  }
});
