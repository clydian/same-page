import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium, webkit, request, expect } from "@playwright/test";
import { expectSampleScoreContent } from "./pdf-content.mjs";
import { startStorageFixture } from "./storage-fixture.mjs";
import { withBrowserEvidence } from "./browser-evidence.mjs";
import { PDFDocument } from "pdf-lib";
import { createSampleScorePdf } from "../visual-report/fixtures.mjs";

test("chromium: a first-page-only PDF open finishes saving after returning to the library", { timeout: 120_000 }, async t => {
  const sample = await PDFDocument.load(createSampleScorePdf());
  const document = await PDFDocument.create();
  const pageCount = 12;
  for (const sheet of await document.copyPages(sample, Array.from({ length: pageCount }, (_, index) => index % 2))) {
    document.addPage(sheet);
  }
  const fixture = await startStorageFixture({ authenticated: true, previewEntry: false, pdf: Buffer.from(await document.save()), pageCount });
  t.after(() => fixture.stop());
  const drive = `${fixture.origin}/choirs/${fixture.choirId}`;
  const options = { headless: true, serviceWorkers: "allow", viewport: { width: 390, height: 844 }, locale: "zh-CN",
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) };
  const profile = await mkdtemp(path.join(tmpdir(), "same-page-offline-open-"));
  let context;
  t.after(async () => { try { await context?.close(); } finally { await rm(profile, { recursive: true, force: true }); } });
  context = await chromium.launchPersistentContext(profile, options);
  const account = fixture.accounts[1];
  const login = await context.request.post(`${fixture.origin}/api/auth/sign-in/email`, { headers: { origin: fixture.origin }, data: { email: account.email, password: account.password } });
  assert.equal(login.status(), 200);
  const page = await context.newPage();
  await page.addInitScript(() => {
    localStorage.setItem("reader-gesture-hint-seen", "true");
    let releaseLayers;
    const layers = new Promise(resolve => { releaseLayers = resolve; });
    window.__releaseLayers = releaseLayers;
    window.__pendingLayerRequests = 0;
    window.__pdfRequests = 0;
    const fetch = window.fetch;
    window.fetch = async (input, init) => {
      const pathname = new URL(input instanceof Request ? input.url : input, location.origin).pathname;
      if (pathname.endsWith("/layers")) {
        window.__pendingLayerRequests++;
        await layers;
      }
      if (!/\/versions\/[^/]+\/pdf$/.test(pathname)) return fetch(input, init);
      window.__pdfRequests++;
      assertNoRange(init);
      const response = await fetch(input, init);
      if (!response.ok || window.__pdfRequests > 1) return response;
      const bytes = new Uint8Array(await response.arrayBuffer());
      const split = Math.ceil(bytes.length / 2);
      const stream = new ReadableStream({ start(controller) {
        controller.enqueue(bytes.slice(0, split));
        window.__releasePdf = () => { controller.enqueue(bytes.slice(split)); controller.close(); };
      } });
      return new Response(stream, { status: response.status, headers: response.headers });
    };
    function assertNoRange(init) {
      if (new Headers(init?.headers).has("Range")) throw new Error("Library opens the complete PDF.");
    }
  });
  const scoreName = fixture.fileName.replace(/\.pdf$/i, "");
  await page.goto(drive);
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await page.getByRole("link", { name: scoreName, exact: true }).click();
  await expect(page.getByRole("progressbar", { name: "下载乐谱" })).toHaveAttribute("value", "50");
  await expect(page).toHaveURL(drive);
  await page.evaluate(() => window.__releasePdf());
  await expectSampleScoreContent(page);
  await expect(page.locator('[data-page-turn-current][data-page-number="1"]')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__pendingLayerRequests)).toBeGreaterThan(0);
  await page.locator(".page-reader__viewport").click();
  await page.getByRole("button", { name: "返回云盘", exact: true }).click();
  await expect(page).toHaveURL(drive);
  const copy = page.getByRole("button", { name: /^离线副本：/ });
  await expect(copy).toHaveAccessibleName(/正在准备/);
  await page.evaluate(() => window.__releaseLayers());
  await expect(copy).toHaveAccessibleName(/可离线使用/);
  assert.equal(await page.evaluate(() => window.__pdfRequests), 1);
  await context.close();
  context = await chromium.launchPersistentContext(profile, options);
  await context.setOffline(true);
  await context.addInitScript(() => localStorage.setItem("reader-gesture-hint-seen", "true"));
  const offline = await context.newPage();
  await offline.goto(drive);
  await offline.getByRole("link", { name: scoreName, exact: true }).click();
  await expectSampleScoreContent(offline);
  await offline.locator(".page-reader__viewport").click();
  await offline.getByRole("slider", { name: "跳转页码" }).press("End");
  await expect(offline.locator(`[data-page-turn-current][data-page-number="${pageCount}"]`)).toBeVisible();
  await expectSampleScoreContent(offline);
});

