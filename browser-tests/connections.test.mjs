import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import test from 'node:test';
import { chromium, webkit, expect } from '@playwright/test';
import { startConnectionFixture } from './connection-fixture.mjs';
import { withConnectionEvidence } from './connection-evidence.mjs';

for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
  test(`${name}: real same-session cookies, cold failover, pinned choice and uncertain XHR write`, { timeout: 120_000 }, async t => {
    const fixture = await startConnectionFixture();
    const { origins, network } = fixture;
    t.after(() => fixture.stop());
    const browser = await engine.launch(); t.after(() => browser.close());
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', ignoreHTTPSErrors: true }); t.after(() => context.close());
    const page = await context.newPage();
    await page.goto(origins.direct + '/login');
    const status = await page.evaluate(async account => (await fetch('/api/_entry/direct/auth/sign-in/email', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(account),
    })).status, { email: fixture.accounts[0].email, password: fixture.accounts[0].password });
    assert.equal(status, 200);
    await page.goto(`${origins.direct}/choirs/${fixture.choirId}`);
    await expect(page.locator('.file-row__open').first()).toBeVisible();
    await page.getByRole('button', { name: /^连接线路/ }).click();
    await expect.poll(() => page.evaluate(async () => Object.values((await import('/src/client/connection/connection.ts')).connections.getSnapshot().identity).every(value => value === 'ready'))).toBe(true);
    await expect(page.getByText('当前线路：直连')).toBeVisible();
    await mkdir('artifacts/verification/issue-580', { recursive: true });
    await page.screenshot({ path: `artifacts/verification/issue-580/${name}-mobile-panel.png` });
    const cookies = await context.cookies();
    assert.ok(cookies.some(cookie => cookie.name === '__Host-same_page_entry' && cookie.domain === new URL(origins.backup).hostname && cookie.httpOnly && cookie.secure));
    assert.ok(cookies.filter(cookie => cookie.name.includes('session_token') || cookie.name === '__Host-same_page_entry').every(cookie => !cookie.domain.startsWith('.')));
    await page.getByRole('button', { name: '关闭连接面板' }).click();
    await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); localStorage.setItem('issue-580-draft-marker', 'keep'); document.body.style.minHeight = '2500px'; window.scrollTo(0, 200); });
    await expect(page.locator('.connection-fab')).toHaveAttribute('data-visible', 'false');
    await expect(page.locator('.upload-fab')).toHaveAttribute('data-visible', 'false');
    await page.evaluate(() => window.scrollTo(0, 100));
    await expect(page.locator('.connection-fab')).toHaveAttribute('data-visible', 'true');
    await withConnectionEvidence(page, { directory: `artifacts/verification/issue-580/${name}-switch-to-upload`, origins, network }, async mark => {
      network.directBroken = true;
      mark('cold-reload');
      await page.reload();
      await expect(page.locator('.file-row__open').first()).toBeVisible();
      await page.getByRole('button', { name: /^连接线路/ }).click();
      await expect(page.getByText('当前线路：备用')).toBeVisible();
      assert.equal(await page.evaluate(() => localStorage.getItem('issue-580-draft-marker')), 'keep');
      assert.equal(new URL(page.url()).origin, origins.direct);
      mark('select-direct');
      await page.getByRole('radio', { name: '直连', exact: true }).check();
      await expect(page.locator('.connection-routes li').filter({ has: page.getByText('直连', { exact: true }) }).getByText('暂时连不上', { exact: true })).toBeVisible();
      await expect(page.getByRole('radio', { name: '直连', exact: true })).toBeChecked();
      await expect(page.getByRole('link', { name: '前往登录', exact: true })).toHaveCount(0);
      mark('select-backup');
      await page.getByRole('radio', { name: '备用', exact: true }).check();
      await expect(page.getByRole('radio', { name: '备用', exact: true })).toBeChecked();
      await page.getByRole('button', { name: '关闭连接面板' }).click();
      mark('await-upload-enabled');
      await expect(page.getByRole('button', { name: '上传 PDF', exact: true })).toBeEnabled();
    });
    await page.getByRole('button', { name: '上传 PDF', exact: true }).click();
    await page.getByLabel('选择 PDF 文件').setInputFiles({ name: 'alternate-upload.pdf', mimeType: 'application/pdf', buffer: fixture.pdf });
    await expect(page.locator('.upload-list li[data-status="success"]')).toHaveCount(1);
    network.loseUploadResponse = true;
    await page.getByLabel('选择 PDF 文件').setInputFiles({ name: 'response-lost.pdf', mimeType: 'application/pdf', buffer: fixture.pdf });
    await expect(page.locator('.upload-list li[data-status="unknown"]')).toHaveCount(1);
    assert.equal(network.uploads, 2, 'a lost acknowledgement must not submit a second write');
    assert.ok(network.traffic.some(entry => entry.path.includes('/backup/choirs/') && entry.method === 'POST'));
    await page.screenshot({ path: `artifacts/verification/issue-580/${name}-uncertain-upload.png` });
    // Native Range/credentials and media state follow the same route controller.
    await page.goto(`${origins.direct}/choirs/${fixture.choirId}`);
    await page.getByRole('button', { name: '本地链路测试 更多操作', exact: true }).click();
    await page.getByRole('menuitem', { name: '添加附件', exact: true }).click();
    await page.getByRole('button', { name: '音频', exact: true }).click();
    const wav = Buffer.alloc(44 + 8000 * 20 * 2);
    wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28);
    wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
    await page.getByLabel('选择附件文件').setInputFiles({ name: '线路录音.wav', mimeType: 'audio/wav', buffer: wav });
    await page.getByRole('button', { name: '上传', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('button', { name: '本地链路测试：1 个附件', exact: true }).click();
    await page.getByRole('button', { name: '线路录音.wav', exact: true }).click();
    await expect.poll(() => page.locator('audio').evaluate(audio => audio.readyState)).toBeGreaterThanOrEqual(1);
    await page.getByRole('button', { name: '播放', exact: true }).click();
    await page.locator('audio').evaluate(audio => { audio.currentTime = 3; audio.playbackRate = 1.25; audio.volume = .4; });
    const range = await page.locator('audio').evaluate(async audio => {
      const result = await fetch(audio.src, { credentials: 'include', headers: { Range: 'bytes=0-127' } });
      return { status: result.status, bytes: (await result.arrayBuffer()).byteLength, range: result.headers.get('Content-Range') };
    });
    assert.deepEqual(range, { status: 206, bytes: 128, range: `bytes 0-127/${wav.length}` });
    network.directBroken = false;
    await page.evaluate(async () => {
      const { connections, setConnectionMode } = await import('/src/client/connection/connection.ts');
      setConnectionMode('direct'); await connections.check();
    });
    await expect.poll(() => page.locator('audio').evaluate(audio => audio.src.includes('/_entry/direct/'))).toBe(true);
    await expect.poll(() => page.locator('audio').evaluate(audio => audio.currentTime)).toBeGreaterThanOrEqual(3);
    assert.equal(await page.locator('audio').evaluate(audio => audio.playbackRate), 1.25);
    assert.ok(Math.abs(await page.locator('audio').evaluate(audio => audio.volume) - .4) < .01);
    await expect.poll(() => page.locator('audio').evaluate(audio => audio.paused)).toBe(false);
    await page.screenshot({ path: `artifacts/verification/issue-580/${name}-audio-state.png` });
    // Main PDF uses credentialed native requests on backup, including its version guard.
    await page.goto(`${origins.direct}/choirs/${fixture.choirId}`);
    await page.getByRole('button', { name: /^连接线路/ }).click();
    await page.getByRole('radio', { name: '备用', exact: true }).check();
    await expect(page.getByRole('button', { name: '重新检测', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: '关闭连接面板' }).click();
    await page.goto(`${origins.direct}/choirs/${fixture.choirId}/scores/${fixture.scoreId}`);
    await expect(page.locator('canvas[data-pdf-canvas-active]').first()).toBeVisible();
    assert.ok(network.traffic.some(entry => entry.path.includes('/_entry/backup/choirs/') && entry.path.includes('/pdf?_sp_session=')));
    network.directBroken = true;
    // First access through the emergency page, with a new browser storage area.
    const emergency = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block', ignoreHTTPSErrors: true }); t.after(() => emergency.close());
    const alternate = await emergency.newPage();
    await alternate.goto(origins.backup + '/login');
    assert.equal(await alternate.evaluate(() => localStorage.getItem('issue-580-draft-marker')), null);
    assert.equal(await alternate.evaluate(async account => (await fetch('/api/_entry/backup/auth/sign-in/email', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(account),
    })).status, { email: fixture.accounts[1].email, password: fixture.accounts[1].password }), 200);
    await alternate.goto(`${origins.backup}/choirs/${fixture.choirId}`);
    await expect(alternate.locator('.file-row__open').first()).toBeVisible();
    network.directBroken = false;
    await alternate.getByRole('button', { name: /^连接线路/ }).click();
    // Opening can join a probe that began while direct was still broken.
    // Confirm its restored network state with a fresh user-requested check;
    // a prepared credential alone must not render a failed route as usable.
    await expect(alternate.getByRole('button', { name: '重新检测', exact: true })).toBeEnabled();
    await alternate.getByRole('button', { name: '重新检测', exact: true }).click();
    await expect.poll(() => alternate.evaluate(async () => Object.values((await import('/src/client/connection/connection.ts')).connections.getSnapshot().identity).every(value => value === 'ready'))).toBe(true);
    await alternate.getByRole('radio', { name: '直连', exact: true }).check();
    await expect(alternate.getByRole('radio', { name: '直连', exact: true })).toBeChecked();
    assert.equal(new URL(alternate.url()).origin, origins.backup);
    await alternate.screenshot({ path: `artifacts/verification/issue-580/${name}-emergency-desktop-panel.png` });
  });
}
