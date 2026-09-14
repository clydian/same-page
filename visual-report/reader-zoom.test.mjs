import { createHash } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium, webkit } from "playwright";
import { expect } from "@playwright/test";
import { startVisualServer } from "./setup.mjs";
import { resolveFixtureRequest } from "./fixtures.mjs";

let server;
before(async () => { server = await startVisualServer({ script: "dev" }); });
after(async () => { await server?.stop(); });

for (const [name, engine] of Object.entries({ chromium, webkit })) {
  test(`${name}: landscape pinch preserves the paper point across fitted gutters`, async t => {
    const browser = await engine.launch({ headless: true });
    t.after(() => browser.close());
    const context = await browser.newContext({ viewport: { width: 1194, height: 834 }, hasTouch: true, serviceWorkers: "block" });
    await context.route("**/api/**", route => route.fulfill(resolveFixtureRequest({
      pathname: new URL(route.request().url()).pathname, method: route.request().method(),
      identity: "member", scenarioId: "reader-controls-narrow", cookie: "",
    })));
    await context.addInitScript(() => localStorage.setItem("reader-gesture-hint-seen", "true"));
    const page = await context.newPage();
    await page.goto(`${server.origin}/choirs/visual-choir/scores/visual-score`);
    await page.locator("[data-page-turn-current] [data-pdf-canvas-active]").waitFor();
    await page.locator(".page-reader__viewport").click({ position: { x: 597, y: 350 } });
    await page.getByRole("button", { name: "更多", exact: true }).click();
    await page.getByRole("button", { name: "连续滚动", exact: true }).click();
    const viewport = page.locator(".continuous-reader");
    // Whole-screen double taps must not run the first single tap.
    await page.getByRole("button", { name: "更多", exact: true }).click();
    await page.getByRole("button", { name: "适合页面", exact: true }).click();
    await page.getByRole("button", { name: "更多", exact: true }).click();
    await viewport.dblclick({ position: { x: 400, y: 350 }, delay: 80 });
    await expect.poll(() => viewport.evaluate(e => Number(e.dataset.zoom))).toBeCloseTo(2, 3);
    await viewport.dblclick({ position: { x: 400, y: 350 }, delay: 80 });
    await expect.poll(() => viewport.evaluate(e => Number(e.dataset.zoom))).toBeCloseTo(1, 3);
    for (const factor of [1.5, 2.5]) {
      await page.getByRole("button", { name: "更多", exact: true }).click();
      await page.getByRole("button", { name: "适合页面", exact: true }).click();
      await page.getByRole("button", { name: "更多", exact: true }).click();
      await expect.poll(() => viewport.evaluate(e => Number(e.dataset.zoom))).toBeLessThan(1);
      const result = await viewport.evaluate(async (e, factor) => {
        const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        await frame();
        const x = 597, y = 350;
        const paper = [...e.querySelectorAll(".annotated-pdf-page")].find(p => {
          const r = p.getBoundingClientRect(); return r.top <= y && r.bottom > y;
        });
        const bounds = paper.getBoundingClientRect();
        const u = (x - bounds.left) / bounds.width, v = (y - bounds.top) / bounds.height;
        const point = () => { const r = paper.getBoundingClientRect(); return { x: r.left + u * r.width, y: r.top + v * r.height }; };
        const send = (type, xs, changed = xs) => {
          const touch = ([id, clientX]) => ({ identifier: id, clientX, clientY: y, target: e });
          const event = new Event(type, { bubbles: true, cancelable: true });
          Object.defineProperties(event, { touches: { value: xs.map(touch) }, changedTouches: { value: changed.map(touch) } });
          e.dispatchEvent(event);
        };
        send("touchstart", [[1, x - 100]]);
        send("touchstart", [[1, x - 100], [2, x + 100]], [[2, x + 100]]);
        send("touchmove", [[1, x - 100 * factor], [2, x + 100 * factor]]);
        await frame();
        const preview = point();
        send("touchend", [[2, x + 100 * factor]], [[1, x - 100 * factor]]);
        send("touchend", [], [[2, x + 100 * factor]]);
        await frame();
        const committed = point();
        await new Promise(resolve => setTimeout(resolve, 300));
        return { preview, committed, settled: point() };
      }, factor);
      // Native scroll rounds each axis to CSS pixels independently.
      for (const phase of ["committed", "settled"]) {
        assert.ok(Math.max(Math.abs(result[phase].x - result.preview.x), Math.abs(result[phase].y - result.preview.y)) <= 1,
          `${factor}x ${phase}: ${JSON.stringify(result)}`);
      }
    }
    // A downward-moving pinch settles at the document edge without creating
    // leading space. Editing and zoom share the same page bounds.
    await page.getByRole("button", { name: "更多", exact: true }).click();
    await page.getByRole("button", { name: "适合页面", exact: true }).click();
    await page.getByRole("button", { name: "关闭更多阅读选项", exact: true }).click();
    await viewport.evaluate(async e => {
      const send = (type, points, changed = points) => {
        const touch = ([identifier, clientX, clientY]) => ({ identifier, clientX, clientY, target: e });
        const event = new Event(type, { bubbles: true, cancelable: true });
        Object.defineProperties(event, { touches: { value: points.map(touch) }, changedTouches: { value: changed.map(touch) } });
        e.dispatchEvent(event);
      };
      send("touchstart", [[1, 400, 100]]);
      send("touchstart", [[1, 400, 100], [2, 600, 100]], [[2, 600, 100]]);
      send("touchmove", [[1, 350, 300], [2, 650, 300]]);
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      send("touchend", [[2, 650, 300]], [[1, 350, 300]]); send("touchend", [], [[2, 650, 300]]);
    });
    await expect.poll(() => viewport.locator('[data-page-turn-current] .annotated-pdf-page').evaluate(e => Math.abs(e.getBoundingClientRect().top))).toBeLessThanOrEqual(1);
    await page.getByRole("button", { name: "编辑", exact: true }).click();
    await expect(viewport).toHaveAttribute("data-editing", "true");
    await viewport.evaluate(async e => {
      for (const [phase, y] of [["pointerdown", 350], ["pointermove", -650], ["pointerup", -650]]) {
        [400, 500].forEach((x, i) => e.dispatchEvent(new PointerEvent(phase, { bubbles: true, pointerId: i + 1, pointerType: "touch", clientX: x, clientY: y })));
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      }
    });
    await expect.poll(() => viewport.locator('[data-page-turn-current] .annotated-pdf-page').evaluate(e => Math.abs(e.getBoundingClientRect().bottom - 834))).toBeLessThanOrEqual(1);
  });
}

