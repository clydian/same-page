import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import test from "node:test";
import { chromium, webkit, expect } from "@playwright/test";
import { startStorageFixture } from "./storage-fixture.mjs";

for (const [name, engine] of [["chromium", chromium], ["webkit", webkit]]) {
  test(`${name}: foreground member entry reaches the authorized usage view`, { timeout: 90000 }, async t => {
    const f = await startStorageFixture({ authenticated: true, productAdmin: true, previewEntry: false });
    t.after(() => f.stop());
    const browser = await engine.launch();
    t.after(() => browser.close());
    const login = async index => {
      const context = await browser.newContext({ locale: "zh-CN", serviceWorkers: "block", viewport: { width: 1194, height: 834 } });
      const response = await context.request.post(`${f.origin}/api/auth/sign-in/email`, {
        headers: { origin: f.origin }, data: { email: f.accounts[index].email, password: f.accounts[index].password },
      });
      assert.equal(response.status(), 200);
      return context;
    };
    const memberContext = await login(0), page = await memberContext.newPage();
    const receipt = page.waitForResponse(response => response.url().endsWith(`/choirs/${f.choirId}/visits`) && response.request().method() === "POST");
    await page.goto(`${f.origin}/choirs/${f.choirId}`);
    assert.equal((await receipt).status(), 204);
    assert.equal((await memberContext.request.get(`${f.origin}/api/admin/drive-usage`)).status(), 403);

    const operatorContext = await login(1), admin = await operatorContext.newPage();
    await admin.goto(`${f.origin}/admin?view=usage`);
    await expect(admin.getByRole("heading", { name: "云盘使用情况" })).toBeVisible();
    const navigation = [
      ["link", "发布通道", "发布通道"],
      ["link", "问题反馈", "问题反馈"],
      ["link", "乐谱工作台", "乐谱工作台"],
      ["button", "操作记录", "最近操作"],
      ["link", "云盘使用情况", "云盘使用情况"],
    ];
    for (const [role, label, heading] of navigation) {
      await admin.getByRole(role, { name: label, exact: true }).click();
      await expect(admin.getByRole("heading", { name: heading, exact: true })).toBeVisible();
    }
    const actual = await (await operatorContext.request.get(`${f.origin}/api/admin/drive-usage`)).json();
    const visited = actual.drives.find(d => d.id === f.choirId);
    assert.equal(visited.visitors7d, 1); assert.equal(visited.visitors30d, 1);
    assert.ok(visited.lastMemberVisitAt > 0);
    const row = admin.getByRole("row").filter({ hasText: "本地链路云盘" });
    await expect(row).toContainText("7 天：1");
    await expect(admin.getByText("未知（尚无记录）")).toBeVisible();
    // A real operator who is also a member must not contaminate the totals.
    await operatorContext.request.post(`${f.origin}/api/choirs/${f.choirId}/visits`, {
      headers: { origin: f.origin, "x-same-page-owner-user-id": f.accounts[1].id, "x-same-page-visit": "foreground" },
    });
    const unchanged = await (await operatorContext.request.get(`${f.origin}/api/admin/drive-usage`)).json();
    assert.equal(unchanged.drives.find(d => d.id === f.choirId).visitors7d, 1);

    // Controlled synthetic response exercises unknown historical windows and
    // quota warnings without modifying production or expanding the shared seed.
    await admin.route("**/api/admin/drive-usage?*", async route => {
      const now = Date.now();
      await route.fulfill({ json: { collectionStartedAt: now - 2 * 86400000, asOf: now, next: null, drives: [
        { ...visited, name: "海风合唱云盘", plan: "free", createdAt: now - 90 * 86400000, usedBytes: 48 * 1048576, limitBytes: 50 * 1048576, scoreCount: 8, scoreLimit: 10, memberCount: 12, memberLimit: 100, visitors7d: 4, visitors30d: 4 },
        { ...visited, id: "new-drive", name: "周末排练", plan: "configured", createdAt: now, usedBytes: 12 * 1048576, limitBytes: 500 * 1048576, scoreCount: 3, scoreLimit: null, memberCount: 5, memberLimit: 50, visitors7d: 0, visitors30d: 0, lastMemberVisitAt: null },
      ] } });
    });
    await admin.getByRole("button", { name: "刷新用量" }).click();
    await expect(admin.getByText("接近容量上限 · 96%")).toBeVisible();
    await expect(admin.getByText("7 天：未知（已记录 4）")).toBeVisible();
    await expect(admin.getByText("成员 12 / 100")).toBeVisible();
    if (process.env.DRIVE_USAGE_SCREENSHOTS) {
      await mkdir("artifacts/verification/drive-usage", { recursive: true });
      // Replace the random fixture email with a clearly synthetic identity.
      await admin.locator(".admin-identity").evaluate(el => { el.textContent = "operator@example.invalid"; });
      for (const viewport of [{ width: 1194, height: 834 }, { width: 834, height: 1194 }, { width: 390, height: 844 }]) {
        await admin.setViewportSize(viewport);
        for (const [role, label] of navigation) {
          await expect(admin.getByRole(role, { name: label, exact: true })).toBeVisible();
        }
        await admin.screenshot({ path: `artifacts/verification/drive-usage/${name}-${viewport.width}.png`, fullPage: true });
      }
    }
  });
}
