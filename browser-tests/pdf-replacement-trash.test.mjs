import assert from "node:assert/strict";
import test from "node:test";
import { mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { chromium, webkit, expect } from "@playwright/test";
import { startStorageFixture } from "./storage-fixture.mjs";

const xml = Buffer.from('<score-partwise><part-list><score-part id="P1"><part-name>Alto</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note></measure></part></score-partwise>');
for (const [engine, browserType] of [["chromium", chromium], ["webkit", webkit]]) {
  test(`PDF replacement, generated XML choice and independent recovery (${engine})`, { timeout: 120_000 }, async t => {
    const fixture = await startStorageFixture({ authenticated: true, previewEntry: false });
    let browser;
    t.after(async () => { try { await browser?.close(); } finally { await fixture.stop(); } });
    browser = await browserType.launch();
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
    const account = fixture.accounts[0];
    assert.equal((await context.request.post(`${fixture.origin}/api/auth/sign-in/email`, { headers: { origin: fixture.origin }, data: { email: account.email, password: account.password } })).status(), 200);
    const api = `${fixture.origin}/api/choirs/${fixture.choirId}`;
    const source = `${api}/scores/${fixture.scoreId}`;
    const userId = randomUUID(), generatedId = randomUUID();
    for (const [id, name, generated] of [[userId, "用户校订.musicxml", false], [generatedId, "自动生成练习版.musicxml", true]]) {
      assert.equal((await context.request.post(`${source}/attachments/${id}/file?${new URLSearchParams({ name, size: String(xml.length), ...(generated ? { source: "generated" } : {}) })}`,
        { data: xml, headers: { origin: fixture.origin, "content-type": "application/octet-stream" } })).status(), 201);
    }
    const page = await context.newPage();
    const url = `${fixture.origin}/choirs/${fixture.choirId}`;
    await page.goto(url);
    await page.getByRole("button", { name: /本地链路测试：2 个附件/ }).click();
    await expect(page.getByText(/自动生成练习版.musicxml.*自动生成.*Beta/)).toBeVisible();
    const replace = async keep => {
      await page.getByRole("button", { name: "本地链路测试 更多操作", exact: true }).click();
      await page.getByRole("menuitem", { name: "替换 PDF", exact: true }).click();
      const picker = page.getByLabel("新的 PDF（最多 20 MB、500 页）");
      await expect(picker).toBeEnabled();
      await picker.setInputFiles({ name: "替换谱.pdf", mimeType: "application/pdf", buffer: fixture.pdf });
      const dialog = page.getByRole("dialog", { name: "替换 PDF", exact: true });
      const choice = dialog.getByLabel("保留自动生成的练习版");
      await expect(choice).toBeChecked();
      if (!keep) await choice.uncheck();
      await dialog.getByLabel(/我已检查预览/).check();
      const confirm = dialog.getByRole("button", { name: "确认替换", exact: true });
      await expect(confirm).toBeEnabled();
      if (!keep) {
        await choice.scrollIntoViewIfNeeded();
        await mkdir("artifacts/verification/pdf-replacement-trash", { recursive: true });
        await page.screenshot({ path: `artifacts/verification/pdf-replacement-trash/${engine}-replace.png`, fullPage: true });
      }
      await confirm.click();
      await expect(dialog).toHaveCount(0);
    };
    const original = (await (await context.request.get(`${source}/versions`)).json()).currentVersionId;
    await replace(true);
    assert.equal((await context.request.get(`${source}/attachments/${generatedId}/file`)).status(), 200);
    await replace(false);
    assert.equal((await context.request.get(`${source}/attachments/${generatedId}/file`)).status(), 404);
    assert.equal((await context.request.get(`${source}/attachments/${userId}/file`)).status(), 200);
    const current = (await (await context.request.get(`${source}/versions`)).json()).currentVersionId;
    assert.notEqual(current, original);
    await page.goto(url + "/settings/trash");
    const trash = page.getByRole("region", { name: "被替换的 PDF", exact: true });
    await expect(trash.getByRole("button", { name: "恢复", exact: true })).toHaveCount(2);
    await trash.getByRole("button", { name: "恢复", exact: true }).first().click();
    await expect(trash.getByLabel("恢复后的文件名")).toHaveValue("本地链路测试（恢复）");
    await page.screenshot({ path: `artifacts/verification/pdf-replacement-trash/${engine}-trash.png`, fullPage: true });
    await trash.getByRole("button", { name: "恢复为独立乐谱", exact: true }).click();
    await expect(trash.getByRole("button", { name: "恢复", exact: true })).toHaveCount(1);
    assert.equal((await (await context.request.get(`${source}/versions`)).json()).currentVersionId, current);
    await page.goto(url);
    await expect(page.getByRole("link", { name: /本地链路测试（恢复）/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /本地链路测试/ }).first()).toBeVisible();
  });
}