for (const [engineName, engine] of [["chromium", chromium], ["webkit", webkit]]) {
  test(`${engineName}: verified local score access`, async t => {
    const fixture = await startStorageFixture({ authenticated: true, previewEntry: false });
    t.after(() => fixture.stop());
    const drive = `${fixture.origin}/choirs/${fixture.choirId}`;
    const options = { headless: true, serviceWorkers: "allow", viewport: { width: 390, height: 844 } };
    async function scenario(label, run) {
      await t.test(label, { timeout: 120_000 }, async scenarioTest => {
        const profile = await mkdtemp(path.join(tmpdir(), "same-page-offline-entry-"));
        let context;
        // A timed-out recovery must close its browser and allow revocation to run.
        const cleanup = async () => {
          try { await context?.close(); }
          finally { await rm(profile, { recursive: true, force: true }); }
        };
        scenarioTest.after(cleanup);
        try {
          context = await engine.launchPersistentContext(profile, { locale: "zh-CN", ...options });
          const account = fixture.accounts[1];
          const login = await context.request.post(`${fixture.origin}/api/auth/sign-in/email`, { headers: { origin: fixture.origin }, data: { email: account.email, password: account.password } });
          assert.equal(login.status(), 200);
          const output = `artifacts/verification/offline-entry/${engineName}-${label}`;
          const page = await withBrowserEvidence(context, `${output}/prepare`, async () => {
            const page = await context.newPage();
            await page.goto(drive);
            await page.getByRole("searchbox", { name: "搜索「本地链路云盘」中的乐谱", exact: true }).waitFor();
            await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
            await page.getByRole("button", { name: /^离线副本：/ }).click();
            await page.getByRole("button", { name: "保存供离线使用", exact: true }).click();
            await page.getByRole("status").filter({ hasText: /^可离线使用$/ }).waitFor();
            await page.getByRole("button", { name: "关闭", exact: true }).click();
            return page;
          });
          await run({ page, context, output, restart: async () => {
            await context.close();
            context = await engine.launchPersistentContext(profile, { locale: "zh-CN", ...options });
            return context;
          } });
        } finally { await cleanup(); }
      });
    }
    await scenario(engineName === "chromium" ? "offline-browser-restart" : "api-outage-new-page", async ({ page, context, output, restart }) => {
      if (engineName === "chromium") context = await restart();
      await withBrowserEvidence(context, output, async () => {
        if (engineName === "webkit") {
          // Playwright WebKit does not restore its service-worker registration across
          // process launches or an offline new-page navigation here. API failure
          // injection tests cold JS state while static assets remain online; installed iOS
          // PWA process-restart acceptance remains a separate real-device check.
          // WebKit routing does not intercept service-worker requests. Remove the
          // registration after the product verified its download, then inject API
          // failure for the new page. This is not an offline app-shell test.
          await page.evaluate(async () => {
            for (const registration of await navigator.serviceWorker.getRegistrations()) await registration.unregister();
          });
          await context.addInitScript(() => {
            navigator.serviceWorker.register = async () => { throw new Error("Service worker disabled for API-outage fixture"); };
          });
          await page.close();
        }
        if (engineName === "chromium") await context.setOffline(true);
        else await context.route("**/api/**", route => route.abort("internetdisconnected"));
        await context.addInitScript(() => localStorage.setItem("reader-gesture-hint-seen", "true"));
        const offline = await context.newPage();
        await offline.goto(fixture.origin);
        await offline.getByRole("link").filter({ hasText: fixture.fileName.replace(/\.pdf$/i, "") }).waitFor({ timeout: 10_000 });
        assert.equal(new URL(offline.url()).pathname, `/choirs/${fixture.choirId}`);
        await offline.getByRole("searchbox", { name: /搜索.*中的乐谱/ }).waitFor();
        await offline.goto(`${fixture.origin}/drives`);
        await expect(offline).toHaveURL(`${fixture.origin}/choirs/${fixture.choirId}`);
        await offline.getByRole("heading", { name: "本地链路云盘" }).waitFor();
        await offline.getByRole("link").filter({ hasText: fixture.fileName.replace(/\.pdf$/i, "") }).click();
        await expectSampleScoreContent(offline);
        const readerUrl = offline.url();
        await offline.locator(".reader-shell").click({ position: { x: 195, y: 350 } });
        await offline.getByRole("button", { name: "编辑", exact: true }).click();
        await offline.getByRole("button", { name: "完成编辑", exact: true }).waitFor();
        const reconnected = offline.waitForResponse(response => response.url().includes("/api/auth/get-session") && response.status() === 200);
        if (engineName === "chromium") {
          await context.setOffline(false);
          // Network emulation does not consistently deliver the OS online event.
          await offline.evaluate(() => window.dispatchEvent(new Event("online")));
        }
        else {
          await context.unroute("**/api/**");
          await offline.evaluate(() => window.dispatchEvent(new Event("online")));
        }
        await reconnected;
        assert.equal(offline.url(), readerUrl);
        assert.equal(await offline.getByRole("button", { name: "完成编辑", exact: true }).isVisible(), true);
        assert.equal(await offline.locator(".annotation-overlay[data-editing]").count(), 1);
      });
    });
    await scenario("local-directory-read-retry", async ({ page, context, output }) => {
      await page.evaluate(async () => {
        for (const registration of await navigator.serviceWorker.getRegistrations()) await registration.unregister();
      });
      await context.addInitScript(() => {
        navigator.serviceWorker.register = async () => { throw new Error("Service worker disabled for API-outage fixture"); };
        window.__localDirectoryReadFails = true;
        for (const prototype of [IDBIndex.prototype, IDBObjectStore.prototype]) {
          for (const method of ["get", "getAll", "openCursor"]) {
            const original = prototype[method];
            if (!original) continue;
            prototype[method] = function (...args) {
              const store = this instanceof IDBIndex ? this.objectStore.name : this.name;
              if (window.__localDirectoryReadFails && store === "driveDirectories") throw new DOMException("temporary directory read", "UnknownError");
              return original.apply(this, args);
            };
          }
        }
      });
      await page.close();
      await context.route("**/api/**", route => route.abort("internetdisconnected"));
      await withBrowserEvidence(context, output, async () => {
        const cold = await context.newPage();
        await cold.goto(drive);
        await expect(cold.getByRole("heading", { name: "暂时无法打开云盘", exact: true })).toBeVisible();
        await expect(cold.getByRole("alert")).toHaveText("本机目录暂时无法读取，请重试。");
        // Only lift the simulated local failure. API requests stay unavailable.
        await cold.evaluate(() => { window.__localDirectoryReadFails = false; });
        await cold.getByRole("button", { name: "重试读取", exact: true }).click();
        await expect(cold.getByRole("link").filter({ hasText: fixture.fileName.replace(/\.pdf$/i, "") })).toBeVisible();
      });
    });
    await scenario("membership-revocation", async ({ page: offline, context, output }) => {
      await withBrowserEvidence(context, output, async () => {
        const admin = await request.newContext({ baseURL: fixture.origin, extraHTTPHeaders: { origin: fixture.origin } });
        try {
          const owner = fixture.accounts[0];
          assert.equal((await admin.post("/api/auth/sign-in/email", { data: { email: owner.email, password: owner.password } })).status(), 200);
          const memberships = await (await admin.get(`/api/choirs/${fixture.choirId}/memberships`)).json();
          const target = memberships.memberships.find(member => member.id !== memberships.actorId);
          assert.ok(target);
          assert.equal((await admin.post(`/api/choirs/${fixture.choirId}/memberships/${target.id}`, { data: { action: "remove", expectedRevision: target.revision } })).status(), 204);
        } finally { await admin.dispose(); }
        await offline.reload();
        await offline.getByRole("heading", { name: "本机保留的乐谱", exact: true }).waitFor();
        await offline.getByText("已无法访问此云盘，以下为本机保留内容", { exact: true }).waitFor();
        await offline.getByRole("link", { name: new RegExp(fixture.fileName.replace(/\.pdf$/i, "")) }).waitFor();
        await offline.getByRole("link", { name: new RegExp(fixture.fileName.replace(/\.pdf$/i, "")) }).click();
        await expectSampleScoreContent(offline);
      });
    });
  });
}
