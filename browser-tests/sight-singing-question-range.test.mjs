import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';
import { chromium, expect } from '@playwright/test';
import { musicXmlFixture } from './musicxml-fixture.mjs';
import { startStorageFixture } from './storage-fixture.mjs';

function pickupWithRepeat() {
  return Buffer.from(musicXmlFixture(5).toString()
    .replaceAll(/<measure number="1">[\s\S]*?<\/measure>/g, measure => measure
      .replace('number="1"', 'number="0" implicit="yes"').replace('<duration>4</duration><type>whole</type>', '<duration>1</duration><type>quarter</type>'))
    .replaceAll('<measure number="2">', '<measure number="2"><barline location="left"><repeat direction="forward"/></barline>')
    .replaceAll(/<measure number="3">[\s\S]*?<\/measure>/g, measure =>
      measure.replace('</measure>', '<barline location="right"><repeat direction="backward"/></barline></measure>')));
}

test('choosing a sight-singing range follows the loaded score and saves only committed visits', { timeout: 120_000 }, async t => {
  const fixture = await startStorageFixture({ authenticated: true, previewEntry: false });
  t.after(() => fixture.stop());
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 390, height: 844 }, hasTouch: true, serviceWorkers: 'block' });
  const { choirId, scoreId, origin, accounts: [account] } = fixture;
  const login = await context.request.post(origin + '/api/auth/sign-in/email', {
    headers: { origin }, data: { email: account.email, password: account.password },
  });
  assert.equal(login.status(), 200);
  const attachment = crypto.randomUUID(), score = musicXmlFixture(24);
  const upload = await context.request.post(`${origin}/api/choirs/${choirId}/scores/${scoreId}/attachments/${attachment}/file?name=range.xml&size=${score.length}`,
    { data: score, headers: { 'content-length': String(score.length) } });
  assert.equal(upload.status(), 201);
  await context.addInitScript(() => {
    const NativeAudioContext = window.AudioContext;
    window.audioContexts = 0;
    window.AudioContext = class extends NativeAudioContext {
      constructor(...args) { super(...args); window.audioContexts++; }
    };
  });

  const page = await context.newPage(), fileReads = [];
  page.on('request', request => {
    if (request.method() === 'GET' && new URL(request.url()).pathname.endsWith(`/attachments/${attachment}/file`)) fileReads.push(request.url());
  });
  await page.goto(`${origin}/choirs/${choirId}`);
  await page.getByRole('button', { name: '我的', exact: true }).click();
  await page.getByRole('menuitem', { name: '视唱挑战', exact: true }).click();
  const create = () => page.getByRole('button', { name: '新建题目', exact: true }).click();
  const editor = page.getByRole('region', { name: '小节范围', exact: true });
  const notation = editor.locator('.challenge-range-notation');
  const marks = notation.locator('.challenge-range-highlight');
  const active = notation.locator('[data-active]');
  const from = editor.getByRole('slider', { name: /^起始小节/ });
  const to = editor.getByRole('slider', { name: /^结束小节/ });
  const firstSelect = editor.locator('select[name="first"]'), lastSelect = editor.locator('select[name="last"]');
  const capture = async filename => {
    if (process.env.SIGHT_RANGE_EVIDENCE) await page.screenshot({ path: join(process.env.SIGHT_RANGE_EVIDENCE, filename) });
  };
  await create();
  await expect(editor).toHaveCount(0);
  assert.equal(fileReads.length, 0);
  await page.locator('select[name="score"]').selectOption(scoreId);
  await expect(marks).toHaveCount(24);
  await expect(notation.locator('.at-surface svg').first()).toBeVisible();
  await expect(firstSelect).toHaveValue('0');
  await expect(lastSelect).toHaveValue('23');
  await capture('after.png');

  await page.setViewportSize({ width: 390, height: 585 });
  const rail = editor.locator('.practice-range-track');
  const moveEnd = async fraction => {
    await rail.scrollIntoViewIfNeeded();
    const track = await rail.boundingBox(), handle = await rail.locator('.practice-range-thumb').last().boundingBox();
    assert.ok(track && handle);
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(track.x + track.width * fraction, handle.y + handle.height / 2, { steps: 8 });
  };
  await moveEnd(.7);
  await expect(to).not.toHaveValue('23');
  await expect(lastSelect).toHaveValue('23');
  await expect.poll(async () => (await notation.boundingBox()).y).toBeGreaterThan(0);
  await expect.poll(async () => {
    const bar = await active.boundingBox(), view = await notation.boundingBox();
    return Boolean(bar && view && bar.y >= view.y && bar.y + bar.height <= view.y + view.height);
  }).toBe(true);
  await capture('drag.png');
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(to).toHaveValue('23');
  await expect(marks).toHaveCount(24);

  // Touch drags use the same controls and leave the committed range alone until release.
  const touch = await context.newCDPSession(page);
  const track = await rail.boundingBox(), handle = await rail.locator('.practice-range-thumb').last().boundingBox();
  assert.ok(track && handle);
  const y = handle.y + handle.height / 2;
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: handle.x + handle.width / 2, y }] });
  for (const fraction of [.9, .75, .6]) {
    await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: track.x + track.width * fraction, y }] });
  }
  await expect(to).not.toHaveValue('23');
  await expect(lastSelect).toHaveValue('23');
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(lastSelect).toHaveValue(await to.inputValue());
  assert.equal(fileReads.length, 1, 'range changes reuse the current source bytes');

  await from.press('ArrowRight');
  await expect(firstSelect).toHaveValue('1');
  await lastSelect.selectOption('1');
  await expect(marks).toHaveCount(1);
  await expect(active).toHaveAttribute('data-bar', '1');
  assert.equal(await page.evaluate(() => window.audioContexts), 0);
  const saved = page.waitForResponse(response => response.request().method() === 'PUT' && response.url().includes('/sight-singing/questions/'));
  await page.getByRole('button', { name: '发布到云盘', exact: true }).click();
  const response = await saved;
  assert.equal(response.status(), 200);
  const { question } = await response.json();
  assert.deepEqual([question.first, question.last], [1, 1]);
  await expect(page.getByRole('button', { name: '开始唱', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '返回题目列表', exact: true }).click();

  await create();
  await page.locator('select[name="source"]').selectOption('upload');
  await page.locator('input[name="upload"]').setInputFiles({ name: 'repeat.musicxml', mimeType: 'application/vnd.recordare.musicxml+xml', buffer: pickupWithRepeat() });
  await expect(firstSelect).toHaveValue('0');
  await expect(lastSelect).toHaveValue('6');
  await expect(from).toHaveAttribute('aria-valuetext', /0/);
  await firstSelect.selectOption('3');
  await lastSelect.selectOption('3');
  await expect(from).toHaveAttribute('aria-valuetext', /第 2 次/);
  await expect(marks).toHaveCount(1);
  await expect(active).toHaveAttribute('data-bar', '1');
});
