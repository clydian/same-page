import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';
import { chromium, expect } from '@playwright/test';
import { musicXmlFixture, sightSingingContextFixture } from './musicxml-fixture.mjs';
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
  const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  t.after(() => browser.close());
  const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 390, height: 844 }, hasTouch: true, serviceWorkers: 'block', permissions: ['microphone'] });
  const { choirId, scoreId, origin, accounts: [account] } = fixture;
  const login = await context.request.post(origin + '/api/auth/sign-in/email', {
    headers: { origin }, data: { email: account.email, password: account.password },
  });
  assert.equal(login.status(), 200);
  const attachment = crypto.randomUUID(), score = sightSingingContextFixture();
  const upload = await context.request.post(`${origin}/api/choirs/${choirId}/scores/${scoreId}/attachments/${attachment}/file?name=range.xml&size=${score.length}`,
    { data: score, headers: { 'content-length': String(score.length) } });
  assert.equal(upload.status(), 201);
  await context.addInitScript(() => {
    const NativeAudioContext = window.AudioContext, NativeWorklet = window.AudioWorkletNode;
    window.audioContexts = 0;
    window.durationFrames = [];
    window.AudioWorkletNode = class extends NativeWorklet {
      constructor(context, name, options) {
        super(context, name, options);
        if (name === 'sight-singing-capture') window.durationFrames.push(options.processorOptions.durationFrames);
      }
    };
    window.AudioContext = class extends NativeAudioContext {
      constructor() { super({ sampleRate: 48000 }); window.audioContexts++; }
      createMediaStreamSource() {
        const tone = this.createOscillator(), gain = this.createGain();
        tone.frequency.value = 329.6275569; // E4 in the synthetic Soprano staff.
        gain.gain.value = .2;
        tone.connect(gain);
        tone.start();
        return gain;
      }
    };
  });

  const page = await context.newPage(), fileReads = [];
  page.on('request', request => {
    if (request.method() === 'GET' && new URL(request.url()).pathname.endsWith(`/attachments/${attachment}/file`)) fileReads.push(request.url());
  });
  await page.goto(`${origin}/choirs/${choirId}`);
  await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '工具', exact: true }).click();
  await page.getByRole('link', { name: '视唱练习', exact: true }).click();
  const create = () => page.getByRole('button', { name: '新建题目', exact: true }).click();
  const editor = page.getByRole('region', { name: '小节范围', exact: true });
  const notation = editor.locator('.challenge-range-notation');
  const marks = notation.locator('.challenge-range-highlight');
  const active = notation.locator('[data-active]');
  const from = editor.getByRole('slider', { name: /^起始小节/ });
  const to = editor.getByRole('slider', { name: /^结束小节/ });
  const advanced = editor.locator('details'), previousMeasure = advanced.getByRole('button', { name: '前一小节', exact: true });
  const nextMeasure = advanced.getByRole('button', { name: '后一小节', exact: true });
  const previousBeat = advanced.getByRole('button', { name: '前一拍', exact: true });
  const startEndpoint = advanced.getByRole('button', { name: '起点 A', exact: true });
  const endEndpoint = advanced.getByRole('button', { name: '终点 B', exact: true });
  const summary = editor.locator('.challenge-range-summary');
  const title = page.getByRole('textbox', { name: '题目名称', exact: true });
  const capture = async filename => {
    if (process.env.SIGHT_RANGE_EVIDENCE) await page.screenshot({ path: join(process.env.SIGHT_RANGE_EVIDENCE, filename) });
  };
  await create();
  await expect(editor).toHaveCount(0);
  assert.equal(fileReads.length, 0);
  await page.locator('select[name="score"]').selectOption(scoreId);
  await expect(marks).toHaveCount(24);
  await expect(notation.locator('.at-surface svg').first()).toBeVisible();
  await expect(from).toHaveValue('0');
  await expect(to).toHaveValue('23');
  await expect(advanced).not.toHaveAttribute('open');
  await expect(editor.locator('select')).toHaveCount(0);
  await expect(title).toHaveValue(/ 全曲$/);

  await page.setViewportSize({ width: 390, height: 585 });
  const rail = editor.locator('.practice-range-track');
  await from.press('End');
  await from.press('ArrowLeft');
  await expect(from).toHaveValue('22');
  await expect(active).toHaveAttribute('data-bar', '22');
  await to.focus();
  await rail.scrollIntoViewIfNeeded();
  const track = await rail.boundingBox(), start = await rail.locator('.practice-range-thumb').first().boundingBox();
  assert.ok(track && start);
  const y = start.y + start.height / 2, x = start.x + start.width / 2;
  assert.equal(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-loop-endpoint]')?.getAttribute('data-loop-endpoint'), { x, y }), '0');
  const touch = await context.newCDPSession(page);
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await expect(from).toBeFocused();
  await expect(active).toHaveAttribute('data-bar', '22');
  for (const ratio of [.8, .7, .6]) {
    await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: track.x + track.width * ratio, y }] });
    await expect(to).toHaveValue('23');
  }
  await expect.poll(() => editor.evaluate(section => {
    const a = section.querySelector('[data-loop-endpoint="0"] input').value;
    return Number(a) < 22 && section.querySelector('[data-active]')?.getAttribute('data-bar') === a;
  })).toBe(true);
  await expect.poll(async () => {
    const bar = await active.boundingBox(), view = await notation.boundingBox();
    return Boolean(bar && view && bar.y >= view.y && bar.y + bar.height <= view.y + view.height);
  }).toBe(true);
  await capture('drag-start.png');
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(from).toBeFocused();
  await expect(to).toHaveValue('23');
  const moved = Number(await from.inputValue());
  assert.ok(moved < 22);
  await expect(active).toHaveAttribute('data-bar', String(moved));

  // A cancelled B edit restores the committed selection and never takes A with it.
  const end = await rail.locator('.practice-range-thumb').last().boundingBox();
  assert.ok(end);
  await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2);
  await page.mouse.down();
  await page.mouse.move(track.x + track.width * .78, end.y + end.height / 2, { steps: 8 });
  await expect(to).not.toHaveValue('23');
  await expect(from).toHaveValue(String(moved));
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(to).toHaveValue('23');
  await expect(to).toBeFocused();
  await expect(active).toHaveAttribute('data-bar', '23');

  await from.press('ArrowRight');
  await expect(active).toHaveAttribute('data-bar', String(moved + 1));
  await advanced.locator('summary').click();
  await expect(startEndpoint).toHaveAttribute('aria-pressed', 'true');
  await previousMeasure.click();
  await expect(from).toHaveValue(String(moved));
  await nextMeasure.click();
  await expect(from).toHaveValue(String(moved + 1));
  await to.press('Home');
  await expect(endEndpoint).toHaveAttribute('aria-pressed', 'true');
  await expect(to).toHaveValue(String(moved + 1));
  const wholeWidth = (await active.boundingBox()).width;
  for (let step = 0; step < 3; step++) await previousBeat.click();
  await expect(previousBeat).toBeDisabled();
  await expect(summary).toContainText('含第 1 拍');
  const measureLabel = `第 ${moved + 2} 小节`;
  await expect(title).toHaveValue(new RegExp(` ${measureLabel}$`));
  assert.ok((await active.boundingBox()).width < wholeWidth / 2);
  assert.equal(fileReads.length, 1, 'range changes reuse the current source bytes');
  assert.equal(await page.evaluate(() => window.audioContexts), 0);
  await capture('through-beat-one.png');

  const saved = page.waitForResponse(response => response.request().method() === 'PUT' && response.url().includes('/sight-singing/questions/'));
  await page.getByRole('button', { name: '发布到云盘', exact: true }).click();
  const response = await saved;
  assert.equal(response.status(), 200);
  const { question } = await response.json();
  assert.deepEqual([question.first, question.last, question.lastBeat], [moved + 1, moved + 1, 1]);
  await expect(page.getByRole('button', { name: '开始唱', exact: true })).toBeVisible();
  await expect(page.locator('.task-header-heading > p')).toHaveText(`${measureLabel} · 我发布`);
  const result = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/results'));
  await page.getByRole('button', { name: '开始唱', exact: true }).click();
  await expect(page.locator('.challenge-run')).toHaveAttribute('data-phase', 'result', { timeout: 8000 });
  await expect(page.getByRole('button', { name: '回听', exact: true })).toBeEnabled();
  await expect.poll(() => page.locator('audio').evaluate(audio => audio.duration)).toBe(.75);
  await expect(page.locator('.challenge-pitch-labels span')).toHaveText(['0']);
  await page.getByRole('button', { name: '返回题目列表', exact: true }).click();
  const resultResponse = await result;
  assert.equal(resultResponse.status(), 200);
  assert.equal(resultResponse.request().postDataJSON().score, 100);
  assert.deepEqual(await page.evaluate(() => window.durationFrames), [69600]);
  await page.locator('.challenge-card-open').filter({ hasText: question.title }).click();
  await page.getByRole('button', { name: '编辑题目', exact: true }).click();
  await expect(summary).toContainText('含第 1 拍');
  await expect(advanced).not.toHaveAttribute('open');
  await page.getByRole('button', { name: '返回题目列表', exact: true }).click();
  await expect(page.locator('.challenge-card-open strong')).toHaveText(question.title);

  await page.setViewportSize({ width: 1040, height: 850 });
  await create();
  await page.locator('select[name="score"]').selectOption(scoreId);
  await from.press('ArrowRight');
  await to.press('Home');
  await to.press('ArrowRight');
  await advanced.locator('summary').click();
  await startEndpoint.click();
  await advanced.getByRole('button', { name: '后一拍', exact: true }).click();
  await endEndpoint.click();
  for (let step = 0; step < 3; step++) await previousBeat.click();
  await expect(title).toHaveValue(/ 2–3 小节$/);
  await page.getByRole('button', { name: '发布到云盘', exact: true }).click();
  await page.getByRole('button', { name: '练习设置', exact: true }).click();
  await page.getByRole('switch', { name: '音高轨迹', exact: true }).press('Space');
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  const contextResult = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/results'));
  const cursor = page.locator('.challenge-score-cursor');
  const firstTarget = page.locator('.challenge-notation-note[data-track="0"][data-bar="1"][data-beat-index="2"]');
  const excludedEnd = page.locator('.challenge-notation-note[data-track="0"][data-bar="2"][data-beat-index="2"]');
  const targetX = await firstTarget.evaluate(element => Number.parseFloat(element.style.left));
  const excludedX = await excludedEnd.evaluate(element => Number.parseFloat(element.style.left));
  await capture('practice-context.png');
  const startSinging = page.getByRole('button', { name: '开始唱', exact: true });
  const transport = page.locator('.challenge-transport');
  const stop = transport.getByRole('button', { name: '停止', exact: true });
  const status = transport.getByRole('status');
  await startSinging.click();
  await expect(status).toHaveText(/预备 · [1-4]/);
  await expect(stop).toHaveCount(0);
  const countRow = await transport.boundingBox();
  await expect(status).toHaveText('跟谱 · 暂不计分', { timeout: 8000 });
  await expect(status).toHaveClass('visually-hidden');
  await expect(transport.getByRole('button')).toHaveCount(1);
  const stopBox = await stop.boundingBox();
  assert.ok(countRow && stopBox && Math.abs(countRow.width - stopBox.width) <= 1);
  assert.ok(Math.abs(countRow.height - (await transport.boundingBox()).height) <= 1);
  assert.ok(await cursor.evaluate(element => Number.parseFloat(element.style.left)) < targetX);
  await expect(page.locator('.challenge-staff-trace')).toBeVisible();
  await capture('unscored-lead-in.png');
  const audio = page.locator('audio');
  await expect.poll(() => audio.evaluate(element => element.duration)).toBe(3.75);
  await page.getByRole('button', { name: '回听', exact: true }).click();
  await expect(cursor).toBeVisible();
  await audio.evaluate(element => { element.currentTime = element.duration - .02; });
  await expect.poll(() => audio.evaluate(element => element.ended)).toBe(true);
  assert.ok(await cursor.evaluate(element => Number.parseFloat(element.style.left)) < excludedX);
  await capture('scored-crop-replay.png');
  await firstTarget.press('Enter');
  await expect(page.locator('.challenge-note-detail')).toHaveText('E4音准偏差（音分） 0');
  await expect(page.locator('.challenge-run')).toHaveAttribute('data-replaying', 'true');
  await page.getByRole('button', { name: '再试一次', exact: true }).click();
  await expect(page.locator('.challenge-note-detail')).toHaveCount(0);
  const contextResponse = await contextResult;
  assert.equal(contextResponse.status(), 200);
  // The fixed E4 tone is wrong for the lead-in's two D4s, then matches all eight scored notes.
  assert.equal(contextResponse.request().postDataJSON().score, 100);
  assert.deepEqual(await page.evaluate(() => window.durationFrames), [69600, 213600]);
  await startSinging.click();
  await expect(status).toHaveText('跟谱 · 暂不计分', { timeout: 8000 });
  await stop.click();
  await expect(startSinging).toBeVisible();
  await expect(page.locator('.challenge-result')).toHaveCount(0);
  await page.getByRole('button', { name: '返回题目列表', exact: true }).click();

  await create();
  await page.locator('select[name="source"]').selectOption('upload');
  await page.locator('input[name="upload"]').setInputFiles({ name: 'repeat.musicxml', mimeType: 'application/vnd.recordare.musicxml+xml', buffer: pickupWithRepeat() });
  await expect(from).toHaveValue('0');
  await expect(to).toHaveValue('6');
  await expect(from).toHaveAttribute('aria-valuetext', /0/);
  await from.focus();
  await advanced.locator('summary').click();
  await expect(advanced.getByRole('button', { name: '后一拍', exact: true })).toBeDisabled();
  for (let measure = 0; measure < 3; measure++) await nextMeasure.click();
  await expect(from).toHaveAttribute('aria-valuetext', /第 2 次/);
  await expect(active).toHaveAttribute('data-bar', '1');
});
