import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { chromium, webkit, expect } from "@playwright/test";
import { startStorageFixture } from "./storage-fixture.mjs";

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
    let browser;
    t.after(async () => { try { await browser?.close(); } finally { await fixture.stop(); } });
    const executablePath = engine === "chromium" ? process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH : undefined;
    browser = await browserType.launch({ ...(executablePath ? { executablePath } : {}) });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, serviceWorkers: "block" });
    const account = fixture.accounts[0];
    assert.equal((await context.request.post(`${fixture.origin}/api/auth/sign-in/email`, { headers: { origin: fixture.origin }, data: { email: account.email, password: account.password } })).status(), 200);
    const api = `${fixture.origin}/api/choirs/${fixture.choirId}`;
    assert.equal((await context.request.post(`${api}/scores/${fixture.scoreId}/attachments/links`, { data: { id: crypto.randomUUID(), name: "参考外链", url: "https://example.org/reference" } })).status(), 201);
    for (let index = 0; index < 10; index++) {
      assert.equal((await context.request.post(api + "/scores", { multipart: { file: { name: `滚动测试${index}.pdf`, mimeType: "application/pdf", buffer: fixture.pdf } } })).status(), 201);
    }
    const page = await context.newPage();
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    const library = `${fixture.origin}/choirs/${fixture.choirId}`;
    const scorePath = `/choirs/${fixture.choirId}/scores/${fixture.scoreId}`;
    await page.goto(library);
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
    const rightMenu = page.evaluate(() => new Promise(resolve => document.querySelector(".file-open-link").addEventListener("contextmenu", event => queueMicrotask(() => resolve(event.defaultPrevented)), { once: true })));
    await file.click({ button: "right" });
    assert.equal(await rightMenu, false);
    await page.keyboard.press("Escape");
    const popup = context.waitForEvent("page", { timeout: 5_000 });
    await file.click({ modifiers: ["Control"] });
    const other = await popup;
    await expect(other).toHaveURL(new RegExp(`${scorePath}$`)); await other.close();
    await expect(page).toHaveURL(library);
    await file.tap();
    await expect(page).toHaveURL(new RegExp(`${scorePath}$`));
    await page.goto(library);
    await expect(file).toBeVisible();

    // Seed only this fixture's local copy so the actual storage route exercises
    // the same link surface without requiring an installed offline shell.
    await page.evaluate(async ({ choirId, scoreId, versionId, ownerKey, pdf }) => {
      const db = await new Promise((resolve, reject) => { const request = indexedDB.open("same-page"); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      try {
        await new Promise((resolve, reject) => {
          const tx = db.transaction("offlineScores", "readwrite");
          tx.objectStore("offlineScores").put({ key: "touch-test-copy", ownerKey, scopeKey: JSON.stringify([ownerKey, choirId, scoreId]), choirId, scoreId, versionId, fileName: "本机副本.pdf", blob: new Blob([new Uint8Array(pdf)], { type: "application/pdf" }), active: 1, verifiedAt: Date.now(), sha256: "a".repeat(64), pageCount: 2 });
          tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
        });
      } finally { db.close(); }
    }, { choirId: fixture.choirId, scoreId: fixture.scoreId, versionId: fixture.versionId, ownerKey: `user:${account.id}`, pdf: [...fixture.pdf] });
    const storage = library + "/storage";
    await page.goto(storage);
    const localFile = page.getByRole("link", { name: "本机副本", exact: true });
    await expect(localFile).toBeVisible();
    await hold(page, localFile, engine);
    await expect(page).toHaveURL(storage);
    await localFile.focus(); await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`${scorePath}$`));
    assert.deepEqual(errors, []);
  });
}
