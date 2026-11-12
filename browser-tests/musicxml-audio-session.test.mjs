import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium, webkit, expect } from '@playwright/test';
import { startStorageFixture } from './storage-fixture.mjs';
import { musicXmlFixture } from './musicxml-fixture.mjs';

// Browser adapters verify integration, not an iPhone's physical mute switch.
for (const [engine, type] of [['chromium', chromium], ['webkit', webkit]]) {
  test(`MusicXML declares intentional playback and advises unsupported iOS (${engine})`, { timeout: 180000 }, async t => {
    const fixture = await startStorageFixture({ authenticated: true, previewEntry: false });
    let browser;
    t.after(async () => { try { await browser?.close(); } finally { await fixture.stop(); } });
    browser = await type.launch();
    for (const supported of [true, false]) {
      const context = await browser.newContext({ serviceWorkers: 'block' });
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
        await page.goto(`${fixture.origin}/choirs/${fixture.choirId}`);
        await page.getByRole('button', { name: new RegExp('本地链路测试：\\d+ 个附件') }).click();
        await page.getByRole('button', { name, exact: true }).click();
        const player = page.getByTestId('musicxml-player');
        await expect(player.getByRole('button', { name: '播放', exact: true })).toBeEnabled({ timeout: 60000 });
        assert.equal(await page.evaluate(() => window.__testAudioSession.type), 'auto');
        const hint = page.getByText('此设备在静音模式下可能无法播放练习音频。若无声，请关闭静音模式并检查媒体音量。');
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
        } else await expect(hint).toBeVisible();
        await page.getByRole('button', { name: '结束练习', exact: true }).click();
        await expect.poll(() => page.evaluate(() => window.__testAudioSession.type)).toBe('auto');
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    }
  });
}