for (const [name, engine] of Object.entries({ chromium, webkit })) {
  test(`${name}: continuous double tap restores width and centers short paper across mixed-size pages`, async t => {
    const browser = await engine.launch({ headless: true });
    t.after(() => browser.close());
    const context = await browser.newContext({ viewport: { width: 1194, height: 834 }, hasTouch: true, serviceWorkers: "block" });
    const original = resolveFixtureRequest({ pathname: "/api/choirs/visual-choir/scores/visual-score/pdf", identity: "member" });
    const pdf = await PDFDocument.load(original.body);
    pdf.getPage(1).setSize(1000, 500);
    const bytes = Buffer.from(await pdf.save());
    const score = JSON.parse(resolveFixtureRequest({ pathname: "/api/choirs/visual-choir/scores/visual-score/sync", identity: "member" }).body).score;
    score.currentVersion = { ...score.currentVersion, sizeBytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
    await context.route("**/api/**", route => route.fulfill(resolveFixtureRequest({
      pathname: new URL(route.request().url()).pathname, method: route.request().method(), identity: "member",
      scenarioId: "reader-controls-narrow", cookie: "", pdf: bytes, selectedScore: score,
    })));
    await context.addInitScript(() => localStorage.setItem("reader-gesture-hint-seen", "true"));
    const page = await context.newPage();
    await page.goto(`${server.origin}/choirs/visual-choir/scores/visual-score`);
    await page.locator("[data-page-turn-current] [data-pdf-canvas-active]").waitFor();
    await page.locator(".page-reader__viewport").click({ position: { x: 597, y: 350 } });
    await page.getByRole("button", { name: "更多", exact: true }).click();
    await page.getByRole("button", { name: "连续滚动", exact: true }).click();
    const viewport = page.locator(".continuous-reader");
    const second = viewport.locator('[data-index="1"] .annotated-pdf-page');
    await second.waitFor();
    await viewport.evaluate(e => { e.scrollTop += e.querySelector('[data-index="1"]').getBoundingClientRect().top - e.getBoundingClientRect().top - 600; });
    await expect(viewport.locator('[data-page-turn-current]')).toHaveAttribute("data-index", "0");
    // The first double tap enlarges the shared fit-width baseline, even when
    // the hit page differs from the viewport-center current page.
    await viewport.dblclick({ position: { x: 597, y: 710 }, delay: 80 });
    await expect(viewport).toHaveAttribute("data-zoom", "2");
    await viewport.dblclick({ position: { x: 597, y: 710 }, delay: 80 });
    await expect(viewport).toHaveAttribute("data-zoom", "1");
    await expect.poll(() => second.evaluate(e => { const r = e.getBoundingClientRect(); return Math.abs(r.top + r.height / 2 - 417); })).toBeLessThanOrEqual(1);
    await viewport.evaluate(e => { e.scrollTop += e.querySelector('[data-index="1"]').getBoundingClientRect().top - 200; });
    await expect(viewport.locator('[data-page-turn-current]')).toHaveAttribute("data-index", "1");
    await page.getByRole("button", { name: "更多", exact: true }).click();
    await page.getByRole("button", { name: "适合页面", exact: true }).click();
    await page.getByRole("button", { name: "关闭更多阅读选项", exact: true }).click();
    await expect.poll(() => second.evaluate(e => { const r = e.getBoundingClientRect(); return Math.abs(r.top + r.height / 2 - 417); })).toBeLessThanOrEqual(1);
  });
}

for (const [name, engine] of Object.entries({ chromium, webkit })) {
  test(`${name}: edge double tap wins over delayed paging and second-down crosses the deadline`, async t => {
    const browser = await engine.launch({ headless: true });
    t.after(() => browser.close());
    const context = await browser.newContext({ viewport: { width: 1194, height: 834 }, hasTouch: true, serviceWorkers: "block" });
    await context.route("**/api/**", route => route.fulfill(resolveFixtureRequest({
      pathname: new URL(route.request().url()).pathname, method: route.request().method(),
      identity: "member", scenarioId: "reader-controls-narrow", cookie: "",
    })));
    await context.addInitScript(() => localStorage.setItem("reader-gesture-hint-seen", "true"));
    const page = await context.newPage();
    await page.goto(`${server.origin}/choirs/visual-choir/scores/visual-score`);
    const viewport = page.locator(".page-reader__viewport");
    await viewport.locator("[data-page-turn-current] [data-pdf-canvas-active]").waitFor();
    await page.mouse.move(850, 350);
    await page.mouse.down(); await page.mouse.up();
    await page.waitForTimeout(180);
    await page.mouse.down();
    await page.waitForTimeout(120);
    await expect(viewport.locator("[data-page-turn-current]")).toHaveAttribute("data-page-number", "1");
    await page.mouse.up();
    await expect(viewport).toHaveAttribute("data-zoom", "2");
    await page.waitForTimeout(300);
    await expect(page.getByRole("button", { name: "更多", exact: true })).toHaveCount(0);
    await expect(viewport.locator("[data-page-turn-current]")).toHaveAttribute("data-page-number", "1");
    // A zoomed edge single tap reveals controls without paging.
    await page.mouse.click(850, 350);
    await page.getByRole("button", { name: "更多", exact: true }).waitFor();
    await expect(viewport.locator("[data-page-turn-current]")).toHaveAttribute("data-page-number", "1");
    // The toolbar shares the pinch limit, without increasing render budgets.
    await page.getByRole("button", { name: "更多", exact: true }).click();
    for (let step = 0; step < 14; step++) await page.getByRole("button", { name: "放大", exact: true }).click();
    await expect(viewport).toHaveAttribute("data-zoom", "5");
    await page.getByRole("button", { name: "关闭更多阅读选项", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "更多阅读选项" })).toHaveCount(0);
    // A double tap restores fit, then a single edge tap may turn.
    await page.mouse.dblclick(850, 350, { delay: 80 });
    await expect(viewport).toHaveAttribute("data-zoom", "1");
    await page.mouse.click(850, 350);
    await expect(viewport.locator("[data-page-turn-current]")).toHaveAttribute("data-page-number", "2");
    // Cancelling a pinch, including through orientation change, cannot leave
    // a preview or execute a delayed tap when the remaining finger releases.
    const pair = async phase => viewport.evaluate((e, phase) => {
      for (const [id, x] of [[1, 550], [2, phase === "pointerdown" ? 650 : 750]]) {
        e.dispatchEvent(new PointerEvent(phase, { bubbles: true, pointerId: id, pointerType: "touch", clientX: x, clientY: 350 }));
      }
    }, phase);
    await pair("pointerdown"); await pair("pointermove");
    await expect(viewport.locator("[data-gesture-preview]").first()).toBeAttached();
    await page.setViewportSize({ width: 834, height: 1194 });
    await expect(viewport.locator("[data-gesture-preview]")).toHaveCount(0);
    await pair("pointerup");
    await expect(viewport).toHaveAttribute("data-zoom", "1");
    await viewport.evaluate(e => {
      for (const [phase, xs] of [["pointerdown", [350, 450]], ["pointermove", [50, 750]], ["pointerup", [50, 750]]]) {
        xs.forEach((clientX, i) => e.dispatchEvent(new PointerEvent(phase, { bubbles: true, pointerId: i + 1, pointerType: "touch", clientX, clientY: 350 })));
      }
    });
    await expect(viewport).toHaveAttribute("data-zoom", "5");
    const alignment = await viewport.locator('[data-page-turn-current] .annotated-pdf-page').evaluate(e => {
      const paper = e.getBoundingClientRect(), notes = e.querySelector(".annotation-overlay").getBoundingClientRect();
      return Math.max(Math.abs(paper.left - notes.left), Math.abs(paper.top - notes.top), Math.abs(paper.width - notes.width), Math.abs(paper.height - notes.height));
    });
    assert.ok(alignment <= 1, `5x PDF/note alignment: ${alignment}`);


  });
}

