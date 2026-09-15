import assert from "node:assert/strict";
import test from "node:test";
import { chromium, webkit, expect } from "@playwright/test";
import { startStorageFixture } from "./storage-fixture.mjs";

async function hold(page, pattern) {
  let release;
  let held = false;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route(pattern, async route => { held = true; await gate; await route.continue().catch(() => {}); });
  return { wait: () => expect.poll(() => held).toBe(true), release: async () => { release(); await page.unroute(pattern); } };
}
const top = locator => locator.evaluate(element => element.getBoundingClientRect().top);
const stays = (before, after, message) => assert.ok(Math.abs(before - after) < 1, `${message}: ${before} → ${after}`);
const chunk = name => url => new RegExp(`/assets/${name}-[^/]+\\.js$`).test(url.pathname);

for (const [engine, browserType, width] of [["chromium", chromium, 1280], ["webkit", webkit, 390]]) {
  test(`loading keeps local content, controls and close actions stable (${engine})`, { timeout: 120_000 }, async t => {
    const fixture = await startStorageFixture({ authenticated: true, previewEntry: false });
    let browser;
    t.after(async () => { try { await browser?.close(); } finally { await fixture.stop(); } });
    browser = await browserType.launch();
    const context = await browser.newContext({ viewport: { width, height: 844 }, serviceWorkers: "block" });
    const account = fixture.accounts[0];
    assert.equal((await context.request.post(`${fixture.origin}/api/auth/sign-in/email`, { headers: { origin: fixture.origin }, data: { email: account.email, password: account.password } })).status(), 200);
    const api = `${fixture.origin}/api/choirs/${fixture.choirId}`;
    const secondResponse = await context.request.post(`${api}/scores`, { multipart: { file: { name: "第二份.pdf", mimeType: "application/pdf", buffer: fixture.pdf } } });
    assert.equal(secondResponse.status(), 201);
    const second = (await secondResponse.json()).score;
    const thirdResponse = await context.request.post(`${api}/scores`, { multipart: { file: { name: "第三份.pdf", mimeType: "application/pdf", buffer: fixture.pdf } } });
    assert.equal(thirdResponse.status(), 201);
    const third = (await thirdResponse.json()).score;
    for (const [id, name] of [[fixture.scoreId, "第一份参考"], [second.id, "第二份参考"], [third.id, "第三份参考"]]) {
      assert.equal((await context.request.post(`${api}/scores/${id}/attachments/links`, { data: { id: crypto.randomUUID(), name, url: "https://example.org/" } })).status(), 201);
    }
    const page = await context.newPage();
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${fixture.origin}/choirs/${fixture.choirId}`);
    const firstButton = page.getByRole("button", { name: "本地链路测试：1 个附件", exact: true });
    const secondButton = page.getByRole("button", { name: "第二份：1 个附件", exact: true });
    await firstButton.waitFor();
    const install = page.getByRole("button", { name: "暂时不用，关闭安装建议", exact: true });
    if (await install.isVisible()) await install.click();
    for (const [button, expectedName] of [[firstButton, "第一份参考"], [secondButton, "第二份参考"]]) {
      const before = await top(button);
      const gate = await hold(page, "**/api/choirs/*/attachments?*");
      await button.click(); await gate.wait();
      const group = page.locator(".score-file-group").filter({ has: button });
      await expect(group.getByRole("status")).toHaveText("正在读取附件…");
      stays(before, await top(button), "Expanding does not move its own score row");
      if (button === secondButton) await expect(page.getByRole("link", { name: "第一份参考", exact: true })).toBeVisible();
      const previousRows = await page.locator(".file-row").evaluateAll(rows => rows.map(row => row.getBoundingClientRect().top));
      await gate.release();
      await expect(page.getByRole("link", { name: expectedName, exact: true })).toBeVisible();
      const loadedRows = await page.locator(".file-row").evaluateAll(rows => rows.map(row => row.getBoundingClientRect().top));
      previousRows.forEach((value, index) => stays(value, loadedRows[index], "Attachment placeholder reserves the actual row space"));
    }

    // A failed request for an unread row must not erase another score.
    await page.route("**/api/choirs/*/attachments?*", route => route.fulfill({ status: 503, body: "unavailable" }));
    await page.getByRole("button", { name: "第三份：1 个附件", exact: true }).click();
    await expect(page.getByText("暂时无法读取附件。", { exact: false })).toBeVisible();
    await expect(page.getByRole("link", { name: "第二份参考", exact: true })).toBeVisible();
    await page.unroute("**/api/choirs/*/attachments?*");
    await page.getByRole("button", { name: "重试", exact: true }).click();
    await expect(page.getByRole("link", { name: "第三份参考", exact: true })).toBeVisible();

    const openAction = async name => {
      await page.getByRole("button", { name: "本地链路测试 更多操作", exact: true }).click();
      await page.getByRole("menuitem", { name, exact: true }).click();
    };
    for (const [name, module] of [["添加附件", "attachment-dialog"], ["替换 PDF", "pdf-version-dialog"], ["分享 PDF", "library-export-dialog"]]) {
      const gate = await hold(page, chunk(module));
      await openAction(name); await gate.wait();
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByRole("heading", { name, exact: true })).toBeVisible();
      const before = await top(dialog.getByRole("heading", { name, exact: true }));
      await expect(dialog.getByRole("button", { name: "关闭", exact: true })).toBeVisible();
      if (name === "添加附件") {
        await dialog.getByRole("button", { name: "关闭", exact: true }).click();
        await expect(dialog).toHaveCount(0);
        const response = page.waitForResponse(response => chunk(module)(new URL(response.url())));
        await gate.release(); await (await response).finished();
        await expect(dialog).toHaveCount(0); // A late module cannot reopen a cancelled dialog.
        await openAction(name);
        await expect(dialog.getByRole("button", { name: "音频", exact: true })).toBeVisible();
      } else {
        await gate.release();
        await expect(dialog.getByRole("status").filter({ hasText: "正在准备…" })).toHaveCount(0);
      }
      stays(before, await top(dialog.getByRole("heading", { name, exact: true })), "Dialog heading stays in its loading shell");
      await dialog.getByRole("button", { name: "关闭", exact: true }).click();
      await expect(dialog).toHaveCount(0);
    }

    // Removing the last attachment must remove its wait region with the badge.
    await page.getByRole("button", { name: "第三份参考 更多操作", exact: true }).click();
    await page.getByRole("menuitem", { name: "移到回收站", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "移到回收站", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "第三份：1 个附件", exact: true })).toHaveCount(0);
    await expect(page.locator(`#score-attachments-${third.id} .attachment-pending`)).toHaveCount(0);

    const markdown = Buffer.from("# Cold form fixture\n");
    assert.equal((await context.request.post(`${api}/scores/${third.id}/attachments/${crypto.randomUUID()}/file?${new URLSearchParams({ name: "名称测试.md", size: String(markdown.length) })}`, { data: markdown, headers: { "content-type": "application/octet-stream" } })).status(), 201);
    for (const [action, title] of [["重命名", "重命名附件"], ["移到回收站", "移到回收站"]]) {
      const actionPage = await context.newPage();
      const gate = await hold(actionPage, chunk("attachment-dialog"));
      await actionPage.goto(`${fixture.origin}/choirs/${fixture.choirId}`);
      await actionPage.getByRole("button", { name: "第三份：1 个附件", exact: true }).click();
      await actionPage.getByRole("button", { name: "名称测试.md 更多操作", exact: true }).click();
      await actionPage.getByRole("menuitem", { name: action, exact: true }).click(); await gate.wait();
      const dialog = actionPage.getByRole("dialog", { name: title, exact: true });
      await expect(dialog).toBeVisible();
      const before = await dialog.boundingBox();
      await gate.release();
      if (action === "重命名") await expect(dialog.getByRole("textbox", { name: "名称", exact: true })).toBeVisible();
      else await expect(dialog.getByRole("button", { name: title, exact: true })).toBeVisible();
      const after = await dialog.boundingBox();
      stays(before.y, after.y, "Cold attachment action retains its frame position");
      stays(before.width, after.width, "Renaming Markdown uses the form width throughout");
      await dialog.getByRole("button", { name: "关闭", exact: true }).click();
      await actionPage.close();
    }

    const module = await hold(page, chunk("drive-management-page"));
    const data = await hold(page, "**/api/choirs/*/management");
    await page.getByRole("button", { name: "打开云盘菜单", exact: true }).click();
    await page.getByRole("link", { name: "基本信息", exact: true }).click(); await module.wait();
    const heading = page.getByRole("heading", { name: "基本信息", exact: true });
    await heading.waitFor(); const headingTop = await top(heading);
    await module.release(); await data.wait();
    await page.getByText("正在读取云盘设置…", { exact: true }).waitFor();
    stays(headingTop, await top(heading), "Route module and data states share the heading position");
    await data.release(); await page.getByRole("button", { name: "修改云盘名称", exact: true }).waitFor();
    stays(headingTop, await top(heading), "Loaded route retains its heading");
    await page.getByRole("button", { name: "返回", exact: true }).click();
    // The drawer is restored as part of the existing navigation contract.
    if (!await page.getByRole("link", { name: "共享层", exact: true }).isVisible()) await page.getByRole("button", { name: "打开云盘菜单", exact: true }).click();
    const layers = await hold(page, "**/api/choirs/*/shared-layers?state=current");
    await page.getByRole("link", { name: "共享层", exact: true }).click(); await layers.wait();
    const selector = page.getByRole("radiogroup", { name: "共享层视图", exact: true });
    await selector.waitFor(); const selectorTop = await top(selector);
    await layers.release(); await page.getByRole("link", { name: /Ensemble/ }).waitFor();
    stays(selectorTop, await top(selector), "Settings status does not move existing controls");
    assert.deepEqual(errors, []);

    // Read-only links have no more menu; their loading reservation still fits.
    const reader = await browser.newContext({ viewport: { width, height: 844 }, serviceWorkers: "block" });
    const member = fixture.accounts[1];
    assert.equal((await reader.request.post(`${fixture.origin}/api/auth/sign-in/email`, { headers: { origin: fixture.origin }, data: { email: member.email, password: member.password } })).status(), 200);
    const readPage = await reader.newPage();
    await readPage.goto(`${fixture.origin}/choirs/${fixture.choirId}`);
    const gate = await hold(readPage, "**/api/choirs/*/attachments?*");
    await readPage.getByRole("button", { name: "第二份：1 个附件", exact: true }).click(); await gate.wait();
    const rows = readPage.locator(`#score-attachments-${second.id}`);
    const reserved = await rows.locator(".attachment-pending").boundingBox();
    await gate.release(); await rows.getByRole("link", { name: "第二份参考", exact: true }).waitFor();
    await expect(rows.getByRole("button", { name: /更多操作/ })).toHaveCount(0);
    const loaded = await rows.locator(".attachment-list").boundingBox();
    stays(reserved.height, loaded.height, "Read-only link rows retain their reserved height");
  });
}
