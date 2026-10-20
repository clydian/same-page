import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { before, after, test } from 'node:test';
import { chromium, webkit, expect } from '@playwright/test';
import { startVisualServer } from './setup.mjs';
import { resolveFixtureRequest } from './fixtures.mjs';
let app;
before(async () => { app = await startVisualServer({script: 'dev'}); });
after(async () => { await app?.stop(); });
const engines = process.env.READER_TEST_CHROMIUM_ONLY ? {chromium} : {chromium, webkit};
for (const [name, engine] of Object.entries(engines)) test(`${name}: edits both visible pages without changing viewport and retains ownership through boundary, undo, text, drag and failed saves`, {timeout: 90000}, async t => {
  const browser = await engine.launch({headless: true, ...(name === 'chromium' && process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? {executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH} : {})});
  t.after(() => browser.close());
  const page = await browser.newPage({viewport: {width: 834, height: 700}, deviceScaleFactor: 2, hasTouch: true, serviceWorkers: 'block', reducedMotion: 'reduce'});
  await page.route('**/api/**', route => route.fulfill(resolveFixtureRequest({pathname: new URL(route.request().url()).pathname, method: route.request().method(), identity: 'guest', scenarioId: 'reader-controls-narrow', cookie: route.request().headers().cookie ?? ''})));
  await page.addInitScript(() => localStorage.setItem('reader-gesture-hint-seen', 'true'));
  await page.goto(`${app.origin}/choirs/visual-choir/scores/visual-score?experience=1`);
  await page.locator('[data-page-turn-current] [data-pdf-canvas-active]').waitFor();
  await page.locator('.page-reader__viewport').click({position: {x: 417, y: 350}});
  await page.getByRole('button', {name: '更多', exact: true}).click();
  await page.getByRole('button', {name: '连续滚动', exact: true}).click();
  const reader = page.locator('.continuous-reader');
  await reader.locator('[data-pdf-canvas-active]').first().waitFor();
  await reader.evaluate(el => { el.scrollTop = 700; });
  await expect.poll(() => reader.evaluate(el => el.scrollTop)).toBe(700);
  await page.getByRole('button', {name: '编辑', exact: true}).click();
  const a = page.getByLabel('第 1 页笔记层', {exact: true}), b = page.getByLabel('第 2 页笔记层', {exact: true});
  await expect(a.locator('..')).toHaveAttribute('data-editing');
  await expect(b.locator('..')).toHaveAttribute('data-editing');
  await page.getByRole('button', {name: '画笔', exact: true}).click();
  const first = await a.boundingBox(), second = await b.boundingBox();
  const bottom = first.y + first.height;
  assert.ok(bottom > 180 && second.y < 550, 'both page fragments remain visible');
  const records = () => page.evaluate(async () => (await import('/src/client/platform/local-database.ts')).localDatabase.annotations.filter(n => !n.deleted).toArray());
  const inks = async () => (await records()).filter(n => n.payload?.kind === 'ink');
  const stroke = async (y, x = 220) => { await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 100, y + 5, {steps: 10}); await page.mouse.up(); };
  await stroke(bottom - 100); await expect.poll(async () => (await inks()).length).toBe(1);
  await stroke(second.y + 90); await expect.poll(async () => (await inks()).length).toBe(2);
  assert.deepEqual((await inks()).map(n => n.payload.pageNumber).sort(), [1, 2]);
  assert.equal(await reader.evaluate(el => el.scrollTop), 700);
  const before = (await inks()).map(n => n.id);
  await page.mouse.move(450, bottom - 15); await page.mouse.down();
  await page.mouse.move(450, second.y + 50, {steps: 6}); await page.mouse.move(600, bottom - 30, {steps: 6}); await page.mouse.up();
  await expect.poll(async () => (await inks()).length).toBe(3);
  const boundary = (await inks()).find(n => !before.includes(n.id));
  await expect.poll(async () => (await inks()).find(n => n.id === boundary.id).payload.points.at(-1).y).toBe(1);
  assert.equal(boundary.payload.pageNumber, 1);
  assert.ok((await inks()).find(n => n.id === boundary.id).payload.points.every(p => p.x <= 450 / first.width + .001));
  await page.getByRole('button', {name: '撤销', exact: true}).click(); await expect.poll(async () => (await inks()).length).toBe(2);
  assert.deepEqual((await inks()).map(n => n.payload.pageNumber).sort(), [1, 2]);
  await page.getByRole('button', {name: '重做', exact: true}).click(); await expect.poll(async () => (await inks()).length).toBe(3);

  await page.getByRole('button', {name: '文字', exact: true}).click();
  for (const [y, text] of [[bottom - 130, '第一页文字'], [second.y + 90, '第二页文字']]) {
    await page.mouse.click(180, y);
    await page.getByRole('textbox', {name: '笔记文本'}).fill(text);
    await page.getByRole('button', {name: '完成文字输入', exact: true}).click();
    await expect(page.getByRole('textbox', {name: '笔记文本'})).toHaveCount(0);
  }
  const textNotes = (await records()).filter(n => /^[第一二]+页文字$/.test(n.payload?.text ?? ''));
  assert.deepEqual(textNotes.map(n => [n.payload.text, n.payload.pageNumber]).sort(), [['第一页文字', 1], ['第二页文字', 2]]);
  const object = page.getByRole('button', {name: '第二页文字', exact: true});
  const objectBox = await object.boundingBox();
  await page.mouse.move(objectBox.x + objectBox.width / 2, objectBox.y + objectBox.height / 2); await page.mouse.down();
  await page.mouse.move(180, bottom - 60, {steps: 10}); await page.mouse.up();
  await expect.poll(async () => (await records()).find(n => n.id === textNotes.find(n => n.payload.pageNumber === 2).id).payload.y).toBe(0);
  assert.equal((await records()).find(n => n.payload?.text === '第二页文字').payload.pageNumber, 2);
  assert.equal((await records()).find(n => n.payload?.text === '第一页文字').payload.pageNumber, 1);

  await page.getByRole('button', {name: '画笔', exact: true}).click();
  await page.evaluate(async () => {
    const {localDatabase} = await import('/src/client/platform/local-database.ts');
    window.rejectPageWrite = () => { throw new DOMException('synthetic quota', 'QuotaExceededError'); };
    localDatabase.annotations.hook('creating', window.rejectPageWrite);
  });
  await stroke(bottom - 80, 530);
  await page.getByRole('button', {name: '重试本机保存', exact: true}).waitFor();
  await stroke(second.y + 150, 530); // Rejected handoff must not redirect a failed draft.
  await page.evaluate(async () => { const {localDatabase} = await import('/src/client/platform/local-database.ts'); localDatabase.annotations.hook('creating').unsubscribe(window.rejectPageWrite); });
  await page.getByRole('button', {name: '重试本机保存', exact: true}).click();
  await expect.poll(async () => (await inks()).length).toBe(4);
  assert.equal((await inks()).filter(n => n.payload.pageNumber === 2).length, 1);
  const beforeBrowse = await reader.evaluate(el => el.scrollTop);
  const inkCount = (await inks()).length;
  // Real DOM pointer paths on both sides of the seam exercise shared admission.
  await page.evaluate(({bottom, secondY}) => {
    const a = document.querySelector('[aria-label="第 1 页笔记层"]'), b = document.querySelector('[aria-label="第 2 页笔记层"]');
    const send = (target, type, pointerId, x, y) => target.dispatchEvent(new PointerEvent(type, {bubbles: true, cancelable: true, pointerType: 'touch', pointerId, clientX: x, clientY: y}));
    send(a, 'pointerdown', 101, 300, bottom - 50); send(b, 'pointerdown', 102, 400, secondY + 50);
    send(a, 'pointermove', 101, 300, bottom - 170); send(b, 'pointermove', 102, 400, secondY - 70);
    send(a, 'pointerup', 101, 300, bottom - 170); send(b, 'pointerup', 102, 400, secondY - 70);
  }, {bottom, secondY: second.y});
  await expect.poll(() => reader.evaluate(el => el.scrollTop)).toBeGreaterThan(beforeBrowse + 50);
  await expect.poll(async () => (await inks()).length).toBe(inkCount);
  await expect(page.getByRole('button', {name: '完成编辑', exact: true})).toBeVisible();
  const directory = 'artifacts/verification/continuous-page-editing'; await mkdir(directory, {recursive: true});
  await page.screenshot({path: `${directory}/${name}.png`});
  await writeFile(`${directory}/${name}.json`, JSON.stringify({beforeBrowse, afterBrowse: await reader.evaluate(el => el.scrollTop), pages: (await inks()).map(n => n.payload.pageNumber)}, null, 2));
});