for (const [name, engine] of Object.entries({ chromium, webkit })) {
  test(`${name}: zoom pins a distant hit page and fitted tail leaves the document start reachable`, async t => {
    const browser = await engine.launch({ headless: true });
    t.after(() => browser.close());
    const context = await browser.newContext({ viewport: { width: 1194, height: 834 }, hasTouch: true, serviceWorkers: "block" });
    const pdf = await PDFDocument.create();
    for (let i = 0; i < 20; i++) pdf.addPage(i === 19 ? [1000, 500] : [600, 800]);
    const bytes = Buffer.from(await pdf.save());
    const score = JSON.parse(resolveFixtureRequest({ pathname: "/api/choirs/visual-choir/scores/visual-score/sync", identity: "member" }).body).score;
    score.currentVersion = { ...score.currentVersion, pageCount: 20, sizeBytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
    await context.route("**/api/**", route => route.fulfill(resolveFixtureRequest({
      pathname: new URL(route.request().url()).pathname, method: route.request().method(), identity: "member",
      scenarioId: "reader-controls-narrow", cookie: "", pdf: bytes, selectedScore: score,
    })));
    await context.addInitScript(() => localStorage.setItem("reader-gesture-hint-seen", "true"));
    const page = await context.newPage();
    await page.goto(`${server.origin}/choirs/visual-choir/scores/visual-score`);
    await page.locator("[data-page-turn-current] [data-pdf-canvas-active]").waitFor();
    await page.locator(".page-reader__viewport").click({ position: { x: 597, y: 350 } });
    await page.getByRole("button", { name: "更多", exact: true }).click();
    await page.getByRole("button", { name: "连续滚动", exact: true }).click();
    const viewport = page.locator(".continuous-reader");
    await viewport.evaluate(e => { e.scrollTop = e.scrollHeight; });
    const last = viewport.locator('[data-index="19"] .annotated-pdf-page');
    await last.waitFor();
    // Make the previous portrait page current, while the last landscape page
    // is visible under the double tap. It falls outside overscan after zoom.
    await viewport.evaluate(e => { e.scrollTop += e.querySelector('[data-index="19"]').getBoundingClientRect().top - 600; });
    await expect(viewport.locator('[data-page-turn-current]')).toHaveAttribute("data-index", "18");
    const originalTop = await last.evaluate(e => e.getBoundingClientRect().top);
    await viewport.dblclick({ position: { x: 597, y: 710 }, delay: 80 });
    await expect(viewport).toHaveAttribute("data-zoom", "2");
    await expect.poll(() => last.evaluate((e, top) => Math.abs(e.getBoundingClientRect().top + (710 - top) * 2 - 710), originalTop)).toBeLessThanOrEqual(1);
    await viewport.dblclick({ position: { x: 597, y: 710 }, delay: 80 });
    await expect(viewport).toHaveAttribute("data-zoom", "1");
    await expect.poll(() => last.evaluate(e => { const r = e.getBoundingClientRect(); return Math.abs(r.top + r.height / 2 - 417); })).toBeLessThanOrEqual(1);
    await viewport.evaluate(e => { e.scrollTop = 0; });
    const first = viewport.locator('[data-index="0"] .annotated-pdf-page');
    await first.waitFor();
    await expect.poll(() => first.evaluate(e => e.getBoundingClientRect().top)).toBeGreaterThanOrEqual(-1);
  });
}
