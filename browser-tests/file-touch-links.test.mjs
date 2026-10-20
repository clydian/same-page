import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium, webkit, expect } from "@playwright/test";
import { startStorageFixture } from "./storage-fixture.mjs";
import { expectSampleScoreContent } from "./pdf-content.mjs";
import { observeBrowserTargets } from "./ctrl-target-observer.mjs";

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

for (const [engine, browserType] of [["chromium", chromium], ["webkit", webkit]]) {
  test(`file links retain navigation and withdraw held touch (${engine})`, { timeout: 120_000 }, async t => {
    const fixture = await startStorageFixture({ authenticated: true, previewEntry: false });
    const profile = await mkdtemp(path.join(tmpdir(), "same-page-file-touch-"));
    let context;
    let page;
    let targetObserver;
    let phase = "fixture setup";
    const evidence = [];
    const directory = "artifacts/verification/file-touch-links";
    const record = (type, detail = {}) => evidence.push({ type, phase, at: Date.now(), ...detail });
    t.after(async () => {
      await mkdir(directory, { recursive: true });
      try {
        if (targetObserver) {
          await targetObserver.snapshot().catch(error => record("cdp-snapshot-failed", {message: error.message}));
          await targetObserver.close().catch(error => record("cdp-close-failed", {message: error.message}));
        }
        // Keep essential evidence readable even if artifact transfer is unavailable.
        console.log("FILE_LINK_EVIDENCE", JSON.stringify({engine, phase, evidence}));
        if (page && !page.isClosed()) await page.screenshot({ path: `${directory}/${engine}-final.png`, fullPage: true });
        await context?.tracing.stop({ path: `${directory}/${engine}-trace.zip` });
      } finally {
        await writeFile(`${directory}/${engine}-events.json`, JSON.stringify(evidence, null, 2));
      }
    });
    t.after(async () => { try { await context?.close(); } finally { try { await fixture.stop(); } finally { await rm(profile, { recursive: true, force: true }); } } });
    // Native modifier clicks exercise browser tab handling. The default shell
    // can strand new-page initialization: microsoft/playwright#42142. Use the
    // bundled full Chromium/new headless; retain real popup, URL and PDF proofs.
    const nativeTabBrowser = engine === "chromium" ? {channel: "chromium"} : {};
    const executablePath = engine === "chromium" ? process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH : undefined;
    context = await browserType.launchPersistentContext(profile, { headless: true, ...nativeTabBrowser, ...(executablePath ? { executablePath } : {}), viewport: { width: 390, height: 844 }, hasTouch: true, serviceWorkers: "allow" });
    if (engine === "chromium") targetObserver = await observeBrowserTargets(context, record);
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
    await context.exposeBinding("recordFileInput", (_, detail) => record("input", detail));
    await context.addInitScript(() => {
      for (const type of ["pointerdown", "pointerup", "pointercancel", "click", "contextmenu", "keydown", "keyup"]) {
        document.addEventListener(type, event => {
          const target = event.target instanceof Element ? event.target.closest("a, button") : null;
          const detail = { type, target: target?.getAttribute("aria-label") ?? target?.textContent?.slice(0, 40),
            pointerType: event.pointerType, button: event.button, ctrlKey: event.ctrlKey, key: event.key };
          // Native event dispatch can checkpoint microtasks between listeners.
          // Read cancellation after React and target listeners have all run.
          setTimeout(() => void window.recordFileInput({ ...detail, defaultPrevented: event.defaultPrevented }), 0);
        }, true);
      }
    });
    await context.addInitScript(() => localStorage.setItem("reader-gesture-hint-seen", "true"));
    const account = fixture.accounts[0];
    assert.equal((await context.request.post(`${fixture.origin}/api/auth/sign-in/email`, { headers: { origin: fixture.origin }, data: { email: account.email, password: account.password } })).status(), 200);
    const api = `${fixture.origin}/api/choirs/${fixture.choirId}`;
    assert.equal((await context.request.post(`${api}/scores/${fixture.scoreId}/attachments/links`, { data: { id: crypto.randomUUID(), name: "参考外链", url: "https://example.org/reference" } })).status(), 201);
    for (let index = 0; index < 10; index++) {
      assert.equal((await context.request.post(api + "/scores", { multipart: { file: { name: `滚动测试${index}.pdf`, mimeType: "application/pdf", buffer: fixture.pdf } } })).status(), 201);
    }
    page = await context.newPage();
    phase = "file library";
    context.on("page", other => {
      record("new-page", {url: other.url()});
      other.on("framenavigated", frame => record("frame-navigated", {url: frame.url(), main: frame === other.mainFrame()}));
      other.on("close", () => record("page-closed", {url: other.url()}));
    });
    context.on("request", request => { if (request.isNavigationRequest()) record("navigation-request", { url: request.url() }); });
    context.on("response", response => { if (response.request().isNavigationRequest()) record("navigation-response", { url: response.url(), status: response.status() }); });
    const errors = []; page.on("pageerror", error => errors.push({ phase, message: error.message }));
    const library = `${fixture.origin}/choirs/${fixture.choirId}`;
    const scorePath = `/choirs/${fixture.choirId}/scores/${fixture.scoreId}`;
    await page.goto(library);
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
    const file = page.getByRole("link", { name: "本地链路测试", exact: true });
    await expect(file).toBeVisible();
    await expect(file).toHaveAttribute("href", scorePath);
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
    for (let repeat = 0; repeat < 3; repeat++) {
      const rightMenu = page.evaluate(() => new Promise(resolve => document.querySelector(".file-open-link").addEventListener("contextmenu", event => queueMicrotask(() => resolve(event.defaultPrevented)), { once: true })));
      await file.click({ button: "right" });
      assert.equal(await rightMenu, false);
      await page.keyboard.press("Escape");
      phase = `modified link opening ${repeat + 1}`;
      record("click-start");
      // Observe both operations immediately, including an event deadline that
      // expires while click is still waiting for actionability. No failed retry.
      const [other] = await Promise.all([
        context.waitForEvent("page", { timeout: 5_000 }),
        file.click({ modifiers: ["Control"] }).then(() => record("click-complete")),
      ]);
      await expect(other).toHaveURL(new RegExp(`${scorePath}$`));
      await expectSampleScoreContent(other); await other.close();
      await expect(page).toHaveURL(library);
    }
    phase = "normal reader opening";
    await file.tap();
    await expect(page).toHaveURL(new RegExp(`${scorePath}$`));
    await expectSampleScoreContent(page);
    phase = "return to library";
    await page.goBack();
    await expect(page).toHaveURL(library);
    await expect(file).toBeVisible();

    // The normal file opening above prepares its verified local copy through
    // the product. Do not inject a Blob into WebKit's ephemeral IndexedDB.
    const storage = library + "/storage";
    phase = "local storage";
    await page.getByRole("button", { name: "我在此云盘", exact: true }).tap();
    await page.getByRole("menuitem", { name: "本机存储", exact: true }).click();
    await expect(page).toHaveURL(storage);
    const localFile = page.getByRole("link", { name: "本地链路测试", exact: true });
    await expect(localFile).toBeVisible();
    await hold(page, localFile, engine);
    await expect(page).toHaveURL(storage);
    phase = "local reader opening";
    await localFile.focus(); await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`${scorePath}$`));
    await expectSampleScoreContent(page);
    assert.deepEqual(errors, []);
  });
}
