import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium, webkit, expect, request } from "@playwright/test";
import { startStorageFixture } from "./storage-fixture.mjs";
import { expectSampleScoreContent } from "./pdf-content.mjs";
import { withBrowserEvidence } from "./browser-evidence.mjs";

// Chromium uses browser touch input through CDP, not DOM dispatch. WebKit's
// held sequence only tests app logic; neither is physical-device acceptance.
async function hold(page, file, engine) {
  const box = await file.boundingBox();
  assert.ok(box);
  const point = { x: box.x + Math.min(70, box.width / 2), y: box.y + box.height / 2 };
  if (engine === "chromium") {
    const cdp = await page.context().newCDPSession(page);
    try {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
      await expect(file).toHaveAttribute("data-touch-active", "");
      assert.equal(await file.evaluate(node => getComputedStyle(node).userSelect), "none");
      await delay(700);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    } finally { await cdp.detach(); }
  } else {
    await file.dispatchEvent("pointerdown", { pointerType: "touch", pointerId: 1, isPrimary: true, clientX: point.x, clientY: point.y });
    await delay(700);
    await file.dispatchEvent("pointerup", { pointerType: "touch", pointerId: 1, isPrimary: true, clientX: point.x, clientY: point.y });
    await file.dispatchEvent("click", { detail: 1, button: 0 });
  }
}

async function signIn(client, fixture) {
  const account = fixture.accounts[0];
  assert.equal((await client.post(`${fixture.origin}/api/auth/sign-in/email`, {
    headers: { origin: fixture.origin }, data: { email: account.email, password: account.password },
  })).status(), 200);
}

// The server's seeded score is shared read-only; every scenario owns its browser
// profile, cookies, service worker and IndexedDB, and can fail independently.
async function scenario(t, fixture, engine, browserType, name, run) {
  await t.test(name, async t => {
    const profile = await mkdtemp(path.join(tmpdir(), "same-page-file-touch-"));
    let context;
    t.after(async () => { try { await context?.close(); } finally { await rm(profile, { recursive: true, force: true }); } });
    const nativeTabBrowser = engine === "chromium" ? { channel: "chromium" } : {};
    const executablePath = engine === "chromium" ? process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH : undefined;
    context = await browserType.launchPersistentContext(profile, {
      headless: true, ...nativeTabBrowser, ...(executablePath ? { executablePath } : {}),
      viewport: { width: 390, height: 844 }, hasTouch: true, serviceWorkers: "allow",
    });
    await context.addInitScript(() => localStorage.setItem("reader-gesture-hint-seen", "true"));
    // Clone one real fixture login into isolated profiles. Repeating login for
    // every browser scenario would test auth rate limits instead of file links.
    await context.addCookies(fixture.sessionCookies);
    await withBrowserEvidence(context, `artifacts/verification/file-touch-links/${engine}/${name}`, async () => {
      const page = await context.newPage();
      const errors = []; page.on("pageerror", error => errors.push(error.name));
      const library = `${fixture.origin}/choirs/${fixture.choirId}`;
      const scorePath = `/choirs/${fixture.choirId}/scores/${fixture.scoreId}`;
      await page.goto(library);
      await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
      const file = page.getByRole("link", { name: "本地链路测试", exact: true });
      await expect(file).toBeVisible();
      await expect(file).toHaveAttribute("href", scorePath);
      await run({ page, context, library, scorePath, file });
      assert.deepEqual(errors, []);
    });
  });
}

