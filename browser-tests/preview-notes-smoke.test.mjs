import assert from "node:assert/strict";
import { withBrowserEvidence } from "./browser-evidence.mjs";
import test from "node:test";
import { chromium, webkit, expect } from "@playwright/test";
import { startStorageFixture } from "./storage-fixture.mjs";
import { musicXmlFixture } from "./musicxml-fixture.mjs";
import { practiceWave } from "../visual-report/practice-fixture.mjs";

for (const [engine, browserType] of [["chromium", chromium], ["webkit", webkit]]) {
  test(`preview notes stay local through PDF, MusicXML, audio and missing entry state (${engine})`, { timeout: 180_000 }, async t => {
    const fixture = await startStorageFixture({ authenticated: true, nonMember: true });
    let browser;
    t.after(async () => { try { await browser?.close(); } finally { await fixture.stop(); } });
    browser = await browserType.launch();
    const owner = await browser.newContext({ serviceWorkers: "block" });
    const signIn = async (context, account) => {
      const response = await context.request.post(`${fixture.origin}/api/auth/sign-in/email`, {
        headers: { origin: fixture.origin }, data: { email: account.email, password: account.password },
      });
      assert.equal(response.status(), 200);
    };
    await signIn(owner, fixture.accounts[0]);
    const base = `${fixture.origin}/api/choirs/${fixture.choirId}/scores/${fixture.scoreId}`;
    for (const [name, content, type] of [["试听.wav", practiceWave(), "audio/wav"], ["试唱.musicxml", musicXmlFixture(), "application/vnd.recordare.musicxml+xml"]]) {
      const bytes = Buffer.from(content);
      const response = await owner.request.post(`${base}/attachments/${crypto.randomUUID()}/file?${new URLSearchParams({ name, size: String(bytes.length) })}`, {
        headers: { "content-type": type }, data: bytes,
      });
      assert.equal(response.status(), 201);
    }
    const context = await browser.newContext({ viewport: { width: 1024, height: 768 }, serviceWorkers: "block" });
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    await page.addInitScript(() => localStorage.setItem("reader-gesture-hint-seen", "true"));
    const errors = [], mutations = [], directoryFailures = [], directoryEvents = [];
    const pendingDirectories = new Set();
    let stage = "guest-entry";
    const directoryRequest = request => new URL(request.url()).pathname === `/api/choirs/${fixture.choirId}/attachments`;
    const noteDirectory = event => { directoryEvents.push({ stage, ...event }); if (directoryEvents.length > 12) directoryEvents.shift(); };
    page.on("pageerror", error => {
      errors.push(error.message);
      t.diagnostic(JSON.stringify({ event: "pageerror", stage, pendingDirectories: pendingDirectories.size, directoryEvents }));
    });
    page.on("response", response => { if (directoryRequest(response.request())) noteDirectory({ event: "response", status: response.status() }); });
    page.on("requestfinished", request => { if (directoryRequest(request)) { pendingDirectories.delete(request); noteDirectory({ event: "finished" }); } });
    page.on("requestfailed", request => {
      if (!directoryRequest(request)) return;
      pendingDirectories.delete(request);
      const failure = { stage, error: request.failure()?.errorText ?? "unknown" };
      directoryFailures.push(failure);
      noteDirectory({ event: "failed", ...failure });
    });
    page.on("request", request => {
      if (directoryRequest(request)) { pendingDirectories.add(request); noteDirectory({ event: "started" }); }
      if (/\/(annotations\/push|personal-layers)(?:\/|\?|$)/.test(new URL(request.url()).pathname) && !["GET", "HEAD"].includes(request.method())) mutations.push(request.url());
    });
    assert.equal((await context.request.post(`${fixture.origin}/api/guest/session`, { data: { admission: "open", choirId: fixture.choirId } })).status(), 200);
    const library = `${fixture.origin}/choirs/${fixture.choirId}`;
    const reader = `${library}/scores/${fixture.scoreId}`;
    const openLibrary = async () => {
      stage = "open-library";
      await expect.poll(() => pendingDirectories.size).toBe(0);
      await page.goto(library);
      await expect(page.getByRole("heading", { name: "本地链路云盘", exact: true })).toBeVisible();
    };
    let placement = 0;
    const checkExperience = async text => {
      stage = `${text}:reader`;
      await expect(page).toHaveURL(`${reader}?experience=1`);
      await page.locator("canvas[data-pdf-canvas-active]").first().waitFor();
      // Attachment returns may restore visible chrome. A tap toggles it, and
      // the viewport's outer thirds turn pages instead of revealing controls.
      const chromeVisible = await page.locator(".reader-shell").getAttribute("data-chrome-visible");
      const viewport = page.locator(".page-reader__viewport");
      const bounds = await viewport.boundingBox();
      assert.ok(bounds, "reader viewport must be available");
      t.diagnostic(`${engine}: ${text}; chrome=${chromeVisible}; viewport=${bounds.width}x${bounds.height}`);
      if (chromeVisible === null) {
        await viewport.click({ position: { x: bounds.width / 2, y: bounds.height / 2 } });
      }
      const edit = page.getByRole("button", { name: "编辑", exact: true });
      await expect(edit).toBeVisible();
      const attachments = page.getByRole("button", { name: "练习谱", exact: true });
      // Editing/reload unmounts this entry. The icon exists before its metadata
      // resolves; wait for the real directory read, not the decorative badge.
      await expect(attachments.locator(".attachment-play-badge")).toBeVisible();
      await expect(page.locator(".reader-playback-entries")).toHaveAttribute("aria-busy", "false");
      stage = `${text}:edit`;
      await edit.click();
      await expect(page.locator(".annotation-controls")).toBeVisible();
      await page.getByLabel("第 1 页笔记层").click({ position: { x: 200, y: 120 + 80 * placement++ } });
      await page.getByRole("textbox", { name: "笔记文本" }).fill(text);
      await page.getByRole("form", { name: "文字输入" }).click({ position: { x: 12, y: 80 } });
      await page.getByRole("button", { name: "完成编辑", exact: true }).click();
      await expect(attachments.locator(".attachment-play-badge")).toBeVisible();
      await expect(page.locator(".reader-playback-entries")).toHaveAttribute("aria-busy", "false");
      stage = `${text}:reload`;
      await page.reload();
      await expect(page.locator(".annotation-text").filter({ hasText: text })).toBeVisible();
      const cloud = await (await context.request.get(`${base}/layers`)).json();
      assert.equal(cloud.layers.length, 5);
      assert.ok(cloud.layers.every(layer => layer.kind === "shared" && !layer.canEdit));
    };
    // A real guest can try notes. Signing in does not promote those notes.
    await openLibrary();
    await page.locator(".file-row__open").click();
    await checkExperience("未登录的本机体验");
    await expect.poll(() => pendingDirectories.size).toBe(0);
    stage = "sign-in-non-member";
    await signIn(context, fixture.accounts[1]);
    await withBrowserEvidence(context, `artifacts/verification/preview-notes-${engine}`, async () => {
      for (const entry of ["pdf", "musicxml", "audio", "missing"]) {
        stage = `${entry}:entry`;
        await expect.poll(() => pendingDirectories.size).toBe(0);
        if (entry === "missing") await page.goto(reader);
        else {
          await openLibrary();
          if (entry === "pdf") await page.locator(".file-row__open").click();
          else {
            // Cached rows can render before the fresh directory request finishes.
            // Wait for that exact response before navigation unmounts the library.
            const directoryResponse = page.waitForResponse(response => directoryRequest(response.request()));
            await page.getByRole("button", { name: "本地链路测试：2 个附件", exact: true }).click();
            const response = await directoryResponse;
            assert.equal(response.status(), 200);
            await response.finished();
            stage = `${entry}:open-attachment`;
            await page.getByRole("button", { name: entry === "audio" ? "试听.wav" : "试唱.musicxml", exact: true }).click();
            if (entry === "audio") await page.getByRole("button", { name: "边听边看谱", exact: true }).click();
            if (entry === "musicxml") {
              const view = page.getByRole("button", { name: "重排谱面", exact: true });
              await expect(view).toHaveAttribute("aria-pressed", "true", { timeout: 60_000 });
              // The preparation notice changes the dock height. Let that finish
              // before a PDF tap whose pending intent is fenced by viewport size.
              await expect(page.getByTestId("musicxml-player").getByRole("button", { name: "播放", exact: true })).toBeEnabled({ timeout: 60_000 });
              await page.getByRole("button", { name: "原始 PDF", exact: true }).click();
              await expect(page.locator(".reader-shell")).not.toHaveAttribute("aria-hidden", "true");
            }
          }
        }
        if (entry === "musicxml" || entry === "audio") {
          await expect(page.getByRole("button", { name: "编辑", exact: true })).toHaveCount(0);
          await page.getByRole("button", { name: "结束播放", exact: true }).click();
        }
        await checkExperience(`已登录体验 ${entry}`);
      }
      await expect.poll(() => pendingDirectories.size).toBe(0);
      assert.deepEqual(directoryFailures, []);
      assert.deepEqual(mutations, []);
      assert.deepEqual(errors, []);
    });
    await context.close();
    await owner.close();
  });
}
