import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { before, after, test } from "node:test";
import { chromium, webkit, expect } from "@playwright/test";
import { startVisualServer } from "./setup.mjs";
import { createVisualFixtureSession } from "./fixtures.mjs";
import { withBrowserEvidence } from "../browser-tests/browser-evidence.mjs";

let app;
before(async () => { app = await startVisualServer({ script: "dev" }); await mkdir("artifacts/verification/issue-485", { recursive: true }); });
after(async () => app?.stop());

for (const [name, engine] of [["chromium", chromium], ["webkit", webkit]]) {
  test(`${name}: actual invitation card image joins through existing admission, versions and feedback remain accessible`, async t => {
    const browser = await engine.launch(); t.after(() => browser.close());
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
    await withBrowserEvidence(context, `artifacts/verification/issue-485/${name}-invitation-flow`, async () => {
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    await page.addInitScript(() => localStorage.setItem("reader-gesture-hint-seen", "true"));
    const fixture = createVisualFixtureSession({ id: "library-invite-active" });
    let admission = null;
    const cancelInvitation = async () => {
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog", { name: "加入「受邀云盘」", exact: true })).toHaveCount(0);
      const picker = page.getByRole("dialog", { name: "切换云盘", exact: true });
      await expect(picker).toBeVisible();
      await picker.getByRole("button", { name: "关闭云盘选择", exact: true }).click();
      await expect(picker).toHaveCount(0);
      await expect(page.getByRole("button", { name: /^切换云盘/ })).toBeFocused();
    };
    await context.route("**/api/**", async route => {
      const request = route.request(), pathname = new URL(request.url()).pathname;
      if (pathname === "/api/guest/session" && request.method() === "POST") {
        admission = request.postDataJSON();
        return route.fulfill({ json: { choir: { id: "invited-drive", name: "受邀云盘", guestAdmissionMode: "invite" }, entryKind: "admission" } });
      }
      if (pathname === "/api/choirs/current-guest/join-state") return route.fulfill({ json: { status: "display-name-required", choir: { id: "invited-drive", name: "受邀云盘", guestAdmissionMode: "invite" } } });
      return route.fulfill(fixture.resolve({ pathname, method: request.method(), identity: "admin", cookie: "" }));
    });
    await page.goto(`${app.origin}/choirs/visual-choir/settings/admission`);
    const card = page.getByRole("img", { name: "示例云盘邀请二维码" });
    await expect(card).toBeVisible();
    const buffer = await card.screenshot();
    await page.goto(`${app.origin}/choirs/visual-choir`);
    await page.getByRole("button", { name: /^切换云盘/ }).click();
    await page.getByRole("button", { name: "加入新云盘", exact: true }).click();
    await page.screenshot({ path: `artifacts/verification/issue-485/${name}-invite.png` });
    await page.getByLabel("选择邀请卡图片").setInputFiles({ name: "invitation.png", mimeType: "image/png", buffer });
    await expect(page.getByRole("dialog", { name: "加入「受邀云盘」", exact: true })).toBeVisible();
    assert.deepEqual(admission, { admission: "invite", joinCode: "ABCDEFGH" });
    await cancelInvitation();
    if (name === "chromium") {
      // Real video frames + real decoder, with a synthetic camera source rather than hardware permission.
      await page.evaluate(async source => {
        const image = new Image(); image.src = source; await image.decode();
        const canvas = document.createElement("canvas"); canvas.width = image.width; canvas.height = image.height;
        const draw = () => canvas.getContext("2d").drawImage(image, 0, 0);
        draw(); const stream = canvas.captureStream(10), timer = setInterval(draw, 100);
        window.testCameraStops = 0;
        for (const track of stream.getTracks()) { const stop = track.stop.bind(track); track.stop = () => { window.testCameraStops++; clearInterval(timer); stop(); }; }
        navigator.mediaDevices.getUserMedia = async () => stream;
      }, `data:image/png;base64,${buffer.toString("base64")}`);
      await page.getByRole("button", { name: /^切换云盘/ }).click();
      await page.getByRole("button", { name: "加入新云盘", exact: true }).click();
      await page.getByRole("button", { name: "扫一扫", exact: true }).click();
      await expect(page.getByRole("dialog", { name: "加入「受邀云盘」", exact: true })).toBeVisible();
      assert.ok(await page.evaluate(() => window.testCameraStops > 0), "successful scan releases the camera");
      await cancelInvitation();
    }
    // Continue through the UI after cancellation. Reloading this same URL while
    // the picker/history checkpoint is returning is unrelated to invitation coverage.
    await page.getByRole("button", { name: "我的", exact: true }).click();
    await page.getByRole("menuitem", { name: /关于与更新/ }).click();
    await expect(page.getByRole("heading", { name: "关于合谱", exact: true })).toBeVisible();
    await expect(page.getByText(/^v\d{2}\.\d{2}\.\d{2}\.\d{4}$/, { exact: true })).toBeVisible();
    await page.getByText("版本与技术信息", { exact: true }).click();
    await expect(page.getByRole("button", { name: "复制版本信息" })).toBeVisible();
    await page.screenshot({ path: `artifacts/verification/issue-485/${name}-about.png`, fullPage: true });
    await page.goto(`${app.origin}/choirs/visual-choir/scores/visual-score`);
    await page.locator("canvas[data-pdf-canvas-active]").first().waitFor();
    await page.locator(".page-reader__viewport").click({ position: { x: 180, y: 300 } });
    await page.getByRole("button", { name: "更多", exact: true }).click();
    await page.getByRole("button", { name: "问题反馈", exact: true }).click();
    const feedback = page.getByRole("dialog", { name: "问题反馈" });
    await expect(feedback).toBeVisible();
    await feedback.getByText("诊断信息与隐私说明", { exact: true }).click();
    const report = JSON.parse(await feedback.getByLabel("可发送给维护人员的诊断信息").inputValue());
    assert.equal(report.reader.interactionMode, "reading"); assert.equal(report.retentionDays, 180);
    assert.match(report.clientVersion, /^v\d{2}\.\d{2}\.\d{2}\.\d{4}$/);
    await page.screenshot({ path: `artifacts/verification/issue-485/${name}-reader-feedback.png`, fullPage: true });
    });
  });

  test(`${name}: support-only inbox filters, marks and deletes with confirmation on narrow screens`, async t => {
    const browser = await engine.launch(); t.after(() => browser.close());
    const context = await browser.newContext({ viewport: { width: 320, height: 800 }, serviceWorkers: "block" });
    const page = await context.newPage(), fixture = createVisualFixtureSession({ id: "library-invite-active" });
    const id = "11111111-1111-4111-8111-111111111111";
    let status = "new", deleted = false;
    const now = Date.now();
    const report = { id, version: 1, retentionDays: 180, clientBuild: "abcdef1", clientVersion: "v26.10.20.1830", description: "iPad 阅读谱面时显示不正常，没有错误提示。", records: [], reader: null,
      environment: { browser: "safari", browserVersion: "18.1", system: "ios", systemVersion: null, viewportWidth: 390, viewportHeight: 844, standalone: true, serviceWorkerControlled: true, onlineHint: true } };
    const summary = () => ({ id, clientBuild: report.clientBuild, clientVersion: report.clientVersion, description: report.description, categories: [], status, createdAt: now, expiresAt: now + 180 * 86400000 });
    await context.route("**/api/**", async route => {
      const request = route.request(), pathname = new URL(request.url()).pathname;
      if (pathname === "/api/admin/session") return route.fulfill({ json: { viewScores: 0, reviewXml: 0, publishXml: 0, manageReports: 1, deleteReports: 1 } });
      if (pathname === "/api/admin/reports") return route.fulfill({ json: { reports: deleted ? [] : [summary()], next: null } });
      if (pathname === `/api/admin/reports/${id}`) {
        if (request.method() === "PATCH") status = request.postDataJSON().status;
        if (request.method() === "DELETE") deleted = true;
        return route.fulfill({ json: request.method() === "GET" ? { ...summary(), report } : { id } });
      }
      return route.fulfill(fixture.resolve({ pathname, method: request.method(), identity: "admin", cookie: "" }));
    });
    await page.goto(`${app.origin}/admin/reports`);
    await expect(page.getByRole("link", { name: "乐谱工作台", exact: true })).toHaveCount(0);
    await page.getByLabel("版本或构建 SHA").fill(report.clientVersion);
    await page.getByRole("button", { name: "筛选反馈" }).click();
    await expect(page.getByRole("link", { name: report.description })).toBeVisible();
    assert.equal(new URL(page.url()).searchParams.get("build"), report.clientVersion);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: `artifacts/verification/issue-485/${name}-inbox.png`, fullPage: true });
    await page.getByRole("link", { name: report.description }).click();
    await page.getByRole("button", { name: "标记为调查中" }).click();
    await expect(page.getByRole("button", { name: "标记为调查中" })).toBeDisabled();
    await page.screenshot({ path: `artifacts/verification/issue-485/${name}-detail.png`, fullPage: true });
    await page.getByRole("button", { name: "删除反馈", exact: true }).click();
    const confirm = page.getByRole("dialog", { name: "删除这份反馈？" });
    await expect(confirm).toBeVisible(); assert.equal(deleted, false);
    await confirm.getByRole("button", { name: "确认删除", exact: true }).click();
    await expect(page.getByText("没有符合条件的反馈。", { exact: true })).toBeVisible();
    assert.equal(deleted, true);
  });
}