for (const [engine, browserType] of [["chromium", chromium], ["webkit", webkit]]) {
  test(`file links retain navigation and withdraw held touch (${engine})`, { timeout: 120_000 }, async t => {
    const fixture = await startStorageFixture({ authenticated: true, previewEntry: false });
    t.after(() => fixture.stop());
    const seed = await request.newContext();
    try {
      await signIn(seed, fixture);
      const api = `${fixture.origin}/api/choirs/${fixture.choirId}`;
      assert.equal((await seed.post(`${api}/scores/${fixture.scoreId}/attachments/links`, {
        data: { id: crypto.randomUUID(), name: "参考外链", url: "https://example.org/reference" },
      })).status(), 201);
      for (let index = 0; index < 10; index++) {
        assert.equal((await seed.post(api + "/scores", {
          multipart: { file: { name: `滚动测试${index}.pdf`, mimeType: "application/pdf", buffer: fixture.pdf } },
        })).status(), 201);
      }
      fixture.sessionCookies = (await seed.storageState()).cookies;
    } finally { await seed.dispose(); }
    await scenario(t, fixture, engine, browserType, "touch-and-context-menu", async ({ page, context, library, file }) => {
      await page.getByRole("button", { name: "本地链路测试：1 个附件", exact: true }).tap();
      const external = page.getByRole("link", { name: "参考外链", exact: true });
      await expect(external).toHaveAttribute("target", "_blank");
      assert.equal(await external.evaluate(node => {
        const event = new PointerEvent("contextmenu", { bubbles: true, cancelable: true, pointerType: "touch" });
        node.dispatchEvent(event); return event.defaultPrevented;
      }), false);
      const fileRequests = [];
      page.on("request", request => { if (/\/scores\/[^/]+\/(?:versions\/[^/]+\/pdf|pdf|sync)(?:\?|$)/.test(new URL(request.url()).pathname)) fileRequests.push(request.url()); });
      await hold(page, file, engine);
      await expect(page).toHaveURL(library);
      await expect(page.getByRole("menu")).toHaveCount(0);
      assert.deepEqual(fileRequests, [], "holding must not start PDF or annotation preparation");
      await expect(file).not.toHaveAttribute("data-touch-active");
      assert.notEqual(await file.evaluate(node => getComputedStyle(node).userSelect), "none");
      if (engine === "chromium") {
        const cdp = await context.newCDPSession(page);
        try {
          const box = await file.boundingBox(); assert.ok(box);
          const point = { x: box.x + 60, y: box.y + box.height / 2 };
          const before = await page.evaluate(() => scrollY);
          await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
          for (let step = 1; step <= 5; step++) {
            await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: point.x, y: point.y - step * 25 }] });
            await delay(20);
          }
          await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
          await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(before);
          await expect(page).toHaveURL(library);
          await file.scrollIntoViewIfNeeded();
          const current = await file.boundingBox(); assert.ok(current);
          const first = { id: 0, x: current.x + 60, y: current.y + current.height / 2 };
          await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [first] });
          await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [first, { id: 1, x: first.x + 200, y: first.y + 80 }] });
          await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
          await expect(page).toHaveURL(library);
        } finally { await cdp.detach(); }
      }
      assert.deepEqual(fileRequests, [], "scrolling and multiple contacts must not prepare a score");

      // Source-specific menu handling, including unknown/keyboard sources.
      for (const [selector, type, cancelled] of [[".file-open-link", "touch", true], [".file-open-link", "mouse", false], [".file-open-link", "", false], ["input[type=search]", "touch", false]]) {
        assert.equal(await page.locator(selector).first().evaluate((node, pointerType) => {
          const event = new PointerEvent("contextmenu", { bubbles: true, cancelable: true, pointerType });
          node.dispatchEvent(event); return event.defaultPrevented;
        }, type), cancelled);
      }
      const menu = page.getByRole("button", { name: "本地链路测试 更多操作", exact: true });
      await menu.tap();
      await expect(page.getByRole("menuitem", { name: "分享 PDF", exact: true })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(menu).toBeFocused();
      const rightMenu = page.evaluate(() => new Promise(resolve => document.querySelector(".file-open-link").addEventListener("contextmenu", event => setTimeout(() => resolve(event.defaultPrevented), 0), { once: true })));
      await file.click({ button: "right" });
      assert.equal(await rightMenu, false);
      await page.keyboard.press("Escape");
    });
    await scenario(t, fixture, engine, browserType, "native-modifier-navigation", async ({ page, context, library, scorePath, file }) => {
      // A withdrawn hold must not swallow a later native modifier activation.
      await hold(page, file, engine);
      await expect(file).not.toHaveAttribute("data-touch-active");
      // Prove the application leaves native modifier activation intact once.
      // Reader readiness uses a separately controlled page below, so native
      // background-target initialization is not also a decoder timing gate.
      const [other] = await Promise.all([
        context.waitForEvent("page", { timeout: 5_000 }),
        file.click({ modifiers: ["ControlOrMeta"] }),
      ]);
      await expect(other).toHaveURL(new RegExp(`${scorePath}$`));
      await expect(page).toHaveURL(library);
      await other.close();

    });
    await scenario(t, fixture, engine, browserType, "reader-and-local-entry", async ({ page, context, library, scorePath, file }) => {
      // Preserve application-owned cross-window startup with the same account,
      // real SW and storage, independently from native modifier activation.
      const reader = await context.newPage();
      await reader.goto(`${fixture.origin}${scorePath}`);
      await expectSampleScoreContent(reader);
      await reader.close();
      await expect(page).toHaveURL(library);
      await file.tap();
      await expect(page).toHaveURL(new RegExp(`${scorePath}$`));
      await expectSampleScoreContent(page);
      await page.goBack();
      await expect(page).toHaveURL(library);
      await expect(file).toBeVisible();

      // The normal file opening above prepares its verified local copy through
      // the product. Do not inject a Blob into WebKit's ephemeral IndexedDB.
      const storage = library + "/storage";
      await page.getByRole("button", { name: "我的", exact: true }).tap();
      await page.getByRole("menuitem", { name: "本机存储", exact: true }).click();
      await expect(page).toHaveURL(storage);
      const localFile = page.getByRole("link", { name: "本地链路测试", exact: true });
      await expect(localFile).toBeVisible();
      await hold(page, localFile, engine);
      await expect(page).toHaveURL(storage);
      await localFile.focus(); await page.keyboard.press("Enter");
      await expect(page).toHaveURL(new RegExp(`${scorePath}$`));
      await expectSampleScoreContent(page);
    });
  });
}
