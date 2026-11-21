import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { chromium, webkit } from "playwright";
import { startVisualServer } from "./setup.mjs";
import { createVisualFixtureSession } from "./fixtures.mjs";
let app;
before(async () => { app = await startVisualServer({ script: "dev" }); });
after(async () => { await app?.stop(); });
async function openReader(t, engine, legacy = false) {
  const browser = await engine.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({ locale: "zh-CN", viewport: { width: 1194, height: 900 } });
  page.setDefaultTimeout(15_000);
  const fixture = createVisualFixtureSession({ dense: true });
  await page.route("**/api/**", route => route.fulfill(fixture.resolve({ pathname: new URL(route.request().url()).pathname, method: route.request().method(), identity: "admin" })));
  await page.addInitScript(() => localStorage.setItem("reader-gesture-hint-seen", "true"));
  if (legacy) await page.addInitScript(() => {
    localStorage.setItem("note-tool-style:user:visual-user-admin:ink", JSON.stringify({ nib: "round", pressureMode: "uniform", strokeWidth: .012, opacity: 1, fontScale: .016, textAlign: "center" }));
  });
  await page.goto(`${app.origin}/choirs/visual-choir/scores/visual-score`);
  await page.locator(".annotated-pdf-page canvas:not([hidden])").first().waitFor();
  await page.locator(".annotated-pdf-page").first().click({ position: { x: 280, y: 300 } });
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.getByRole("button", { name: "画笔", exact: true }).click();
  return page;
}
async function pointer(page, type, x, y, pose = {}) {
  await page.locator(".annotation-overlay svg").first().evaluate((element, args) => {
    const b = element.getBoundingClientRect();
    element.dispatchEvent(new PointerEvent(args.type, { bubbles: true, cancelable: true, pointerId: 80, pointerType: "pen", button: 0, buttons: args.type === "pointerup" ? 0 : 1, pressure: .6, clientX: b.left + b.width * args.x, clientY: b.top + b.height * args.y, ...args.pose }));
  }, { type, x, y, pose });
}
for (const [name, engine] of Object.entries({ chromium, webkit })) {
  test(`${name}: selected tool closes on the second physical click, including icon target`, async t => {
    const page = await openReader(t, engine);
    const pen = page.getByRole("button", { name: "画笔", exact: true });
    for (let i = 0; i < 3; i++) {
      await pen.locator("svg").click();
      await page.getByRole("dialog", { name: "工具设置", exact: true }).waitFor();
      await pen.locator("svg").click();
      await page.getByRole("dialog", { name: "工具设置", exact: true }).waitFor({ state: "hidden" });
    }
    const settings = page.getByRole("button", { name: "工具设置", exact: true });
    await settings.click(); await settings.click();
    await page.getByRole("dialog", { name: "工具设置", exact: true }).waitFor({ state: "hidden" });
  });
  test(`${name}: legacy default upgrades once and explicit uniform survives reload`, async t => {
    const page = await openReader(t, engine, true);
    await page.getByRole("button", { name: "画笔", exact: true }).click();
    assert.equal(await page.getByRole("button", { name: "压感", exact: true }).getAttribute("aria-pressed"), "true");
    await page.getByRole("button", { name: "等宽", exact: true }).click();
    // The init script restores only the legacy data; the new choice marker must
    // survive and therefore preserve the explicit uniform selection.
    await page.reload();
    await page.locator(".annotated-pdf-page canvas:not([hidden])").first().waitFor();
    await page.locator(".annotated-pdf-page").first().click({ position: { x: 280, y: 300 } });
    await page.getByRole("button", { name: "编辑", exact: true }).click();
    const pen = page.getByRole("button", { name: "画笔", exact: true });
    if (await pen.getAttribute("aria-pressed") !== "true") await pen.click();
    await pen.click();
    assert.equal(await page.getByRole("button", { name: "等宽", exact: true }).getAttribute("aria-pressed"), "true");
    const styles = await page.evaluate(() => JSON.parse(localStorage.getItem("note-tool-style:user:visual-user-admin:ink")));
    assert.equal(styles.strokeWidth, .012);
  });
  test(`${name}: native callout suppression stays on paper and preserves text inputs`, async t => {
    const page = await openReader(t, engine);
    const result = await page.evaluate(() => {
      const paper = document.querySelector(".annotated-pdf-page");
      const svg = paper.querySelector("svg");
      const input = document.createElement("textarea"); input.value = "select me"; paper.append(input);
      const dispatch = target => { const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true }); target.dispatchEvent(event); return event.defaultPrevented; };
      const result = { paper: dispatch(svg), input: dispatch(input), outside: dispatch(document.querySelector(".annotation-controls")), paperSelect: getComputedStyle(paper).userSelect, inputSelect: getComputedStyle(input).userSelect };
      input.select(); result.selection = input.selectionEnd - input.selectionStart;
      input.remove(); return result;
    });
    assert.deepEqual(result, { paper: true, input: false, outside: false, paperSelect: "none", inputSelect: "text", selection: 9 });
    await pointer(page, "pointerdown", .2, .2); await pointer(page, "pointermove", .3, .3); await pointer(page, "pointerup", .3, .3);
    await page.waitForFunction(() => document.querySelector('button[aria-label="撤销"]')?.disabled === false);
  });
  test(`${name}: same trajectory retains hooks and intentional corners from measured batches`, async t => {
    const page = await openReader(t, engine);
    const traces = [
      { name: "Short hook", points: [[.18,.20],[.22,.20],[.26,.20],[.28,.18],[.27,.15],[.25,.16],[.26,.20],[.30,.20],[.34,.20]] },
      { name: "Sharp turn", points: [[.18,.35],[.22,.35],[.26,.35],[.28,.31],[.28,.27],[.28,.23],[.28,.27],[.28,.31],[.28,.35]] },
      { name: "Small lettering", points: [[.18,.48],[.20,.46],[.22,.48],[.24,.46],[.26,.48],[.28,.46],[.30,.48],[.32,.46],[.34,.48]] },
    ];
    const comparisons = [];
    for (const trace of traces) {
      const paths = [];
      for (const coalesced of [false, true]) {
        await page.locator(".annotation-overlay svg").first().evaluate((svg, { points, coalesced }) => {
          const b = svg.getBoundingClientRect();
          const event = (type, [x,y]) => new PointerEvent(type, { bubbles:true, cancelable:true, pointerId:80, pointerType:"pen", buttons:type === "pointerup" ? 0 : 1, pressure:.5, clientX:b.left+x*b.width, clientY:b.top+y*b.height });
          svg.dispatchEvent(event("pointerdown", points[0]));
          for (let i=4; i<points.length; i+=4) {
            const move = event("pointermove", points[i]);
            if (coalesced) Object.defineProperty(move, "getCoalescedEvents", { value: () => points.slice(i-3,i+1).map(p => event("pointermove",p)) });
            svg.dispatchEvent(move);
          }
        }, { points: trace.points, coalesced });
        const draft = page.locator("[data-ink-draft]");
        await draft.waitFor();
        // Wait for the requestAnimationFrame publishing the complete batch.
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const live = await draft.getAttribute("d");
        await page.evaluate(d => {
          window.releaseFrames = [];
          const frame = () => {
            window.releaseFrames.push([...document.querySelectorAll("[data-ink-draft], [data-ink-stroke]")].some(path => path.getAttribute("d") === d));
            if (window.releaseFrames.length < 6) requestAnimationFrame(frame);
          };
          requestAnimationFrame(frame);
        }, live);
        await pointer(page, "pointerup", ...trace.points.at(-1), { pressure: 0 });
        await page.waitForFunction(d => [...document.querySelectorAll("[data-ink-stroke]")].some(path => path.getAttribute("d") === d), live);
        await page.waitForFunction(() => window.releaseFrames.length === 6);
        assert.deepEqual(await page.evaluate(() => window.releaseFrames), Array(6).fill(true), "release must retain the final outline on each observed animation frame");
        paths.push(live);
      }
      assert.notEqual(paths[0], paths[1], `${trace.name}: intermediate measured input must affect the outline`);
      comparisons.push({ name: trace.name, paths });
    }
    if (name === "chromium" && process.env.PEN_EVIDENCE_PATH) {
      const proof = await page.context().browser().newPage();
      await proof.setViewportSize({width:1000,height:750});
      const rows = comparisons.map(({name,paths}, index) => `<section><h2>${name}</h2>${paths.map((d,i) => `<svg viewBox="140 ${[110,200,410][index]} 250 ${[130,190,140][index]}"><path d="${d}" fill="#173c3c"/></svg>`).join("")}</section>`).join("");
      await proof.setContent(`<style>body{font:18px system-ui;margin:36px;background:#f7f7f1;color:#173c3c}h1{font-size:27px}p{color:#536762}.labels,section{display:grid;grid-template-columns:200px 1fr 1fr;gap:20px}section{height:145px;align-items:center;border-top:1px solid #ccd4cb}h2{font-size:18px}svg{width:100%;height:140px;background:white;border-radius:12px}</style><h1>Measured samples preserve the intended path</h1><p>Synthetic PointerEvents · same trajectory / width / pressure · unchanged smoothing</p><div class="labels"><span></span><b>Before: delivered endpoints</b><b>After: measured batches</b></div>${rows}<p>Live outline equals saved outline after release in both cases.<br>Cloud Chromium simulation. No Apple Pencil or iPad device claim.</p>`);
      await proof.screenshot({path:process.env.PEN_EVIDENCE_PATH});
    }
  });
  test(`${name}: crossing pen ink remains painted in live and saved SVG`, async t => {
    const page = await openReader(t, engine);
    await pointer(page, "pointerdown", .2, .2);
    const initialPath = await page.locator("[data-ink-draft]").getAttribute("d");
    await page.locator(".annotation-overlay svg").first().evaluate(element => {
      const b = element.getBoundingClientRect();
      for (const [x,y] of [[.8,.8],[.2,.8],[.8,.2]]) element.dispatchEvent(new PointerEvent("pointermove", {bubbles:true,pointerId:80,pointerType:"pen",buttons:1,pressure:.6,clientX:b.left+b.width*x,clientY:b.top+b.height*y}));
    });
    await page.waitForFunction(d => document.querySelector("[data-ink-draft]")?.getAttribute("d") !== d, initialPath);
    const livePath = await page.locator("[data-ink-draft]").getAttribute("d");
    const sample = async selector => page.locator(selector).last().evaluate(async element => {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1000"><rect width="1000" height="1000" fill="white"/>${element.outerHTML}</svg>`;
      const image = new Image(); image.src = `data:image/svg+xml,${encodeURIComponent(svg)}`; await image.decode();
      const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1000;
      const ctx = canvas.getContext("2d"); ctx.drawImage(image, 0, 0);
      // perfect-freehand streamlining moves the crossing slightly off (500,500).
      const pixels = ctx.getImageData(0, 0, 1000, 1000).data;
      image.src = `data:image/svg+xml,${encodeURIComponent(svg.replaceAll('fill-rule="evenodd"', 'fill-rule="nonzero"'))}`;
      await image.decode(); ctx.drawImage(image, 0, 0);
      const solid = ctx.getImageData(0, 0, 1000, 1000).data;
      return { missing: [...pixels].filter((value, i) => i % 4 === 1 && value - solid[i] > 80).length };
    });
    const live = await sample("[data-ink-draft]");
    assert.equal(live.missing, 0, "self-crossing pen outline has transparent holes");
    await pointer(page, "pointerup", .8, .2);
    await page.locator("[data-ink-draft]").waitFor({ state: "hidden" });
    await page.waitForFunction(d => [...document.querySelectorAll("[data-ink-stroke]")].some(path => path.getAttribute("d") === d), livePath);
    assert.deepEqual(await sample("[data-ink-stroke]"), live);
  });
  test(`${name}: Pencil-only taps change settings without compatibility clicks`, async t => {
    const page = await openReader(t, engine);
    await page.getByRole("button", { name: "工具设置", exact: true }).click();
    const pressure = page.getByRole("button", { name: "压感", exact: true });
    // Replay Pencil contact without a compatibility click (the affected device sequence).
    await pressure.evaluate(element => {
      const b = element.getBoundingClientRect();
      const init = { bubbles: true, cancelable: true, pointerId: 81, pointerType: "pen", button: 0, clientX: b.x+b.width/2, clientY: b.y+b.height/2 };
      element.dispatchEvent(new PointerEvent("pointerdown", {...init, buttons:1}));
      element.dispatchEvent(new PointerEvent("pointerup", {...init, buttons:0}));
    });
    await page.waitForFunction(() => document.querySelector('.annotation-pressure-options button:last-child')?.getAttribute('aria-pressed') === 'true', null, { timeout: 1000 });
    await page.keyboard.press("Escape");
  });
  test(`${name}: save checkpoints do not flash the toolbar`, async t => {
    const page = await openReader(t, engine);
    await page.locator(".annotation-controls").evaluate(element => {
      window.pencilToolbar = element;
      window.pencilToolbarChanges = [];
      // History availability legitimately changes after the first committed stroke.
      // Saving must not hide the toolbar or disable the drawing controls.
      window.pencilToolbarObserver = new MutationObserver(records => window.pencilToolbarChanges.push(...records
        .filter(r => r.attributeName === "hidden" || !r.target.closest(".annotation-history-controls"))
        .map(r => r.attributeName)));
      window.pencilToolbarObserver.observe(element, { attributes: true, subtree: true, attributeFilter: ["disabled", "data-disabled", "hidden"] });
    });
    await pointer(page, "pointerdown", .2, .3);
    for (let i=1; i<=8; i++) await pointer(page, "pointermove", .2+i*.05, .3);
    await pointer(page, "pointerup", .6, .3);
    await page.waitForFunction(() => document.querySelector('button[aria-label="撤销"]')?.disabled === false);
    assert.equal(await page.getByRole("button", { name: "重做", exact: true }).isDisabled(), true);
    assert.deepEqual(await page.evaluate(() => { window.pencilToolbarObserver.disconnect(); return {same:window.pencilToolbar===document.querySelector('.annotation-controls'), changes:window.pencilToolbarChanges}; }), {same:true,changes:[]});
  });
}
