import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import test from "node:test";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium, webkit, expect } from "@playwright/test";
import { startStorageFixture } from "./storage-fixture.mjs";

for (const engine of [chromium, webkit]) {
  test(`${engine.name()}: legacy fills missing APIs in page and Worker and paints CCITT/JPEG2000 online and offline`, { timeout: 90000 }, async t => {
    const pdf = await readFile(new URL("./fixtures/image-codecs.pdf", import.meta.url));
    const fixture = await startStorageFixture({ authenticated: true, pdf });
    t.after(() => fixture.stop());
    const profile = await mkdtemp(path.join(tmpdir(), "same-page-pdf-codecs-"));
    const context = await engine.launchPersistentContext(profile, { headless: true, serviceWorkers: "allow" });
    t.after(async () => { await context.close(); await rm(profile, { recursive: true, force: true }); });
    const account = fixture.accounts[0];
    assert.equal((await context.request.post(`${fixture.origin}/api/auth/sign-in/email`, {
      headers: { origin: fixture.origin }, data: { email: account.email, password: account.password },
    })).status(), 200);
    await context.addInitScript(installCompatibilityProbe);
    await context.addInitScript(() => localStorage.setItem("reader-gesture-hint-seen", "true"));
    const page = await context.newPage();
    await page.goto(`${fixture.origin}/choirs/${fixture.choirId}`, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
    await page.locator(".file-row__open").click();
    await page.waitForURL(`**/scores/${fixture.scoreId}*`);
    const scoreUrl = page.url();
    await assertSquare(page, 1);
    const probe = await page.evaluate(() => globalThis.__pdfCompatibilityProbe);
    assert.deepEqual(probe.pageMissing, [true, true, true, true]);
    assert.deepEqual(probe.workerMissing, [true, true, true, true]);
    await page.getByRole("button", { name: "下一页", exact: true }).press("Enter");
    await assertSquare(page, 2);
    if (!await page.getByRole("button", { name: "更多", exact: true }).isVisible()) {
      const viewport = page.locator(".page-reader__viewport");
      const bounds = await viewport.boundingBox();
      await viewport.click({ position: { x: bounds.width / 2, y: bounds.height / 2 } });
    }
    await page.getByRole("button", { name: "编辑", exact: true }).click();
    const paper = page.getByLabel("第 2 页笔记层", { exact: true });
    const paperBox = await paper.boundingBox();
    await page.mouse.click(paperBox.x + paperBox.width / 2, paperBox.y + paperBox.height / 2);
    await page.getByRole("textbox", { name: "笔记文本", exact: true }).fill("Codec recovery note");
    await page.getByRole("button", { name: "完成文字输入", exact: true }).click();
    await page.getByRole("button", { name: "完成编辑", exact: true }).click();
    await page.getByRole("button", { name: "更多", exact: true }).click();
    await expect(page.getByRole("region", { name: "本机离线副本", exact: true }).getByRole("status")).toHaveText("可离线使用", { timeout: 30_000 });
    // The reader's verified status is the persistence barrier. A second cold
    // library navigation can restore the local owner before get-session settles;
    // session confirmation then replaces the library and dismisses its popover.
    // Codec coverage must not depend on closing that unrelated transient UI.
    await page.close();
    await fixture.stop();
    // WebKit's emulated offline navigation can fail before its Service Worker
    // runs. Stop the actual origin for both engines; Chromium also uses the
    // browser offline flag. No API or asset responses are mocked.
    if (engine === chromium) await context.setOffline(true);
    const offlinePage = await context.newPage();
    await offlinePage.goto(scoreUrl, { waitUntil: "domcontentloaded" });
    assert.equal(await offlinePage.evaluate(async () => {
      try { await fetch("/api/health"); return false; } catch { return true; }
    }), true, "the origin must be unreachable");
    const currentSheet = offlinePage.locator(".page-reader__sheet[data-page-turn-current]");
    await expect(currentSheet).toBeVisible();
    const restoredPage = Number(await currentSheet.getAttribute("data-page-number"));
    assert.ok(restoredPage === 1 || restoredPage === 2);
    await assertSquare(offlinePage, restoredPage);
    await offlinePage.getByRole("button", { name: restoredPage === 1 ? "下一页" : "上一页", exact: true }).press("Enter");
    await assertSquare(offlinePage, restoredPage === 1 ? 2 : 1);
    const beforeFailure = await localRecoveryState(offlinePage, fixture.scoreId);
    assert.ok(beforeFailure.notes.some(note => note.payload?.text === "Codec recovery note"));
    // Engine recovery retains both the verified original bytes and real notes,
    // but the failure page must not offer a misleading notes-free download.
    await context.addInitScript(() => { window.nativePromiseResolvers = Promise.withResolvers; Promise.withResolvers = undefined; });
    await offlinePage.reload({ waitUntil: "domcontentloaded" });
    await expect(offlinePage.getByRole("alert")).toContainText("请升级浏览器或系统");
    await assertRecoveryChoices(offlinePage);
    assert.deepEqual(await localRecoveryState(offlinePage, fixture.scoreId), beforeFailure);
    await offlinePage.evaluate(() => { Promise.withResolvers = window.nativePromiseResolvers; });
    await offlinePage.getByRole("button", { name: "重试加载", exact: true }).click();
    const sheet = offlinePage.locator(".page-reader__sheet[data-page-turn-current]");
    await expect(sheet).toBeVisible();
    await assertSquare(offlinePage, Number(await sheet.getAttribute("data-page-number")));
  });
}

test("missing native Promise.withResolvers keeps explicit recovery without a failure-page original download", { timeout: 60000 }, async t => {
  const fixture = await startStorageFixture({ authenticated: true });
  t.after(() => fixture.stop());
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const context = await browser.newContext();
  const account = fixture.accounts[0];
  assert.equal((await context.request.post(`${fixture.origin}/api/auth/sign-in/email`, {
    headers: { origin: fixture.origin }, data: { email: account.email, password: account.password },
  })).status(), 200);
  await context.addInitScript(() => { Promise.withResolvers = undefined; });
  const page = await context.newPage();
  await page.goto(`${fixture.origin}/choirs/${fixture.choirId}/scores/${fixture.scoreId}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("alert")).toContainText("请升级浏览器或系统");
  await assertRecoveryChoices(page);
  // Removing this fault-page shortcut does not remove the original-file API.
  const original = await context.request.get(`${fixture.origin}/api/choirs/${fixture.choirId}/scores/${fixture.scoreId}/versions/${fixture.versionId}/pdf`);
  assert.equal(original.status(), 200);
  assert.deepEqual(await original.body(), fixture.pdf);
});

async function assertRecoveryChoices(page) {
  await expect(page.getByRole("button", { name: "重试加载", exact: true })).toBeEnabled();
  await page.getByText("更多帮助", { exact: true }).click();
  await expect(page.getByRole("button", { name: "反馈问题", exact: true })).toBeVisible();
  assert.equal(await page.getByRole("button", { name: "下载原 PDF", exact: true }).count(), 0);
  assert.equal(await page.getByRole("link", { name: "下载原 PDF", exact: true }).count(), 0);
}

async function localRecoveryState(page, scoreId) {
  return page.evaluate(async scoreId => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("same-page"); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    try {
      const read = name => new Promise((resolve, reject) => {
        const request = db.transaction(name, "readonly").objectStore(name).getAll();
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      });
      const [files, notes] = await Promise.all([read("offlineScores"), read("annotations")]);
      const file = files.find(record => record.scoreId === scoreId);
      if (!file) throw new Error("verified fixture PDF missing");
      const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", await file.blob.arrayBuffer()))].map(byte => byte.toString(16).padStart(2, "0")).join("");
      return { hash, notes: notes.filter(note => note.scoreId === scoreId && !note.deleted).map(({id, payload}) => ({id, payload})).sort((a, b) => a.id.localeCompare(b.id)) };
    } finally { db.close(); }
  }, scoreId);
}

async function assertSquare(page, pageNumber) {
  const canvas = page.locator(`.page-reader__sheet[data-page-turn-current][data-page-number="${pageNumber}"] .pdf-page-canvas canvas[data-pdf-canvas-active]`).first();
  await expect(canvas).toBeVisible();
  // A successful render promise / visible canvas is insufficient: missing
  // codecs silently finish with a white bitmap. The fixture has a black
  // center and a white corner, so assert actual decoded image content.
  const pixels = await canvas.evaluate(canvas => {
    const ctx = canvas.getContext("2d");
    return { center: [...ctx.getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data],
      corner: [...ctx.getImageData(canvas.width / 8, canvas.height / 8, 1, 1).data] };
  });
  assert.ok(pixels.center.slice(0, 3).every(value => value < 30), `page ${pageNumber}: expected black center, got ${pixels.center}`);
  assert.ok(pixels.corner.slice(0, 3).every(value => value > 225), `page ${pageNumber}: expected white corner, got ${pixels.corner}`);
}

// This is a controlled API-absence regression, not a claim to emulate old Safari.
// Use the shipped entry/Worker and real pixels; both realms must restore APIs.
function installCompatibilityProbe() {
  const removeApis = () => {
    globalThis.Iterator = undefined;
    Promise.try = undefined;
    Map.prototype.getOrInsert = undefined;
    Map.prototype.getOrInsertComputed = undefined;
    return [globalThis.Iterator, Promise.try, Map.prototype.getOrInsert,
      Map.prototype.getOrInsertComputed].map(value => value === undefined);
  };
  const pageMissing = removeApis();
  globalThis.__pdfCompatibilityProbe = { pageMissing };
  const NativeWorker = globalThis.Worker;
  globalThis.Worker = class extends NativeWorker {
    constructor(url, options) {
      const source = `const missing = (${removeApis.toString()})();
        await import(${JSON.stringify(new URL(String(url), location.href).href)});
        self.postMessage({ compatibilityProbe: true, missing });`;
      const wrapper = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
      super(wrapper, options);
      this.addEventListener("message", event => {
        if (!event.data?.compatibilityProbe) return;
        globalThis.__pdfCompatibilityProbe.workerMissing = event.data.missing;
        URL.revokeObjectURL(wrapper);
      });
    }
  };
}
