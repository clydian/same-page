import assert from 'node:assert/strict';
import test from 'node:test';
import { join } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { musicXmlFixture } from './musicxml-fixture.mjs';
import { calibrationTimes, calibrationTone } from '../src/client/sight-singing/recording-latency.ts';
import { startStorageFixture } from './storage-fixture.mjs';

test('sight singing preserves its layout preferences and clears a completed take on retry', { timeout: 90000 }, async t => {
  const fixture = await startStorageFixture({ authenticated: true, previewEntry: false });
  let browser;
  t.after(async () => { try { await browser?.close(); } finally { await fixture.stop(); } });
  browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 320, height: 650 }, serviceWorkers: 'block' });
  await context.addInitScript(() => {
    const Worklet = AudioWorkletNode;
    window.sightSingingCaptures = [];
    window.sightSingingCalibrations = [];
    window.AudioWorkletNode = class extends Worklet {
      constructor(audio, name, options) {
        super(audio, name, options);
        const { port1, port2 } = new MessageChannel();
        this.capturePort = port1;
        const frameSize = options.processorOptions.chunkFrames;
        if (options.processorOptions.beats === 0) {
          window.sightSingingCalibrations.push({ rate: audio.sampleRate, send: numbers => {
            const samples = Float32Array.from(numbers);
            port2.postMessage({ samples, done: true }, [samples.buffer]);
            port2.close();
          } });
          return;
        }
        const margin = -options.processorOptions.recordFrom;
        const duration = options.processorOptions.durationFrames + margin;
        window.sightSingingCaptures.push({
          count: () => port2.postMessage({ count: 4 }),
          live: () => {
            for (let offset = 0; offset <= margin + frameSize; offset += frameSize) {
              port2.postMessage({ samples: new Float32Array(frameSize), done: false });
            }
          },
          complete: () => {
            // Two written E4 measures. Supply one on-pitch and one off-pitch.
            const framesPerBar = 3 * audio.sampleRate;
            for (let offset = 0; offset < duration; offset += frameSize) {
              const hz = offset < margin + framesPerBar ? 329.6276 : 391.9954;
              const samples = Float32Array.from({ length: Math.min(frameSize, duration - offset) }, (_, index) =>
                offset < margin + 1.55 * audio.sampleRate || offset >= margin + 2 * framesPerBar ? 0 : .2 * Math.sin(2 * Math.PI * hz * (offset + index) / audio.sampleRate));
              port2.postMessage({ samples, done: offset + frameSize >= duration }, [samples.buffer]);
            }
            port2.close();
          },
        });
      }
      get port() { return this.capturePort; }
    };
  });
  const { email, password } = fixture.accounts[0];
  const login = await context.request.post(`${fixture.origin}/api/auth/sign-in/email`, {
    headers: { origin: fixture.origin }, data: { email, password },
  });
  assert.equal(login.status(), 200);
  const page = await context.newPage();
  let publications = 0;
  page.on('request', req => { if (req.method() === 'POST' && req.url().endsWith('/results')) publications++; });
  await page.goto(`${fixture.origin}/choirs/${fixture.choirId}`);
  await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '工具', exact: true }).click();
  await page.getByRole('link', { name: '视唱练习', exact: true }).click();
  await page.getByRole('button', { name: '新建题目' }).click();
  await page.locator('select[name=source]').selectOption('upload');
  const xml = musicXmlFixture(24).toString().replaceAll('<measure number="1">', '<measure number="0">');
  await page.locator('input[type=file]').setInputFiles({ name: '示例.musicxml', mimeType: 'application/xml', buffer: Buffer.from(xml) });
  await page.locator('input[name=title]').fill('视唱布局测试');
  await page.getByRole('button', { name: '发布到云盘' }).click();

  const scope = page.getByRole('combobox', { name: '谱面范围' });
  const direction = page.getByRole('combobox', { name: '滚动方向' });
  const score = page.locator('.challenge-notation');
  const graph = page.locator('.challenge-graph');
  const controls = page.locator('.challenge-controls');
  const note = page.locator('.challenge-notation-note');
  const contextNote = note.and(page.locator('[data-focused-part=false]'));
  await expect(scope).toHaveValue('full');
  await expect(direction).toHaveValue('vertical');
  await expect(note).toHaveCount(48);
  await expect(contextNote).toHaveCount(24);
  await expect.poll(() => score.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
  await score.evaluate(el => { el.scrollTop = el.scrollHeight; });
  await expect.poll(() => score.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  const before = await controls.boundingBox();
  const bottom = before.y + before.height;
  assert(Math.abs(bottom - 650) <= 1);
  const tallScore = (await score.boundingBox()).height;

  await direction.selectOption('horizontal');
  await expect(scope).toHaveValue('full');
  await expect(contextNote).toHaveCount(24);
  await expect.poll(() => score.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
  await scope.selectOption('part');
  await expect(direction).toHaveValue('horizontal');
  await expect(note).toHaveCount(24);
  await expect(contextNote).toHaveCount(0);

  const zoom = page.getByRole('button', { name: '谱面大小' });
  const enlarge = page.getByRole('button', { name: '放大谱面' });
  const anchor = note.and(page.locator('[data-bar="7"]'));
  await anchor.evaluate(el => {
    const viewport = el.closest('.challenge-notation');
    viewport.scrollLeft = el.offsetLeft - viewport.clientWidth * .32;
  });
  const glyphSize = () => score.evaluate(view => {
    const glyph = view.querySelector('svg g.at text');
    return glyph ? parseFloat(getComputedStyle(glyph).fontSize) : 0;
  });
  await expect.poll(glyphSize).toBeGreaterThan(0);
  const oldSize = await glyphSize();
  await enlarge.click();
  await expect(zoom).toHaveText('100%');
  await expect.poll(glyphSize).toBeGreaterThan(oldSize);
  await expect(anchor).toBeInViewport();
  await direction.selectOption('vertical');
  await expect(note).toHaveCount(24);
  await expect(anchor).toBeInViewport();

  const togglePitch = async () => {
    await page.getByRole('button', { name: '练习设置' }).click();
    await page.getByRole('switch', { name: '音高轨迹' }).press('Space');
    await page.getByRole('button', { name: '关闭', exact: true }).click();
  };
  await togglePitch();
  await expect(graph).toBeVisible();
  const measures = graph.getByRole('listitem');
  await expect(measures).toHaveText(['0', '2', '3']);
  const beforeGraphZoom = await score.boundingBox();
  await graph.getByRole('button', { name: '显示更少小节' }).click();
  await expect(measures).toHaveText(['0', '2']);
  await expect(zoom).toHaveText('100%');
  assert.equal((await score.boundingBox()).height, beforeGraphZoom.height);
  const sheetBox = await score.boundingBox(), pitchBox = await graph.boundingBox(), controlsBox = await controls.boundingBox();
  assert(sheetBox.height < tallScore && sheetBox.height > 0);
  assert(sheetBox.y + sheetBox.height <= pitchBox.y);
  assert(pitchBox.y + pitchBox.height <= controlsBox.y);
  assert(Math.abs(controlsBox.y + controlsBox.height - bottom) <= 1);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 320);
  await page.setViewportSize({ width: 568, height: 320 });
  await expect(anchor).toBeInViewport();
  await expect.poll(async () => (await score.boundingBox()).height).toBeGreaterThan(95);
  assert(Math.abs((await controls.boundingBox()).y + (await controls.boundingBox()).height - 320) <= 1);
  await page.setViewportSize({ width: 320, height: 650 });
  await togglePitch();
  await expect(graph).toHaveCount(0);
  assert.equal((await score.boundingBox()).height, tallScore);

  const run = page.locator('.challenge-run');
  const start = page.getByRole('button', { name: '开始唱', exact: true });
  const marks = score.locator('[data-challenge-feedback]');
  await start.click();
  await expect.poll(() => page.evaluate(() => window.sightSingingCaptures.length)).toBe(1);
  await page.evaluate(() => window.sightSingingCaptures[0].complete());
  await expect(run).toHaveAttribute('data-phase', 'result');
  const evidence = process.env.SIGHT_LATENCY_EVIDENCE;
  const rating = page.locator('.challenge-score strong');
  const initialRating = await rating.textContent();
  const audio = page.locator('.challenge-result audio');
  const replayEnergy = () => audio.evaluate(async player => {
    const wav = new DataView(await (await fetch(player.src)).arrayBuffer());
    const rate = wav.getUint32(24, true);
    let energy = 0;
    for (let sample = Math.round(1.42 * rate); sample < Math.round(1.5 * rate); sample++) {
      energy += (wav.getInt16(44 + sample * 2, true) / 32768) ** 2;
    }
    return energy;
  });
  await expect(page.getByRole('button', { name: '回听' })).toBeEnabled();
  const unalignedEnergy = await replayEnergy();
  await score.evaluate(el => { el.scrollTop = 0; });
  if (evidence) await page.screenshot({ path: join(evidence, 'result.png') });
  const align = page.getByRole('button', { name: '有延迟？', exact: true });
  const listen = page.getByRole('button', { name: '回听', exact: true });
  await align.click();
  const panel = page.getByRole('group', { name: '调整回放延迟', exact: true });
  await expect(panel.getByRole('heading')).toBeFocused();
  await expect(align).toHaveCount(0);
  await expect(page.getByRole('button', { name: '再试一次', exact: true })).toHaveCount(0);
  const slider = page.getByRole('slider', { name: '人声对齐' });
  await expect(slider).toHaveValue('0');
  await expect(slider).toHaveAttribute('aria-valuetext', '不补偿 · 0 毫秒');
  await page.getByRole('button', { name: '减少 10 毫秒' }).click();
  await expect(slider).toHaveAttribute('aria-valuetext', '人声延后 10 毫秒');
  const measure = async index => {
    await page.getByRole('button', { name: '自动测量' }).click();
    await expect.poll(() => page.evaluate(() => window.sightSingingCalibrations.length)).toBe(index + 1);
    const rate = await page.evaluate(index => window.sightSingingCalibrations[index].rate, index);
    const loopback = new Float32Array(Math.floor(rate * 3));
    const tone = calibrationTone(rate);
    for (const time of calibrationTimes) loopback.set(tone, Math.round((time + .2) * rate));
    await page.evaluate(({ samples, index }) => window.sightSingingCalibrations[index].send(samples), { samples: Array.from(loopback), index });
    await expect(slider).toHaveValue('200');
  };
  await measure(0);
  await expect(slider).toHaveAttribute('aria-valuetext', '人声提前 200 毫秒');
  await expect(panel.getByText('人声提前 200 毫秒', { exact: true })).toBeVisible();
  await expect(rating).not.toHaveText(initialRating);
  await expect(page.getByRole('button', { name: '回听' })).toBeEnabled();
  assert.ok(await replayEnergy() > unalignedEnergy * 2 + 1, 'the same recording moves earlier in the replay');
  if (evidence) {
    await page.screenshot({ path: join(evidence, 'adjust.png') });
    await page.setViewportSize({ width: 568, height: 320 });
    await score.evaluate(el => { el.scrollTop = 0; });
    await page.screenshot({ path: join(evidence, 'adjust-landscape.png') });
    await page.setViewportSize({ width: 320, height: 650 });
  }
  await listen.click();
  await expect(run).toHaveAttribute('data-replaying', 'true');
  await panel.getByRole('button', { name: '取消' }).click();
  await expect(align).toBeFocused();
  await expect(rating).toHaveText(initialRating);
  await expect(listen).toBeEnabled();
  assert.equal(await replayEnergy(), unalignedEnergy);
  await expect.poll(() => audio.evaluate(player => player.currentTime)).toBe(0);

  await align.click();
  await expect(slider).toHaveValue('0');
  await measure(1);
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await expect(panel).toHaveCount(0);
  await expect(rating).not.toHaveText(initialRating);
  assert.equal(publications, 0, 'finishing calibration does not publish');
  await expect(listen).toBeEnabled();
  if (evidence) await page.screenshot({ path: join(evidence, 'done.png') });
  await page.getByRole('button', { name: '练习设置' }).click();
  const settings = page.getByRole('dialog', { name: '练习设置' });
  await settings.getByRole('button', { name: '人声对齐', exact: true }).click();
  await expect(settings.getByRole('slider', { name: '人声对齐' })).toHaveValue('200');
  if (evidence) await page.screenshot({ path: join(evidence, 'settings.png') });
  await settings.getByRole('button', { name: '关闭', exact: true }).click();
  await score.evaluate(el => { el.scrollTop = 0; });
  await expect.poll(() => score.locator('[data-challenge-feedback="inTune"]').count()).toBeGreaterThan(0);
  await expect.poll(() => score.locator('[data-challenge-feedback="wrongNote"]').count()).toBeGreaterThan(0);

  await marks.first().evaluate(glyph => { window.reviewGlyph = glyph; });
  await score.evaluate(el => { el.scrollTop = el.scrollHeight; });
  await expect.poll(() => page.evaluate(() => window.reviewGlyph.isConnected)).toBe(false);

  const visibleScore = Number((await rating.textContent()).match(/\d+(?:\.\d+)?/)[0]);
  assert.equal(publications, 0, 'no score is sent while the player is reviewing or calibrating');
  const submitted = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/results'));
  await page.getByRole('button', { name: '再试一次', exact: true }).click();
  assert.equal((await submitted).request().postDataJSON().score, visibleScore);
  await expect(run).toHaveAttribute('data-phase', 'idle');
  const retryScrollTop = await score.evaluate(el => {
    const scrollTop = el.scrollTop;
    el.scrollTop = 0;
    return scrollTop;
  });
  await expect.poll(() => page.evaluate(() => window.reviewGlyph.isConnected)).toBe(true);
  await expect(marks).toHaveCount(0);
  assert.equal(retryScrollTop, 0);
  await expect(scope).toHaveValue('part');
  await expect(direction).toHaveValue('vertical');
  await expect(zoom).toHaveText('100%');
  await togglePitch();
  await expect(measures).toHaveText(['0', '2']);

  await start.click();
  await expect.poll(() => page.evaluate(() => window.sightSingingCaptures.length)).toBe(2);
  await page.evaluate(() => window.sightSingingCaptures[1].count());
  await expect(run).toHaveAttribute('data-phase', 'count');
  await expect(marks).toHaveCount(0);
  await page.evaluate(() => window.sightSingingCaptures[1].live());
  await expect(run).toHaveAttribute('data-phase', 'sing');
  await expect(marks).toHaveCount(0);
});
