import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { chromium, webkit } from 'playwright';
import { startVisualServer } from './setup.mjs';
import { resolveFixtureRequest } from './fixtures.mjs';
let server;
before(async () => { server = await startVisualServer({ script: 'dev' }); });
after(async () => { await server?.stop(); });

async function open(browser, { identity = 'admin', writable = true, personalWritable = true } = {}) {
  const context = await browser.newContext({ viewport: { width: 834, height: 800 }, locale: 'zh-CN', reducedMotion: 'reduce', serviceWorkers: 'block' });
  await context.route('**/api/**', async route => {
    const request = route.request();
    const response = resolveFixtureRequest({ pathname: new URL(request.url()).pathname, method: request.method(), identity, scenarioId: 'reader-controls-narrow', cookie: request.headers().cookie ?? '' });
    if ((!writable || !personalWritable) && request.method() === 'GET' && /\/(layers|sync)$/.test(new URL(request.url()).pathname)) {
      const data = JSON.parse(response.body);
      const collection = Array.isArray(data.layers) ? data : data.layers;
      if (collection?.layers) collection.layers = collection.layers.map(layer => ({ ...layer, canEdit: writable && layer.kind !== 'personal' && layer.canEdit }));
      response.body = JSON.stringify(data);
    }
    await route.fulfill(response);
  });
  await context.addInitScript(() => {
    localStorage.setItem('reader-gesture-hint-seen', 'true');
    localStorage.setItem('note-last-tool:user:visual-user-admin', 'eraser');
    localStorage.setItem('reader-edit-layer:' + JSON.stringify(['user:visual-user-admin', 'visual-choir', 'visual-score']), '00000000-0000-4000-8000-000000000001');
  });
  const page = await context.newPage();
  await page.goto(`${server.origin}/choirs/visual-choir/scores/visual-score`);
  await page.waitForFunction(() => document.querySelector('.page-reader__sheet[data-page-turn-current] [data-pdf-canvas-active]')?.width >= 100);
  return page;
}
const svgSelector = '.page-reader__sheet[data-page-turn-current] .annotation-overlay svg';
async function draw(page) {
  return page.locator(svgSelector).evaluate(svg => {
    const b = svg.getBoundingClientRect();
    const send = (type, dx) => svg.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerType: 'pen', pointerId: 41, button: 0, buttons: type === 'pointerup' ? 0 : 1, pressure: .6, clientX: b.left + b.width * .4 + dx, clientY: b.top + b.height * .45 + dx / 2 }));
    send('pointerdown', 0);
    const retained = svg.isConnected && svg.parentElement.dataset.editing === 'true';
    send('pointermove', 50); send('pointerup', 80);
    return { retained, x: .4, y: .45 };
  });
}
async function notes(page) {
  return page.evaluate(async () => {
    const { localDatabase } = await import('/src/client/platform/local-database.ts');
    return (await localDatabase.annotations.toArray()).filter(note => note.payload?.kind === 'ink');
  });
}
for (const [name, engine] of Object.entries({ chromium, webkit })) {
  test(`${name}: first pen contact enters the existing editor and saves in a personal layer`, async t => {
    const browser = await engine.launch(); t.after(() => browser.close());
    const page = await open(browser);
    await page.locator('.annotation-overlay[data-pencil-entry]').first().waitFor();
    // The persisted shared layer and eraser must both be overridden.
    const result = await draw(page);
    assert.equal(result.retained, true, 'the initial event must retain its SVG across entry');
    await page.locator('.annotation-controls').waitFor();
    assert.equal(await page.locator('.annotation-overlay[data-editing]').getAttribute('data-tool'), 'ink');
    await page.getByRole('button', { name: '完成编辑', exact: true }).click();
    let saved = await notes(page);
    assert.equal(saved.length, 1);
    assert.equal(saved[0].layerId, '00000000-0000-4000-8000-000000000006');
    assert.ok(Math.abs(saved[0].payload.points[0].x - result.x) < .001);
    assert.ok(Math.abs(saved[0].payload.points[0].y - result.y) < .001);
    assert.ok(saved[0].payload.points.at(-1).x > result.x + .05);
    await page.reload();
    await page.locator('.annotation-overlay[data-pencil-entry]').first().waitFor();
    assert.equal((await notes(page)).length, 1);
    if (process.env.PENCIL_ENTRY_SCREENSHOT) await page.screenshot({ path: `/tmp/pencil-entry-${name}-saved.png` });
  });
  test(`${name}: guest and non-writable reading cannot enter by pen`, async t => {
    const browser = await engine.launch(); t.after(() => browser.close());
    for (const access of [{ identity: 'guest' }, { writable: false }, { personalWritable: false }]) {
      const page = await open(browser, access);
      await draw(page);
      assert.equal(await page.locator('.annotation-overlay[data-editing]').count(), 0);
      assert.equal((await notes(page)).length, 0);
      await page.context().close();
    }
  });
}

