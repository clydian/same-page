import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium, expect } from '@playwright/test';
import { musicXmlFixture } from './musicxml-fixture.mjs';
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
    window.AudioWorkletNode = class extends Worklet {
      constructor(audio, name, options) {
        super(audio, name, options);
        const { port1, port2 } = new MessageChannel();
        this.capturePort = port1;
        const frameSize = options.processorOptions.chunkFrames;
        window.sightSingingCaptures.push({
          count: () => port2.postMessage({ count: 4 }),
          frame: () => port2.postMessage({ samples: new Float32Array(frameSize), done: false }),
          complete: () => {
            // Two written E4 measures. Supply one on-pitch and one off-pitch.
            const framesPerBar = 3 * audio.sampleRate;
            for (let offset = 0; offset < 2 * framesPerBar; offset += frameSize) {
              const hz = offset < framesPerBar ? 329.6276 : 391.9954;
              const samples = Float32Array.from({ length: frameSize }, (_, index) =>
                .2 * Math.sin(2 * Math.PI * hz * (offset + index) / audio.sampleRate));
              port2.postMessage({ samples, done: offset + frameSize >= 2 * framesPerBar }, [samples.buffer]);
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
  await page.getByRole('button', { name: '查看谱面', exact: true }).click();
  await expect.poll(() => score.locator('[data-challenge-feedback="inTune"]').count()).toBeGreaterThan(0);
  await expect.poll(() => score.locator('[data-challenge-feedback="wrongNote"]').count()).toBeGreaterThan(0);
  await marks.first().evaluate(glyph => { window.reviewGlyph = glyph; });
  await score.evaluate(el => { el.scrollTop = el.scrollHeight; });
  await expect.poll(() => page.evaluate(() => window.reviewGlyph.isConnected)).toBe(false);

  await page.getByRole('button', { name: '再试一次', exact: true }).click();
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
  await page.evaluate(() => window.sightSingingCaptures[1].frame());
  await expect(run).toHaveAttribute('data-phase', 'sing');
  await expect(marks).toHaveCount(0);
});
