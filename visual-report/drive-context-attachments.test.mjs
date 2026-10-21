import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { chromium, webkit, expect } from "@playwright/test";
import { startVisualServer } from "./setup.mjs";
import { createVisualFixtureSession } from "./fixtures.mjs";

const evidence = "artifacts/verification/drive-context-attachments";
const drives = [
  { id: "visual-choir", name: "爱情", owner: true },
  { id: "practice-drive", name: "PPOE", owner: false },
  { id: "flower-drive", name: "小红花", owner: false },
];
for (const [engineName, engine] of [["chromium", chromium], ["webkit", webkit]]) {
  test(`${engineName}: stable drive targets, context Back and attachment recovery`, { timeout: 150_000 }, async t => {
    const server = await startVisualServer({ script: "preview" }); t.after(() => server.stop());
    const browser = await engine.launch(); t.after(() => browser.close());
    await mkdir(evidence, { recursive: true });
    const results = [];
    for (const [device, viewport] of [["phone", { width: 390, height: 844 }], ["tablet", { width: 1024, height: 768 }]]) {
      const context = await browser.newContext({ viewport, locale: "zh-CN", serviceWorkers: "block" });
      const moduleEvents = [];
      context.on("request", request => { if (/markdown-(?:attachment|editor)/.test(request.url())) moduleEvents.push({ event: "request", path: new URL(request.url()).pathname }); });
      context.on("requestfailed", request => { if (/markdown-(?:attachment|editor)/.test(request.url())) moduleEvents.push({ event: "failed", path: new URL(request.url()).pathname, reason: request.failure()?.errorText }); });
      context.on("response", response => { if (/markdown-(?:attachment|editor)/.test(response.url())) moduleEvents.push({ event: "response", path: new URL(response.url()).pathname, status: response.status() }); });
      let page;
      try {
        const fixture = createVisualFixtureSession();
        let gate = null, release, reads = 0, changed = false, optionalBlocked = false, optionalFailures = 0, savedDocument = null;
        t.after(() => release?.());
        await context.route("**/*", async route => {
          const request = route.request(), pathname = new URL(request.url()).pathname;
          if (optionalBlocked && /(?:markdown-editor|pdf-preview)[^/]*\.(?:tsx|js)/.test(pathname)) { optionalFailures++; return route.fulfill({ status: 503, contentType: "text/javascript", headers: { "cache-control": "no-store" }, body: "" }); }
          if (!pathname.startsWith("/api/")) return route.continue();
          if (request.method() === "POST" && /\/attachments\/[^/]+\/file$/.test(pathname)) {
            const query = new URL(request.url()).searchParams, name = query.get("name"), size = Number(query.get("size"));
            savedDocument = { name, size };
            return route.fulfill({ json: { attachment: { id: pathname.split("/").at(-2), scoreId: pathname.split("/").at(-4), name, kind: "markdown", url: null, sizeBytes: size, revision: 1, updatedAt: 1, trashExpiresAt: null } } });
          }
          if (pathname === "/api/choirs") {
            reads++; if (gate) await gate;
            const rows = changed ? [...drives].reverse().concat({ id: "new-drive", name: "新加入的云盘", owner: false }) : drives;
            return route.fulfill({ json: { memberships: rows.map(row => ({ id: `m-${row.id}`, displayName: "排练者", isOwner: row.owner || changed && row.id === "practice-drive", choir: { id: row.id, name: row.name, guestAdmissionMode: "invite" } })) } });
          }
          const target = drives.find(row => pathname.includes(`/choirs/${row.id}/`));
          const normalized = target ? pathname.replace(`/choirs/${target.id}/`, "/choirs/visual-choir/") : pathname;
          const result = fixture.resolve({ pathname: normalized, method: request.method(), identity: "admin", cookie: "" });
          if (target && pathname.endsWith("/bootstrap") && result.status === 200) {
            const data = JSON.parse(result.body); data.choir = { ...data.choir, id: target.id, name: target.name };
            data.scores = data.scores.map(row => ({ ...row, choirId: target.id })); result.body = JSON.stringify(data);
          }
          return route.fulfill(result);
        });
        page = await context.newPage();
        await page.clock.setFixedTime(new Date("2026-10-21T16:00:00Z"));
        await page.goto(`${server.origin}/choirs/visual-choir`);
        await expect(page.locator(".file-row")).toHaveCount(3);
        await page.getByRole("button", { name: /^切换云盘/ }).click();
        const picker = page.getByRole("dialog", { name: "切换云盘" });
        await expect(picker.getByRole("link", { name: /PPOE.*成员/ })).toBeVisible();
        await page.screenshot({ path: `${evidence}/${engineName}-${device}-switcher.png` });
        await picker.getByRole("button", { name: "关闭云盘选择" }).click();
        const firstReads = reads;
        await page.getByRole("button", { name: /^切换云盘/ }).click();
        await expect(picker.getByRole("link", { name: /爱情.*拥有者/ })).toBeVisible();
        assert.equal(reads, firstReads, "recent reopening should not issue another membership read");
        await picker.getByRole("button", { name: "关闭云盘选择" }).click();
        await page.clock.setFixedTime(new Date("2026-10-21T16:01:01Z"));
        gate = new Promise(resolve => { release = resolve; }); changed = true;
        await page.getByRole("button", { name: /^切换云盘/ }).click();
        const target = picker.getByRole("link", { name: /PPOE.*成员/ });
        await expect(target).toBeVisible();
        const before = await target.boundingBox();
        // Release a reversed response plus a new drive between pointer down/up.
        await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2); await page.mouse.down();
        release(); gate = null;
        await expect(picker.getByRole("link", { name: /PPOE.*拥有者/ })).toBeVisible();
        const after = await picker.getByRole("link", { name: /PPOE.*拥有者/ }).boundingBox();
        assert.deepEqual(after, before, "background response must not move or resize the pressed row");
        await expect(picker.getByRole("link", { name: /新加入的云盘/ })).toHaveCount(1);
        await page.mouse.up(); await expect(page).toHaveURL(/\/choirs\/practice-drive$/);
        await page.getByRole("link", { name: "云盘设置", exact: true }).click();
        await page.getByRole("button", { name: "返回", exact: true }).click();
        await expect(page).toHaveURL(/\/choirs\/practice-drive$/);
        await page.goBack();
        await expect(page).toHaveURL("about:blank");
        // A fresh explicit deep link must not inherit the old document's default key.
        await page.goto(`${server.origin}/choirs/flower-drive`);
        await expect(page.getByRole("heading", { name: "小红花", exact: true })).toBeVisible();
        await page.goto(`${server.origin}/choirs/visual-choir`);
        await expect(page.locator(".file-row")).toHaveCount(3);
        optionalBlocked = true;
        await page.getByRole("button", { name: /更多操作/ }).first().click();
        await page.getByRole("menuitem", { name: "添加附件", exact: true }).click();
        await expect(page.getByRole("dialog", { name: "添加附件" })).toBeVisible();
        await page.screenshot({ path: `${evidence}/${engineName}-${device}-attachment-types.png` });
        await page.getByRole("button", { name: "PDF", exact: true }).click();
        await expect(page.getByLabel("选择附件文件")).toHaveAttribute("accept", ".pdf");
        assert.equal(optionalFailures, 0, "type choices and PDF upload must not load optional modules");
        await page.getByRole("button", { name: "返回附件类型" }).click();
        await page.getByRole("button", { name: "文档（仅 .md）", exact: true }).click();
        await page.getByRole("button", { name: "直接编写", exact: true }).click();
        await expect(page.getByRole("alert")).toContainText("编辑器暂时无法打开");
        await expect(page.getByRole("dialog")).toBeVisible();
        assert.ok(optionalFailures >= 1);
        await page.screenshot({ path: `${evidence}/${engineName}-${device}-attachment-recovery.png` });
        await page.goBack();
        await expect(page.getByRole("dialog")).toBeHidden();
        await expect(page.getByRole("heading", { name: "爱情", exact: true })).toBeVisible();
        optionalBlocked = false;
        await page.getByRole("button", { name: /更多操作/ }).first().click();
        await page.getByRole("menuitem", { name: "添加附件", exact: true }).click();
        await page.getByRole("button", { name: "文档（仅 .md）", exact: true }).click();
        await page.getByRole("button", { name: "直接编写", exact: true }).click();
        await expect(page.getByRole("alert")).toContainText("编辑器暂时无法打开");
        await page.getByRole("textbox", { name: "文件名", exact: true }).fill("爱情排练笔记.md");
        await page.getByRole("button", { name: "使用纯文本编辑", exact: true }).click();
        const source = "# 排练提醒\n保留原文与草稿，弱网下也能继续编辑。";
        await page.getByRole("textbox", { name: "Markdown 正文", exact: true }).fill(source);
        await page.screenshot({ path: `${evidence}/${engineName}-${device}-attachment-plain-text.png` });
        // WebKit's protocol omits Blob POST data from intercepted Request objects.
        // Observe the bytes passed to native XHR without changing the upload.
        await page.evaluate(() => {
          const send = XMLHttpRequest.prototype.send;
          XMLHttpRequest.prototype.send = function (body) {
            if (body instanceof Blob) void body.text().then(text => { window.__attachmentUploadedText = text; });
            return send.call(this, body);
          };
        });
        await page.getByRole("button", { name: "保存", exact: true }).click();
        await expect(page.getByRole("heading", { name: "排练提醒", exact: true })).toBeVisible();
        assert.deepEqual(savedDocument, { name: "爱情排练笔记.md", size: Buffer.byteLength(source) });
        await expect.poll(() => page.evaluate(() => window.__attachmentUploadedText)).toBe(source);
        await expect(page.getByRole("alert")).toHaveCount(0);
        // The receipt can paint before the directory refresh finishes. Back is
        // intentionally guarded until that save workflow has settled.
        await expect(page.locator(".attachment-dialog")).not.toHaveAttribute("data-update-busy", "true");
        await page.goBack();
        await expect(page.getByRole("dialog")).toBeHidden();
        await expect(page.getByRole("heading", { name: "爱情", exact: true })).toBeVisible();
        results.push({ device, membershipReads: reads, stableTarget: { before, after }, optionalFailures, plainTextFallbackSaved: true });
      } catch (error) {
        await writeFile(`${evidence}/${engineName}-${device}-module-events.json`, JSON.stringify(moduleEvents, null, 2));
        if (page && !page.isClosed()) {
          await page.screenshot({ path: `${evidence}/${engineName}-${device}-failure.png` }).catch(() => {});
          await writeFile(`${evidence}/${engineName}-${device}-navigation.json`, JSON.stringify(await page.evaluate(() => ({ url: location.pathname, history: window.history.state, busy: document.querySelector(".attachment-dialog")?.getAttribute("data-update-busy") })).catch(() => null), null, 2)).catch(() => {});
        }
        throw error;
      } finally { await context.close(); }
    }
    await writeFile(`${evidence}/${engineName}.json`, JSON.stringify(results, null, 2));
  });
}
