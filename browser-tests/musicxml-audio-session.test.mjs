import { closePractice } from './practice-controls.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium, webkit, expect } from '@playwright/test';
import { startStorageFixture } from './storage-fixture.mjs';
import { musicXmlFixture } from './musicxml-fixture.mjs';

const hintText = '此设备在静音模式下可能无法播放练习音频。若无声，请关闭静音模式并检查媒体音量。';

async function checkSightSingingHint(page, driveUrl, bytes) {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto(driveUrl);
  await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '工具', exact: true }).click();
  await page.getByRole('link', { name: '视唱练习', exact: true }).click();
  await page.getByRole('button', { name: '新建题目' }).click();
  await page.locator('select[name=source]').selectOption('upload');
  await page.locator('input[type=file]').setInputFiles({ name: '视唱.musicxml', mimeType: 'application/xml', buffer: bytes });
  const title = '视唱声音提示';
  await page.locator('input[name=title]').fill(title);
  await page.getByRole('button', { name: '发布到云盘' }).click();

  const tonic = page.getByRole('button', { name: '持续主音', exact: true });
  const hint = page.getByText(hintText, { exact: true });
  await expect(tonic).toBeEnabled();
  await expect(hint).toHaveCount(0);
  await tonic.click();
  await expect(hint).toBeVisible();
  await page.getByRole('button', { name: '关闭播放声音提示', exact: true }).click();
  await expect(hint).toHaveCount(0);
  await expect(tonic).toHaveAttribute('aria-pressed', 'true');
  await tonic.click();
  await expect(tonic).toHaveAttribute('aria-pressed', 'false');
  await tonic.click();
  await expect(tonic).toHaveAttribute('aria-pressed', 'true');
  await expect(hint).toHaveCount(0);

  await page.getByRole('button', { name: '返回题目列表', exact: true }).click();
  await page.getByRole('button', { name: new RegExp(`^${title}`) }).click();
  await tonic.click();
  await expect(tonic).toHaveAttribute('aria-pressed', 'true');
  await expect(hint).toHaveCount(0);
}

// Browser adapters verify integration, not an iPhone's physical mute switch.
for (const [engine, type] of [['chromium', chromium], ['webkit', webkit]]) {
  test(`MusicXML audio sessions and sight-singing compatibility advice (${engine})`, { timeout: 180000 }, async t => {
    const fixture = await startStorageFixture({ authenticated: true, previewEntry: false });
    let browser;
    t.after(async () => { try { await browser?.close(); } finally { await fixture.stop(); } });
    browser = await type.launch();
    for (const supported of [true, false]) {
      const context = await browser.newContext({ locale: "zh-CN", serviceWorkers: 'block' });
      try {
        assert.equal((await context.request.post(`${fixture.origin}/api/auth/sign-in/email`, {
          headers: { origin: fixture.origin }, data: { email: fixture.accounts[0].email, password: fixture.accounts[0].password },
        })).status(), 200);
        const bytes = Buffer.from(musicXmlFixture());
        const name = supported ? '媒体模式.musicxml' : '兼容提示.musicxml';
        assert.equal((await context.request.post(`${fixture.origin}/api/choirs/${fixture.choirId}/scores/${fixture.scoreId}/attachments/${crypto.randomUUID()}/file?${new URLSearchParams({ name, size: String(bytes.length) })}`, {
          headers: { 'content-type': 'application/vnd.recordare.musicxml+xml' }, data: bytes,
        })).status(), 201);
        await context.addInitScript(supported => {
          Object.defineProperty(navigator, 'userAgent', { value: 'iPhone', configurable: true });
          const session = { type: 'auto' };
          Object.defineProperty(navigator, 'audioSession', { value: supported ? session : undefined, configurable: true });
          window.__testAudioSession = session;
        }, supported);
        const page = await context.newPage();
        const errors = []; page.on('pageerror', error => errors.push(error.message));
        const driveUrl = `${fixture.origin}/choirs/${fixture.choirId}`;
        await page.goto(driveUrl);
        await page.getByRole('button', { name: new RegExp('本地链路测试：\\d+ 个附件') }).click();
        await page.getByRole('button', { name, exact: true }).click();
        const player = page.getByTestId('musicxml-player');
        await expect(player.getByRole('button', { name: '播放', exact: true })).toBeEnabled({ timeout: 60000 });
        assert.equal(await page.evaluate(() => window.__testAudioSession.type), 'auto');
        const hint = page.getByText(hintText, { exact: true });
        await expect(hint).toHaveCount(0);
        await player.getByRole('button', { name: '播放', exact: true }).click();
        await expect(player.getByRole('button', { name: '暂停', exact: true })).toBeVisible();
        if (supported) {
          assert.equal(await page.evaluate(() => window.__testAudioSession.type), 'playback');
          await expect(hint).toHaveCount(0);
          await player.getByRole('button', { name: '暂停', exact: true }).click();
          await expect.poll(() => page.evaluate(() => window.__testAudioSession.type)).toBe('auto');
          await player.getByRole('button', { name: '播放', exact: true }).click();
          await expect.poll(() => page.evaluate(() => window.__testAudioSession.type)).toBe('playback');
        } else {
          await expect(hint).toBeVisible();
          await expect(page.getByRole('button', { name: '关闭播放声音提示' })).toBeVisible();
          await expect(hint).toHaveCount(0, { timeout: 12000 });
          await player.getByRole('button', { name: '暂停', exact: true }).click();
          await player.getByRole('button', { name: '播放', exact: true }).click();
          await expect(page.getByLabel('播放声音提示', { exact: true })).toHaveCount(0);
          await page.getByRole('button', { name: '练习设置', exact: true }).click();
          await expect(page.getByRole('dialog', { name: '练习设置', exact: true })).toBeVisible();
          await expect(hint).toHaveCount(0);
          await page.getByRole('button', { name: '关闭练习设置', exact: true }).click();
        }
        await closePractice(page);
        await expect.poll(() => page.evaluate(() => window.__testAudioSession.type)).toBe('auto');
        if (!supported) await checkSightSingingHint(page, driveUrl, bytes);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    }
  });
}
