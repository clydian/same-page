import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { chromium, webkit, expect } from "@playwright/test";
import { startStorageFixture } from "./storage-fixture.mjs";

const { assetBase } = JSON.parse(await readFile("dist/client/build.json", "utf8"));

for (const [engine, type] of [["chromium", chromium], ["webkit", webkit]]) {
  test(`release channel read survives navigation during receipt preparation (${engine})`, {
    skip: assetBase === "/",
    timeout: 60000,
  }, async t => {
    const fixture = await startStorageFixture({
      authenticated: true, nonMember: true, previewEntry: false, productAdmin: true,
    });
    let browser;
    t.after(async () => {
      try { await browser?.close(); } finally { await fixture.stop(); }
    });
    browser = await type.launch();
    const context = await browser.newContext({ serviceWorkers: "block" });
    const login = await context.request.post(fixture.origin + "/api/auth/sign-in/email", {
      headers: { origin: fixture.origin },
      data: { email: fixture.accounts[1].email, password: fixture.accounts[1].password },
    });
    assert.equal(login.status(), 200);
    await context.addInitScript(() => {
      if (location.pathname !== "/user") return;
      let first = true, release;
      const navigation = new Promise(resolve => { release = resolve; });
      window.addEventListener("beforeunload", () => release(), { once: true });
      const open = CacheStorage.prototype.open;
      CacheStorage.prototype.open = function (...args) {
        const result = open.apply(this, args);
        if (first && typeof args[0] === "string" && args[0].startsWith("same-page-release-permission-v1:")) {
          first = false;
          window.__releaseReceiptReadHeld = true;
          // Hold the actual cache result across the document's navigation
          // boundary. The independent online read must already have started.
          return Promise.all([result, navigation]).then(([cache]) => cache);
        }
        return result;
      };
    });
    const page = await context.newPage(), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(fixture.origin + "/user");
    await expect(page.getByRole("heading", { name: "账户", exact: true })).toBeVisible();
    await page.waitForFunction(() => window.__releaseReceiptReadHeld === true);
    await page.goto(fixture.origin + "/admin");
    await expect(page.getByRole("link", { name: "打开", exact: true })).toHaveCount(2);
    assert.deepEqual(errors, []);
  });
}
