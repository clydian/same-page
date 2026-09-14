import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import { test } from "node:test";
import { chromium, expect } from "@playwright/test";
import { startVisualServer } from "./setup.mjs";
import { createVisualFixtureSession } from "./fixtures.mjs";

// Hold responses instead of relying on timing sleeps: every assertion below is
// made while the relevant HTTP response is still unavailable.
test("readers in two tabs serialize durable visibility intent", async t => {
  const server = await startVisualServer({ script: "dev" }); t.after(() => server.stop());
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  for (const width of [1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: "block", reducedMotion: "reduce" });
    t.after(() => context.close());
    const fixture = createVisualFixtureSession();
    const preferenceRequests = new EventEmitter();
    const preferenceBodies = [];
    let hold = false;
    const releases = [];
    let puts = 0;
    await context.route("**/api/**", async route => {
      const request = route.request(); const pathname = new URL(request.url()).pathname;
      if (request.method() === "PUT" && pathname.endsWith("/preference")) {
        puts++;
        preferenceBodies.push(request.postDataJSON());
        if (hold) await new Promise(resolve => {
          releases.push(resolve);
          preferenceRequests.emit("held", request);
        });
      }
      await route.fulfill(fixture.resolve({ pathname, method: request.method(), identity: "member", cookie: request.headers().cookie ?? "", body: request.postDataJSON() }));
    });
    await context.addInitScript(() => localStorage.setItem("reader-gesture-hint-seen", "true"));
    const page = await context.newPage();
    await page.goto(`${server.origin}/choirs/visual-choir/scores/visual-score`);
    await page.waitForFunction(() => document.querySelector("[data-pdf-canvas-active]")?.width > 100);
    await page.locator(".page-reader__viewport").click();
    await page.getByRole("button", { name: "笔记图层", exact: true }).click();
    const ensemble = page.getByRole("checkbox", { name: "显示 Ensemble", exact: true });
    await ensemble.waitFor(); hold = true;
    const initial = await ensemble.isChecked();
    await ensemble.click();
    assert.equal(await ensemble.isChecked(), !initial);
    assert.equal(await page.getByRole("checkbox", { name: "显示 Soprano", exact: true }).isEnabled(), true);
    assert.equal(await page.getByText("第一排男高音这里请统一提前吸气并保持轻声进入", { exact: true }).count(), initial ? 0 : 1);
    await ensemble.click(); await ensemble.click();
    assert.equal(await ensemble.isChecked(), !initial);
    hold = false; releases.splice(0).forEach(release => release());
    await waitForPreferences(page);
    assert.equal(await ensemble.isChecked(), !initial);
    if (width === 1440) {
      hold = true; const before = puts;
      // Establish an in-flight old intent before the second tab can save a new
      // one. Otherwise flushKey may correctly coalesce both into a single PUT.
      const [[firstRequest]] = await Promise.all([
        once(preferenceRequests, "held", { signal: AbortSignal.timeout(30_000) }),
        ensemble.click(),
      ]);
      assert.equal(firstRequest.postDataJSON().subscribed, initial);
      const second = await context.newPage();
      await second.goto(`${server.origin}/choirs/visual-choir/scores/visual-score`);
      await second.waitForFunction(() => document.querySelector("[data-pdf-canvas-active]")?.width > 100);
      await second.locator(".page-reader__viewport").click();
      await second.getByRole("button", { name: "笔记图层", exact: true }).click();
      const other = second.getByRole("checkbox", { name: "显示 Ensemble", exact: true });
      await other.waitFor(); await other.click();
      // The scenario requires a newer durable intent while the first tab owns
      // the lock. A checked input only proves optimistic display, not IDB commit.
      await expect.poll(() => second.evaluate(async expected => {
        const { localDatabase } = await import("/src/client/platform/local-database.ts");
        return (await localDatabase.readingPreferences.toArray()).some(row =>
          row.kind === "shared" && row.id === "E" && row.pending && row.subscribed === expected);
      }, !initial)).toBe(true);
      assert.equal(puts, before + 1, "second tab waits for the first tab's preference lock");
      hold = false; releases.splice(0).forEach(release => release());
      await waitForPreferences(second);
      assert.equal(await other.isChecked(), !initial);
      assert.equal(puts, before + 2, "lock holder drains the newer durable intent");
      assert.deepEqual(preferenceBodies.slice(before).map(body => body.subscribed), [initial, !initial]);
      await second.close();
    }
    await context.close();
  }
});

async function waitForPreferences(page) {
  // waitForFunction treats the Promise itself as truthy; poll the resolved IDB
  // result so an unfinished save cannot be mistaken for completed sync.
  await expect.poll(() => page.evaluate(async () => {
    const { localDatabase } = await import("/src/client/platform/local-database.ts");
    const { currentReadingIntent } = await import("/src/client/reader/reading-preference-intents.ts");
    const rows = await localDatabase.readingPreferences.toArray();
    return rows.length > 0 && rows.every(row => {
      const intent = currentReadingIntent(row.key);
      return !row.pending && (!intent || (intent.localState === "saved" && intent.version === row.version));
    });
  })).toBe(true);
}
