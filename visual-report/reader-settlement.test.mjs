import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { after, before, test } from "node:test";
import { chromium, webkit } from "playwright";
import { expect } from "@playwright/test";
import { PDFDocument, rgb } from "pdf-lib";
import { startVisualServer } from "./setup.mjs";
import { resolveFixtureRequest } from "./fixtures.mjs";

let server;
before(async () => { server = await startVisualServer({ script: "dev" }); });
after(async () => { await server?.stop(); });

async function openReader(t, engine, viewport, overrides = {}) {
  const browser = await engine.launch({ headless: true });
  t.after(() => browser.close());
  const context = await browser.newContext({ viewport, hasTouch: true, serviceWorkers: "block" });
  await context.route("**/api/**", route => route.fulfill(resolveFixtureRequest({
    pathname: new URL(route.request().url()).pathname, method: route.request().method(),
    identity: "member", scenarioId: "reader-controls-narrow", cookie: "", ...overrides,
  })));
  await context.addInitScript(() => localStorage.setItem("reader-gesture-hint-seen", "true"));
  const page = await context.newPage();
  await page.goto(`${server.origin}/choirs/visual-choir/scores/visual-score`);
  await page.locator("[data-page-turn-current] [data-pdf-canvas-active]").waitFor();
  return page;
}

// Deliver both contacts together before a frame, through each layout's real
// input path. Moving the midpoint as well as shrinking caught the original bug.
async function gesture(viewport, native, scale, from = { x: 400, y: 200 }, to = { x: 500, y: 550 }) {
  return viewport.evaluate(async (e, { native, scale, from, to }) => {
    const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const start = [[1, from.x - 100, from.y], [2, from.x + 100, from.y]];
    const end = [[1, to.x - 100 * scale, to.y], [2, to.x + 100 * scale, to.y]];
    const send = (phase, points, changed = points) => {
      if (native) {
        const touch = ([identifier, clientX, clientY]) => ({ identifier, clientX, clientY, target: e });
        const event = new Event(`touch${phase}`, { bubbles: true, cancelable: true });
        Object.defineProperties(event, { touches: { value: points.map(touch) }, changedTouches: { value: changed.map(touch) } });
        e.dispatchEvent(event);
      } else {
        const types = { start: "pointerdown", move: "pointermove", end: "pointerup" };
        for (const [pointerId, clientX, clientY] of changed) e.dispatchEvent(new PointerEvent(types[phase], { pointerId, pointerType: "touch", clientX, clientY, bubbles: true }));
      }
    };
    send("start", start.slice(0, 1)); send("start", start, start.slice(1));
    send("move", end); await frame();
    send("end", end.slice(1), end.slice(0, 1)); send("end", [], end.slice(1));
    await frame();
  }, { native, scale, from, to });
}

async function fitted(viewport, paper) {
  await expect.poll(() => paper.evaluate(e => {
    const p = e.getBoundingClientRect(), v = e.closest(".continuous-reader, .page-reader__viewport").getBoundingClientRect();
    const fit = Math.min(v.width, v.height * p.width / p.height);
    return Math.max(Math.abs(p.width - fit), Math.abs(p.left + p.width / 2 - v.left - v.width / 2), Math.abs(p.top + p.height / 2 - v.top - v.height / 2));
  })).toBeLessThanOrEqual(1.1);
  await expect(viewport.locator("[data-gesture-preview]")).toHaveCount(0);
}

