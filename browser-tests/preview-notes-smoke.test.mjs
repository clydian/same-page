import { selectPracticeView } from "./practice-controls.mjs";
import assert from "node:assert/strict";
import { withBrowserEvidence } from "./browser-evidence.mjs";
import { after, before, describe, test } from "node:test";
import { chromium, webkit, expect } from "@playwright/test";
import { startStorageFixture } from "./storage-fixture.mjs";
import { musicXmlFixture } from "./musicxml-fixture.mjs";
import { practiceWave } from "../visual-report/practice-fixture.mjs";

async function signIn(context, fixture, account) {
  const response = await context.request.post(`${fixture.origin}/api/auth/sign-in/email`, {
    headers: { origin: fixture.origin }, data: { email: account.email, password: account.password },
  });
  assert.equal(response.status(), 200);
}

for (const [engine, browserType] of [["chromium", chromium], ["webkit", webkit]]) {
  describe(`${engine}: preview notes stay local`, { timeout: 180_000 }, () => {
    let fixture, browser, nonMemberCookies;
    before(async () => {
      fixture = await startStorageFixture({ authenticated: true, nonMember: true });
      browser = await browserType.launch();
      const seed = await browser.newContext({ serviceWorkers: "block" });
      try {
        await signIn(seed, fixture, fixture.accounts[0]);
        const base = `${fixture.origin}/api/choirs/${fixture.choirId}/scores/${fixture.scoreId}`;
        for (const [name, content, type] of [["试听.wav", practiceWave(), "audio/wav"], ["试唱.musicxml", musicXmlFixture(), "application/vnd.recordare.musicxml+xml"]]) {
          const bytes = Buffer.from(content);
          const response = await seed.request.post(`${base}/attachments/${crypto.randomUUID()}/file?${new URLSearchParams({ name, size: String(bytes.length) })}`, {
            headers: { "content-type": type }, data: bytes,
          });
          assert.equal(response.status(), 201);
        }
        // Copy a real login session, never the preceding scenario's local data.
        await signIn(seed, fixture, fixture.accounts[1]);
        nonMemberCookies = (await seed.storageState()).cookies;
      } finally { await seed.close(); }
    });
    after(async () => { try { await browser?.close(); } finally { await fixture?.stop(); } });

    for (const scenario of ["guest-sign-in-pdf", "connectivity-hint", "signed-in-musicxml", "signed-in-audio", "signed-in-direct-link"]) {
      test(scenario, async t => {
        const context = await browser.newContext({ viewport: { width: 1024, height: 768 }, serviceWorkers: "block" });
        t.after(() => context.close());
        await context.addInitScript(() => localStorage.setItem("reader-gesture-hint-seen", "true"));
        const page = await context.newPage();
        page.setDefaultTimeout(15_000);
        const base = `${fixture.origin}/api/choirs/${fixture.choirId}/scores/${fixture.scoreId}`;
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
        await withBrowserEvidence(context, `artifacts/verification/preview-notes/${engine}-${scenario}`, async () => {
          if (scenario === "guest-sign-in-pdf") {
            await openLibrary();
            await page.locator(".file-row__open").click();
            await checkExperience("未登录的本机体验");
            await expect.poll(() => pendingDirectories.size).toBe(0);
            stage = "sign-in-non-member";
            // Preserve the actual identity transition; signing in must not upload guest notes.
            await signIn(context, fixture, fixture.accounts[1]);
            await openLibrary();
            await page.locator(".file-row__open").click();
            await checkExperience("已登录体验 pdf");
            // Check after the signed-in note has survived a reload, never on an
            // empty loading frame that could hide a late identity leak.
            await expect(page.locator(".annotation-text").filter({ hasText: "未登录的本机体验" })).toHaveCount(0);
          } else if (scenario === "connectivity-hint") {
            // A connectivity hint can refresh while opening. Pin the shell lookup so
            // this exercises the accepted-click lifetime instead of relying on timing.
            await openLibrary();
            await expect(page.getByRole("button", { name: /^离线副本：/ })).toBeEnabled();
            await page.evaluate(() => {
              const original = navigator.serviceWorker.getRegistration;
              navigator.serviceWorker.getRegistration = () => new Promise(resolve => {
                window.releasePreviewShellLookup = () => {
                  navigator.serviceWorker.getRegistration = original;
                  delete window.releasePreviewShellLookup;
                  resolve(undefined);
                };
              });
            });
            await page.locator(".file-row__open").click();
            await expect(page.locator(".prepared-score-target")).toHaveAttribute("aria-busy", "true");
            await page.evaluate(() => {
              Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
              window.dispatchEvent(new Event("offline"));
              return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            });
            assert.equal(await page.locator(".prepared-score-target").getAttribute("aria-busy"), "true", "connectivity refresh must retain the accepted click");
            await page.evaluate(() => {
              delete navigator.onLine;
              window.dispatchEvent(new Event("online"));
              window.releasePreviewShellLookup();
            });
            await checkExperience("网络提示变化后的本机体验");
          } else {
            await context.addCookies(nonMemberCookies);
            const entry = scenario === "signed-in-direct-link" ? "missing" : scenario.slice("signed-in-".length);
            stage = `${entry}:entry`;
            if (entry === "missing") await page.goto(reader);
            else {
              await openLibrary();
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
                const view = page.getByRole("button", { name: "显示谱面", exact: true });
                await expect(view).toHaveText("重排谱面", { timeout: 60_000 });
                // The preparation notice changes the dock height. Let that finish
                // before a PDF tap whose pending intent is fenced by viewport size.
                await expect(page.getByTestId("musicxml-player").getByRole("button", { name: "播放", exact: true })).toBeEnabled({ timeout: 60_000 });
                await selectPracticeView(page, "原始 PDF");
                await expect(page.locator(".reader-shell")).not.toHaveAttribute("aria-hidden", "true");
              }
            }
            if (entry === "musicxml" || entry === "audio") {
              await expect(page.getByRole("button", { name: "编辑", exact: true })).toHaveCount(0);
              await page.getByRole("button", { name: "结束练习", exact: true }).click();
            }
            await checkExperience(`已登录体验 ${entry}`);
          }
          await expect.poll(() => pendingDirectories.size).toBe(0);
          assert.deepEqual(directoryFailures, []);
          assert.deepEqual(mutations, []);
          assert.deepEqual(errors, []);
        });
      });
    }
  });
}