test('chromium: native pen capture retains first contact; touch and mouse keep reading behavior', async t => {
  const browser = await chromium.launch(); t.after(() => browser.close());
  const page = await open(browser);
  await page.locator('.annotation-overlay[data-pencil-entry]').first().waitFor();
  const cdp = await page.context().newCDPSession(page);
  // A real touch swipe hits the same enabled SVG and must still turn the page.
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 650, y: 400 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 500, y: 400 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.locator('.page-reader__sheet[data-page-turn-current][data-page-number="2"]').waitFor();
  assert.equal(await page.locator('.annotation-overlay[data-editing]').count(), 0);
  await page.mouse.click(400, 400);
  await page.getByRole('button', { name: '编辑', exact: true }).waitFor({ state: 'visible' });
  assert.equal(await page.locator('.annotation-overlay[data-editing]').count(), 0);
  // Explicit entry converts only eraser to pen, then keeps a chosen text tool.
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await page.locator('.annotation-controls').waitFor();
  assert.equal(await page.locator('.annotation-overlay[data-editing]').getAttribute('data-tool'), 'ink');
  await page.getByRole('button', { name: '文字', exact: true }).click();
  await page.getByRole('button', { name: '完成编辑', exact: true }).click();
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  assert.equal(await page.locator('.annotation-overlay[data-editing]').getAttribute('data-tool'), 'text');
  await page.getByRole('button', { name: '完成编辑', exact: true }).click();
  const b = await page.locator(svgSelector).boundingBox();
  const x = b.x + b.width * .4, y = b.y + b.height * .4;
  await page.locator(svgSelector).evaluate(svg => { window.entrySvg = svg; svg.addEventListener('pointerdown', e => { window.entryPointer = e.pointerId; }); });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', pointerType: 'pen', button: 'left', buttons: 1, x, y, force: .6 });
  assert.equal(await page.evaluate(() => window.entrySvg.isConnected && window.entrySvg.hasPointerCapture(window.entryPointer)), true);
  await page.locator('.annotation-controls').waitFor();
  if (process.env.PENCIL_ENTRY_SCREENSHOT) await page.screenshot({ path: '/tmp/pencil-entry-chromium-contact.png' });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', pointerType: 'pen', button: 'left', buttons: 1, x: x + 70, y: y + 25, force: .7 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', pointerType: 'pen', button: 'left', buttons: 0, x: x + 90, y: y + 35, force: 0 });
  await page.getByRole('button', { name: '完成编辑', exact: true }).click();
  const saved = await notes(page);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].payload.pageNumber, 2);
  assert.ok(Math.abs(saved[0].payload.points[0].x - .4) < .001);
  if (process.env.PENCIL_ENTRY_SCREENSHOT) await page.screenshot({ path: '/tmp/pencil-entry-chromium-complete.png' });
});
