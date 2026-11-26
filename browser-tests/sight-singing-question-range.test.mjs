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
  const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  t.after(() => browser.close());
  const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 390, height: 844 }, hasTouch: true, serviceWorkers: 'block', permissions: ['microphone'] });
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
  await page.getByRole('button', { name: '我的', exact: true }).click();
  await page.getByRole('menuitem', { name: '视唱挑战', exact: true }).click();
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
  await expect(from).not.toHaveValue('22');
  const draftStart = Number(await from.inputValue());
  await expect(active).toHaveAttribute('data-bar', String(draftStart));
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
  const result = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/results'));
  await page.getByRole('button', { name: '开始唱', exact: true }).click();
  const resultResponse = await result;
  assert.equal(resultResponse.status(), 200);
  assert.equal(resultResponse.request().postDataJSON().score, 100);
  assert.deepEqual(await page.evaluate(() => window.durationFrames), [36000]);
  await page.getByRole('button', { name: '查看谱面', exact: true }).click();
  await expect(page.getByRole('button', { name: '回听演唱与钢琴答案', exact: true })).toBeEnabled();
  await expect.poll(() => page.locator('audio').evaluate(audio => audio.duration)).toBe(.75);
  await page.getByRole('button', { name: '编辑题目', exact: true }).click();
  await expect(summary).toContainText('含第 1 拍');
  await expect(advanced).not.toHaveAttribute('open');
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
