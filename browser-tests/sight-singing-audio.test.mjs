import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { chromium, expect } from '@playwright/test';
import { practiceMusicXml, practiceWave } from '../visual-report/practice-fixture.mjs';
import { startStorageFixture } from './storage-fixture.mjs';

test('sight singing starts after a microphone-side audio suspension and mixes the replay channels independently', { timeout: 60_000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'sight-singing-audio-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const tone = join(directory, 'microphone.wav');
  await writeFile(tone, practiceWave());
  const fixture = await startStorageFixture({ authenticated: true, previewEntry: false });
  let browser;
  t.after(async () => { try { await browser?.close(); } finally { await fixture.stop(); } });
  browser = await chromium.launch({
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${tone}`],
  });
  const context = await browser.newContext({ locale: 'zh-CN', serviceWorkers: 'block' });
  await context.addInitScript(() => {
    // Model an output route restart during microphone acquisition with a real AudioContext.
    const resume = AudioContext.prototype.resume;
    let output;
    AudioContext.prototype.resume = function () {
      const ready = resume.call(this);
      output = { context: this, ready };
      return ready;
    };
    const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async constraints => {
      const initialOutput = output;
      const stream = await getUserMedia(constraints);
      await initialOutput.ready;
      await initialOutput.context.suspend();
      return stream;
    };
  });
  const { origin, choirId } = fixture;
  const { id, email, password } = fixture.accounts[0];
  assert.equal((await context.request.post(`${origin}/api/auth/sign-in/email`, {
    headers: { origin }, data: { email, password },
  })).status(), 200);
  const title = '视唱混音谱例';
  const question = await context.request.put(`${origin}/api/choirs/${choirId}/sight-singing/questions/${crypto.randomUUID()}`, {
    headers: { 'x-same-page-owner-user-id': id },
    multipart: {
      fields: JSON.stringify({ title, first: 0, last: 0, expectedVersion: null }),
      file: { name: 'practice.musicxml', mimeType: 'application/vnd.recordare.musicxml+xml', buffer: Buffer.from(practiceMusicXml) },
    },
  });
  assert.equal(question.status(), 200, await question.text());
  const page = await context.newPage();
  await page.goto(`${origin}/choirs/${choirId}`);
  await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '工具', exact: true }).click();
  await page.getByRole('link', { name: '视唱练习', exact: true }).click();
  const openQuestion = page.getByRole('button', { name: new RegExp(title) });
  await openQuestion.click();
  const button = name => page.getByRole('button', { name, exact: true });
  const settings = page.getByRole('dialog', { name: '练习设置' });
  const openMixer = async () => {
    await button('练习设置').click();
    await settings.getByRole('button', { name: '混音台', exact: true }).click();
  };
  const voice = settings.getByRole('slider', { name: '回放人声音量' });
  const piano = settings.getByRole('slider', { name: '正确解答钢琴音量' });
  const run = page.locator('.challenge-run');
  await button('开始唱').click();
  await expect(run).toHaveAttribute('data-phase', 'count', { timeout: 8_000 });
  await expect(run).toHaveAttribute('data-phase', 'result', { timeout: 10_000 });

  const audio = run.locator('audio');
  const peak = () => audio.evaluate(async player => {
    const wav = new DataView(await (await fetch(player.src)).arrayBuffer());
    let maximum = 0;
    for (let offset = 44; offset < wav.byteLength; offset += 2) maximum = Math.max(maximum, Math.abs(wav.getInt16(offset, true)));
    return maximum;
  });
  await expect(button('回听')).toBeEnabled();
  await openMixer();
  await expect(piano).toHaveValue('1');
  await piano.fill('0');
  await button('关闭').click();
  assert.ok(await peak() > 0, 'the microphone recording stays audible with the piano muted');
  await openMixer();
  await voice.fill('0');
  await button('关闭').click();
  assert.equal(await peak(), 0, 'muting both replay channels renders silence');
  await openMixer();
  await piano.fill('0.5');
  await button('关闭').click();
  assert.ok(await peak() > 0, 'the piano stays audible with the microphone recording muted');

  await button('返回题目列表').click();
  await page.reload();
  await openQuestion.click();
  await openMixer();
  await expect(piano).toHaveValue('0.5');
  await expect(voice).toHaveValue('0');
});
