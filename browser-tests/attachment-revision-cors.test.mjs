import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import test from 'node:test';
import { chromium, webkit, expect } from '@playwright/test';
import { startConnectionFixture } from './connection-fixture.mjs';
import { withBrowserEvidence } from './browser-evidence.mjs';
import { musicXmlFixture } from './musicxml-fixture.mjs';

for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
  test(`${name}: attachment revisions survive real credentialed CORS and fail closed when unverifiable`, { timeout: 180_000 }, async t => {
    const fixture = await startConnectionFixture();
    let browser;
    t.after(async () => { try { await browser?.close(); } finally { await fixture.stop(); } });
    browser = await engine.launch(name === 'chromium' && process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {});
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block', ignoreHTTPSErrors: true });
    const page = await context.newPage();
    const { origins, network } = fixture;
    await page.goto(origins.direct + '/login');
    assert.equal(await page.evaluate(async account => (await fetch('/api/_entry/direct/auth/sign-in/email', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(account),
    })).status, { email: fixture.accounts[0].email, password: fixture.accounts[0].password }), 200);
    const library = `${origins.direct}/choirs/${fixture.choirId}`;
    await page.goto(library);
    await expect(page.locator('.file-row__open').first()).toBeVisible();
    await expect.poll(() => page.evaluate(async () => Object.values((await import('/src/client/connection/connection.ts')).connections.getSnapshot().identity).every(value => value === 'ready'))).toBe(true);
    const source = await page.evaluate(async ({ choirId, scoreId, xml }) => {
      const { attachmentFetch } = await import('/src/client/score-library/attachments/request.ts');
      const { connectionFetch } = await import('/src/client/connection/connection.ts');
      const bytes = new TextEncoder().encode(xml);
      const upload = await attachmentFetch(`/api/choirs/${choirId}/scores/${scoreId}/attachments/${crypto.randomUUID()}/file?name=${encodeURIComponent('跨域练习.xml')}&size=${bytes.length}`, { method: 'POST', body: new Blob([bytes]) });
      if (upload.status !== 201) throw new Error('fixture_attachment_upload_failed');
      const attachment = (await upload.json()).attachment;
      const score = (await (await connectionFetch(`/api/choirs/${choirId}/scores`)).json()).scores.find(score => score.id === scoreId);
      const { user, session } = await (await connectionFetch('/api/auth/get-session')).json();
      return { attachment, score, choirId, ownerKey: `user:${user.id}`, sessionId: session.id };
    }, { choirId: fixture.choirId, scoreId: fixture.scoreId, xml: musicXmlFixture(2).toString() });
    const resolve = () => page.evaluate(async source => {
      const { resolveMusicXmlSource } = await import('/src/client/playback/musicxml-source.ts');
      const { acquirePlaybackPreparation } = await import('/src/client/playback/playback-preparation.ts');
      const lease = acquirePlaybackPreparation(source);
      try {
        const result = await resolveMusicXmlSource(source, new AbortController().signal, lease);
        return { tier: result.tier, bytes: result.bytes.length };
      } catch (error) { return { error: error.message, status: error.status }; }
      finally { lease.release(); }
    }, source);
    const mode = value => page.evaluate(async value => (await import('/src/client/connection/connection.ts')).setConnectionMode(value), value);
    const directory = `artifacts/verification/attachment-revision-cors/${name}`;
    await withBrowserEvidence(context, directory, async () => {
      await mode('backup');
      // This is a real Worker response through two HTTPS sibling hosts. Node's
      // fetch/Response mocks cannot detect the browser's CORS header filtering.
      const visible = await page.evaluate(async source => {
        const { attachmentFetch } = await import('/src/client/score-library/attachments/request.ts');
        const path = `/api/choirs/${source.choirId}/scores/${source.score.id}/attachments/${source.attachment.id}/file?revision=${source.attachment.revision}`;
        const response = await attachmentFetch(path);
        return { type: response.type, revision: response.headers.get('X-Attachment-Revision'), bytes: (await response.arrayBuffer()).byteLength };
      }, source);
      assert.deepEqual(visible, { type: 'cors', revision: '1', bytes: source.attachment.sizeBytes });
      assert.deepEqual(await resolve(), { tier: 'network', bytes: source.attachment.sizeBytes });
      for (const fault of ['hidden', 'missing', 'changed', 401, 403, 404, 409]) {
        network.attachmentFault = fault;
        const result = await resolve();
        if (typeof fault === 'number') assert.equal(result.status, fault);
        else assert.equal(result.error, fault === 'changed' ? '附件已更新，请从附件列表重新打开。' : '暂时无法校验附件版本，请检查连接后重试。');
        assert.equal(result.bytes, undefined, 'a protocol/permission failure must never return old bytes');
      }
      // Capture the actual application error UI with synthetic data, before a
      // successful player session can save an original and hide the network path.
      await mkdir(directory, { recursive: true });
      for (const fault of ['hidden', 'changed']) {
        network.attachmentFault = fault;
        await page.goto(library);
        await expect(page.getByRole('button', { name: '本地链路测试：1 个附件', exact: true })).toBeVisible();
        await page.getByRole('button', { name: '本地链路测试：1 个附件', exact: true }).click();
        await page.getByRole('button', { name: '跨域练习.xml', exact: true }).click();
        const message = page.getByText(fault === 'hidden' ? '暂时无法校验附件版本，请检查连接后重试。' : '附件已更新，请从附件列表重新打开。', { exact: true });
        await expect(message).toBeVisible();
        for (const [size, viewport] of [['desktop', { width: 1280, height: 900 }], ['mobile', { width: 375, height: 812 }]]) {
          await page.setViewportSize(viewport);
          await expect(message).toBeVisible();
          const box = await message.boundingBox();
          assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width && box.y + box.height <= viewport.height, 'complete message fits in the viewport');
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal overflow');
          await page.screenshot({ path: `${directory}/${fault}-${size}.png` });
        }
        await page.getByRole('button', { name: '结束练习', exact: true }).click();
      }
      network.attachmentFault = null;
      await page.goto(library);
      await mode('direct'); await mode('auto');
      // Only API traffic is interrupted; the same page and player assets remain.
      network.directBroken = true;
      assert.deepEqual(await resolve(), { tier: 'network', bytes: source.attachment.sizeBytes });
      assert.equal(await page.evaluate(async () => (await import('/src/client/connection/connection.ts')).connections.getSnapshot().active), 'backup');
      // This dev fixture exposes source modules for the resolver checks, but
      // versioned soundfonts exist only in production builds. Real rendering,
      // audio and cold offline playback stay in musicxml-offline.test.mjs.
      network.directBroken = false;
      await page.goto(`${origins.backup}/choirs/${fixture.choirId}`);
      await expect(page.locator('.file-row__open').first()).toBeVisible();
      await mode('direct');
      const reverse = await page.evaluate(async source => {
        const { attachmentFetch } = await import('/src/client/score-library/attachments/request.ts');
        const response = await attachmentFetch(`/api/choirs/${source.choirId}/scores/${source.score.id}/attachments/${source.attachment.id}/file?revision=1`);
        return { type: response.type, revision: response.headers.get('X-Attachment-Revision'), bytes: (await response.arrayBuffer()).byteLength };
      }, source);
      assert.deepEqual(reverse, { type: 'cors', revision: '1', bytes: source.attachment.sizeBytes });
      // A synthetic five-second MP3 checks the separate native-media path,
      // including credentialed cross-origin streaming and readable range headers.
      const mp3 = await readFile(new URL('./fixtures/practice-tone.mp3', import.meta.url));
      const uploadStatus = await page.evaluate(async ({ source, bytes }) => {
        const { attachmentFetch } = await import('/src/client/score-library/attachments/request.ts');
        return (await attachmentFetch(`/api/choirs/${source.choirId}/scores/${source.score.id}/attachments/${crypto.randomUUID()}/file?name=${encodeURIComponent('跨域录音.mp3')}&size=${bytes.length}`, { method: 'POST', body: new Blob([new Uint8Array(bytes)]) })).status;
      }, { source, bytes: [...mp3] });
      assert.equal(uploadStatus, 201);
      await page.goto(`${origins.backup}/choirs/${fixture.choirId}`);
      await page.getByRole('button', { name: '本地链路测试：2 个附件', exact: true }).click();
      await page.getByRole('button', { name: '跨域录音.mp3', exact: true }).click();
      await expect.poll(() => page.locator('audio').evaluate(audio => audio.readyState)).toBeGreaterThanOrEqual(1);
      assert.equal(await page.locator('audio').evaluate(audio => new URL(audio.src).origin), origins.direct);
      const range = await page.locator('audio').evaluate(async audio => {
        const response = await fetch(audio.src, { credentials: 'include', headers: { Range: 'bytes=0-127' } });
        return { status: response.status, bytes: (await response.arrayBuffer()).byteLength, range: response.headers.get('Content-Range') };
      });
      assert.deepEqual(range, { status: 206, bytes: 128, range: `bytes 0-127/${mp3.length}` });
      await page.getByRole('button', { name: '播放', exact: true }).click();
      await expect.poll(() => page.locator('audio').evaluate(audio => audio.currentTime)).toBeGreaterThan(0);
    });
  });
}