for (const [name, engine] of Object.entries({ chromium, webkit })) {
  test(`${name}: continuous editing crosses short pages and its guidance stays readable on dark paper`, async t => {
    const pdf = await PDFDocument.create();
    for (const size of [[600, 800], [1000, 300], [1000, 300]]) {
      const sheet = pdf.addPage(size);
      sheet.drawRectangle({ x: 0, y: 0, width: size[0], height: size[1], color: rgb(.06, .07, .065) });
    }
    const bytes = Buffer.from(await pdf.save());
    const score = JSON.parse(resolveFixtureRequest({ pathname: '/api/choirs/visual-choir/scores/visual-score/sync', identity: 'member' }).body).score;
    score.currentVersion = { ...score.currentVersion, pageCount: 3, sizeBytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
    const page = await openReader(t, engine, { width: 1194, height: 834 }, { pdf: bytes, selectedScore: score });
    await page.locator('.page-reader__viewport').click({ position: { x: 597, y: 350 } });
    await page.getByRole('button', { name: '更多', exact: true }).click();
    await page.getByRole('button', { name: '连续滚动', exact: true }).click();
    await page.getByRole('button', { name: '编辑', exact: true }).click();
    const viewport = page.locator('.continuous-reader');
    await page.locator('.annotation-controls').waitFor();
    await page.locator('.continuous-reader [data-pdf-canvas-active]').first().waitFor();
    const directory = 'artifacts/verification/reader-editing-flow';
    await mkdir(directory, { recursive: true });
    await page.screenshot({ path: `${directory}/${name}-dark.png` });
    await gesture(viewport, false, 1, { x: 500, y: 400 }, { x: 500, y: -900 });
    await page.locator('.annotation-overlay[data-editing] svg[aria-label="第 2 页笔记层"]').waitFor();
    await gesture(viewport, false, 1, { x: 500, y: 400 }, { x: 500, y: 0 });
    await page.locator('.annotation-overlay[data-editing] svg[aria-label="第 3 页笔记层"]').waitFor();
    await gesture(viewport, false, 1, { x: 500, y: 400 }, { x: 500, y: 800 });
    await page.locator('.annotation-overlay[data-editing] svg[aria-label="第 2 页笔记层"]').waitFor();
    assert.equal(Number(await viewport.getAttribute('data-zoom')), 1);
  });
  for (const size of [{ width: 1194, height: 834 }, { width: 834, height: 1194 }]) {
    for (const layout of ["page", "continuous"]) for (const editing of [false, true]) {
      test(`${name}: ${size.width}px ${layout} editing=${editing} settles underfit and bounds pan`, async t => {
        const page = await openReader(t, engine, size);
        if (layout === "continuous" || editing) {
          await page.locator(".page-reader__viewport").click({ position: { x: size.width / 2, y: size.height / 2 } });
          if (layout === "continuous") {
            await page.getByRole("button", { name: "更多", exact: true }).click();
            await page.getByRole("button", { name: "连续滚动", exact: true }).click();
          }
          if (editing) await page.getByRole("button", { name: "编辑", exact: true }).click();
        }
        const viewport = page.locator(layout === "page" ? ".page-reader__viewport" : ".continuous-reader");
        let paper = viewport.locator(layout === "page" ? "[data-page-turn-current] .annotated-pdf-page" : '[data-index="0"] .annotated-pdf-page');
        const native = layout === "continuous" && !editing;
        await gesture(viewport, native, 0.2);
        await fitted(viewport, paper);
        const fitZoom = Number(await viewport.getAttribute("data-zoom"));
        const center = { x: size.width / 2, y: size.height / 2 };
        await gesture(viewport, native, 2, center, center);
        await expect.poll(async () => Number(await viewport.getAttribute("data-zoom"))).toBeCloseTo(fitZoom * 2, 3);
        if (layout === "page") {
          await gesture(viewport, native, 1, center, { ...center, y: center.y + 2000 });
          await expect.poll(() => paper.evaluate(e => Math.abs(e.getBoundingClientRect().top))).toBeLessThanOrEqual(1.1);
          await gesture(viewport, native, 1, center, { ...center, y: center.y - 2000 });
          await expect.poll(() => paper.evaluate((e, height) => Math.abs(e.getBoundingClientRect().bottom - height), size.height)).toBeLessThanOrEqual(1.1);
        }
        await gesture(viewport, native, 0.1);
        await fitted(viewport, paper);
        if (native) {
          await viewport.evaluate(e => { e.scrollTop = e.scrollHeight; });
          await expect(page.locator(".reader-page-indicator")).toHaveText(/^2\s*\//);
          paper = viewport.locator('[data-index="1"] .annotated-pdf-page');
          await fitted(viewport, paper);
          await viewport.evaluate(e => { e.scrollTop = 0; });
          await expect(page.locator(".reader-page-indicator")).toHaveText(/^1\s*\//);
          paper = viewport.locator('[data-index="0"] .annotated-pdf-page');
          await fitted(viewport, paper);
        }
        if (size.width === 1194 && !editing) {
          const directory = "artifacts/verification/332";
          await mkdir(directory, { recursive: true });
          await page.screenshot({ path: `${directory}/${name}-${layout}-settled.png` });
        }
      });
    }
  }

  test(`${name}: continuous pinch fits its mixed-size hit page and keeps both document ends reachable`, async t => {
    const pdf = await PDFDocument.create();
    for (let i = 0; i < 20; i++) pdf.addPage(i === 19 ? [1000, 500] : [600, 800]);
    const bytes = Buffer.from(await pdf.save());
    const score = JSON.parse(resolveFixtureRequest({ pathname: "/api/choirs/visual-choir/scores/visual-score/sync", identity: "member" }).body).score;
    score.currentVersion = { ...score.currentVersion, pageCount: 20, sizeBytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
    const page = await openReader(t, engine, { width: 1194, height: 834 }, { pdf: bytes, selectedScore: score });
    await page.locator(".page-reader__viewport").click({ position: { x: 597, y: 350 } });
    await page.getByRole("button", { name: "更多", exact: true }).click();
    await page.getByRole("button", { name: "连续滚动", exact: true }).click();
    const viewport = page.locator(".continuous-reader");
    await viewport.evaluate(e => { e.scrollTop = e.scrollHeight; });
    const last = viewport.locator('[data-index="19"] .annotated-pdf-page');
    await last.waitFor();
    await viewport.evaluate(e => { e.scrollTop += e.querySelector('[data-index="19"]').getBoundingClientRect().top - 600; });
    await expect(page.locator(".reader-page-indicator")).toHaveText(/^19\s*\//);
    await gesture(viewport, true, 0.2, { x: 597, y: 710 }, { x: 700, y: 750 });
    await fitted(viewport, last);
    assert.equal(Number(await viewport.getAttribute("data-zoom")), 1);
    await viewport.evaluate(e => { e.scrollTop = 0; });
    await expect(page.locator(".reader-page-indicator")).toHaveText(/^1\s*\//);
    const first = viewport.locator('[data-index="0"] .annotated-pdf-page');
    await expect.poll(() => first.evaluate(e => Math.abs(e.getBoundingClientRect().top))).toBeLessThanOrEqual(1.1);
    await viewport.evaluate(e => { e.scrollTop = e.scrollHeight; });
    await fitted(viewport, last);
  });
}
