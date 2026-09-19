import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { PDFDocument, degrees } from "pdf-lib";
import { mkdir } from "node:fs/promises";
import { after, before, test } from "node:test";
import { chromium, webkit } from "playwright";
import { expect } from "@playwright/test";
import { startVisualServer } from "./setup.mjs";
import { resolveFixtureRequest } from "./fixtures.mjs";
let server;
let variedPdf;
let selectedScore;
before(async () => {
  server = await startVisualServer({ script: "dev" });
  const source = resolveFixtureRequest({ pathname: "/api/choirs/visual-choir/scores/visual-score/pdf", identity: "member" });
  const pdf = await PDFDocument.load(source.body);
  pdf.getPage(1).setSize(900, 500);
  pdf.getPage(1).setRotation(degrees(90));
  variedPdf = Buffer.from(await pdf.save());
  selectedScore = JSON.parse(resolveFixtureRequest({ pathname: "/api/choirs/visual-choir/scores/visual-score/sync", identity: "member" }).body).score;
  selectedScore.currentVersion = { ...selectedScore.currentVersion, sizeBytes: variedPdf.length, sha256: createHash("sha256").update(variedPdf).digest("hex") };
});
after(async () => server?.stop());

for (const [name, engine] of Object.entries({ chromium, webkit })) {
  test(`${name}: paged navigation preserves pan and cancellation in reading and editing`, async t => {
    const browser = await engine.launch({ headless: true });
    t.after(() => browser.close());
    for (const editing of [false, true]) for (const zoom of [1, 2]) {
      const scenario = `page-${editing ? "edit" : "read"}-${zoom}`;
      if (process.env.NAVIGATION_CASE && process.env.NAVIGATION_CASE !== scenario) continue;
      t.diagnostic(scenario);
      const context = await browser.newContext({ viewport: { width: 834, height: 800 }, hasTouch: true,
        serviceWorkers: "block", reducedMotion: "no-preference" });
      await context.route("**/api/**", async route => route.fulfill(resolveFixtureRequest({
        pathname: new URL(route.request().url()).pathname, method: route.request().method(),
        identity: "member", scenarioId: "reader-controls-narrow", cookie: "", pdf: variedPdf, selectedScore })));
      await context.addInitScript(() => localStorage.setItem("reader-gesture-hint-seen", "true"));
      const page = await context.newPage();
      await page.goto(`${server.origin}/choirs/visual-choir/scores/visual-score`, { waitUntil: "domcontentloaded" });
      await page.locator("[data-page-turn-current] [data-pdf-canvas-active]").waitFor();
      await page.locator(".page-reader__viewport").click({ position: { x: 417, y: 400 } });
      if (editing) await page.getByRole("button", { name: "编辑", exact: true }).click();
      const viewport = page.locator(".page-reader__viewport");
      const fingers = editing ? 2 : 1;
      if (zoom === 2) {
        await send(viewport, "down", [200, 300]);
        await send(viewport, "move", [200, 400]);
        await send(viewport, "up", [200, 400]);
        await expect(viewport).toHaveAttribute("data-zoom", "2");
      }
      const allowance = await horizontalPanAllowance(viewport);
      const xs = offset => Array.from({ length: fingers }, (_, index) => 500 + index * 100 - offset);
      const gestureStart = await navigationSnapshot(viewport);
      await send(viewport, "down", xs(0));
      if (allowance > 0) {
        await send(viewport, "move", xs(allowance));
        assert.equal(await currentPage(viewport), 1);
      }
      await send(viewport, "move", xs(allowance + 100));
      const surface = viewport.locator('[data-page-turn-phase="dragging"]').first();
      try {
        await expect(surface).toHaveAttribute("data-page-turn-progress", /-0\./);
      } catch (error) {
        t.diagnostic(JSON.stringify({ scenario, allowance, gestureStart, failed: await navigationSnapshot(viewport) }));
        throw error;
      }

      await viewport.locator("[data-page-turn-target] [data-pdf-canvas-active]").waitFor();
      await send(viewport, "move", xs(allowance + 105));
      const directory = "artifacts/verification/302";
      await mkdir(directory, { recursive: true });
      if (editing && zoom === 2) await page.screenshot({ path: `${directory}/${name}-page-drag.png` });
      // A slow partial turn returns without fitting the current page.
      await page.waitForTimeout(150);
      await send(viewport, "up", xs(allowance + 105));
      await expect(viewport.locator('[data-page-turn-phase="settling"]')).toHaveCount(0);
      assert.equal(await currentPage(viewport), 1);
      assert.equal(Number(await viewport.getAttribute("data-zoom")), zoom);
      // Consume the current pan allowance, then the common distance rule commits either input.
      const nextAllowance = await horizontalPanAllowance(viewport);
      await send(viewport, "down", xs(0));
      await send(viewport, "move", xs(nextAllowance + 300));
      await send(viewport, "up", xs(nextAllowance + 300));
      await expect.poll(() => currentPage(viewport)).toBe(2);
      await expect.poll(async () => Number(await viewport.getAttribute("data-zoom"))).toBeLessThanOrEqual(1);
      await expect.poll(() => viewport.evaluate(node => {
        const current = node.querySelector("[data-page-turn-current] .annotated-pdf-page");
        const paper = current.getBoundingClientRect(), bounds = node.getBoundingClientRect();
        return Math.abs(paper.width / paper.height - 500 / 900) < 0.001 &&
          Math.abs((paper.left + paper.right - bounds.left - bounds.right) / 2) < 2 &&
          Math.abs((paper.top + paper.bottom - bounds.top - bounds.bottom) / 2) < 5;
      })).toBe(true);
      assert.equal(await viewport.locator('[data-edit-page-turn]').count(), 0);
      if (editing) await expect(viewport.locator('.annotation-overlay[data-editing]')).toHaveAttribute("data-tool", "text");
      if (editing && zoom === 2) await page.screenshot({ path: `${directory}/${name}-page-complete.png` });
      await context.close();
    }
  });
}
async function currentPage(viewport) {
  return viewport.evaluate(node => {
    const current = node.querySelector("[data-page-turn-current]");
    return Number(current.dataset.pageNumber);
  });
}
async function send(viewport, phase, xs) {
  await viewport.evaluate((node, { phase, xs }) => {
    // Keep synthetic contacts separate from the real mouse used by locator.click.
    // Linux WebKit sends mouse moves after layout/scroll at pointerId 1;
    // reusing that id would turn those moves into part of this touch gesture.
    xs.forEach((clientX, index) => node.dispatchEvent(new PointerEvent(`pointer${phase}`,
      { bubbles: true, pointerType: "touch", pointerId: index + 101, clientX, clientY: 300 })));
    return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }, { phase, xs });
}

async function navigationSnapshot(viewport) {
  return viewport.evaluate(node => ({
    zoom: node.dataset.zoom,
    scrollLeft: node.scrollLeft,
    viewport: node.getBoundingClientRect().toJSON(),
    paper: node.querySelector("[data-page-turn-current] .page-reader__content")?.getBoundingClientRect().toJSON(),
    navigation: { ...node.querySelector("[data-page-turn-phase]")?.dataset },
    alert: document.querySelector("[role=alert]")?.textContent,
  }));
}

async function horizontalPanAllowance(viewport) {
  return viewport.evaluate(node => Math.max(0,
    node.querySelector("[data-page-turn-current] .page-reader__content").getBoundingClientRect().right - node.getBoundingClientRect().right));
}
