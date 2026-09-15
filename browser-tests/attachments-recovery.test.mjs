import assert from "node:assert/strict";
import test from "node:test";
import { chromium, webkit, expect } from "@playwright/test";
import { startStorageFixture } from "./storage-fixture.mjs";

for (const [engine, browserType] of [["chromium", chromium], ["webkit", webkit]]) {
  test(`attachments preserve document identity and recover interrupted writes (${engine})`, { timeout: 120_000 }, async t => {
    const fixture = await startStorageFixture({ authenticated: true, previewEntry: false });
    let browser;
    t.after(async () => { try { await browser?.close(); } finally { await fixture.stop(); } });
    browser = await browserType.launch();
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
    const account = fixture.accounts[0];
    assert.equal((await context.request.post(`${fixture.origin}/api/auth/sign-in/email`, { headers: { origin: fixture.origin }, data: { email: account.email, password: account.password } })).status(), 200);
    const page = await context.newPage();
    page.on("dialog", dialog => dialog.accept());
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    const url = `${fixture.origin}/choirs/${fixture.choirId}`;
    const api = `${fixture.origin}/api/choirs/${fixture.choirId}`;
    const list = async () => (await (await context.request.get(`${api}/attachments?scoreIds=${fixture.scoreId}`)).json()).attachments;
    const add = async kind => {
      await page.getByRole("button", { name: "本地链路测试 更多操作", exact: true }).click();
      await page.getByRole("menuitem", { name: "添加附件", exact: true }).click();
      await page.getByRole("button", { name: kind, exact: true }).click();
    };
    const compose = async () => { await add("文档（仅 .md）"); await page.getByRole("button", { name: "直接编写", exact: true }).click(); };
    const editor = page.locator('[contenteditable="true"]');
    const save = page.getByRole("button", { name: "保存", exact: true });
    const close = () => page.getByRole("button", { name: "关闭", exact: true }).click();
    await page.goto(url);
    await compose();
    await editor.fill("第一份文档的正文。"); await save.click();
    await page.getByRole("button", { name: "编辑", exact: true }).click();
    await editor.fill("第一份文档未保存的第二次编辑。");
    const original = (await list())[0];
    await page.reload();
    await page.getByRole("button", { name: /^本地链路测试：\d+ 个附件$/ }).click();
    await page.getByRole("button", { name: "排练笔记.md", exact: true }).click();
    await expect(editor).toHaveText("第一份文档未保存的第二次编辑。");
    await save.click();
    await expect(page.getByRole("button", { name: "编辑", exact: true })).toBeVisible();
    await close();

    await compose();
    await expect(editor).toHaveText("");
    await page.getByLabel("文件名", { exact: true }).fill("第二份.md");
    await editor.fill("独立的新文档。");
    const filePattern = "**/attachments/*/file?*";
    let loseCreate = true;
    await page.route(filePattern, async route => {
      if (route.request().method() === "POST" && loseCreate) { loseCreate = false; await route.abort("failed"); }
      else await route.continue();
    });
    await save.click();
    await page.getByRole("button", { name: "核对保存结果", exact: true }).click();
    await expect(save).toBeEnabled();
    await expect(editor).toHaveText("独立的新文档。");
    await save.click();
    await expect(page.getByRole("button", { name: "编辑", exact: true })).toBeVisible();
    await page.unroute(filePattern);
    await close();
    assert.equal((await list()).length, 2);
    assert.equal(await (await context.request.get(`${api}/scores/${fixture.scoreId}/attachments/${original.id}/file`)).text(), "第一份文档未保存的第二次编辑。");

    await add("PDF");
    await page.getByLabel("选择附件文件").setInputFiles({ name: "取消后重试.pdf", mimeType: "application/pdf", buffer: fixture.pdf });
    const attempts = [];
    page.on("request", request => { if (request.method() === "POST" && new URL(request.url()).searchParams.get("name") === "取消后重试.pdf") attempts.push(request.url()); });
    let held;
    await page.route(filePattern, route => { if (route.request().method() === "POST") held = route; else return route.continue(); });
    await page.getByRole("button", { name: "上传", exact: true }).click();
    await expect.poll(() => Boolean(held)).toBe(true);
    await context.setOffline(true);
    await expect(page.getByRole("dialog", { name: "添加PDF", exact: true })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "名称", exact: true })).toHaveValue("取消后重试.pdf");
    await expect(page.getByText("连接尚未恢复，输入已保留；联网后可继续保存或核对结果。", { exact: true })).toBeVisible();
    await context.setOffline(false);
    await page.getByRole("button", { name: "取消上传", exact: true }).click();
    await held.abort().catch(() => {});
    await page.unroute(filePattern);
    await page.getByRole("button", { name: "核对保存结果", exact: true }).click();
    await expect(page.getByRole("button", { name: "上传", exact: true })).toBeEnabled();
    await expect(page.getByLabel("选择附件文件")).toBeEnabled();
    await page.getByRole("button", { name: "上传", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    assert.equal(attempts.length, 2);
    assert.equal(attempts[0], attempts[1], "Going offline preserves the original upload request identity");
    assert.equal((await list()).filter(item => item.name === "取消后重试.pdf").length, 1);

    // The server commits the DELETE, but the browser receives no response.
    await page.route("**/attachments/*?expectedRevision=*", async route => {
      if (route.request().method() === "DELETE") { await route.fetch(); await route.abort("failed"); }
      else await route.continue();
    });
    await page.getByRole("button", { name: "取消后重试.pdf 更多操作", exact: true }).click();
    await page.getByRole("menuitem", { name: "移到回收站", exact: true }).click();
    await page.getByRole("button", { name: "移到回收站", exact: true }).click();
    await page.getByRole("button", { name: "核对保存结果", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    assert.equal((await list()).length, 2);
    assert.deepEqual(errors, []);
  });
}
