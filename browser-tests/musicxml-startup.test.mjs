import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, webkit, expect } from '@playwright/test';
import { startStorageFixture } from './storage-fixture.mjs';
import { musicXmlFixture } from './musicxml-fixture.mjs';
import { withBrowserEvidence } from './browser-evidence.mjs';
import { selectPracticeView } from './practice-controls.mjs';
import { practiceWave } from '../visual-report/practice-fixture.mjs';

function hasStoredOriginal(page, attachmentId) {
  return page.evaluate(id => new Promise((resolve, reject) => {
    const request = indexedDB.open('same-page');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const keys = db.transaction('system').objectStore('system').getAllKeys();
      keys.onerror = () => { db.close(); reject(keys.error); };
      keys.onsuccess = () => {
        resolve(keys.result.some(key => String(key).startsWith('["offline-musicxml",') && String(key).includes(id)));
        db.close();
      };
    };
  }), attachmentId);
}

for (const [engine, type] of [['chromium', chromium], ['webkit', webkit]]) {
  test(`MusicXML startup reuses preparation and online raw bytes, with one MIDI generation (${engine})`, { timeout: 180000 }, async t => {
    const fixture = await startStorageFixture({ authenticated: true, previewEntry: false });
    let browser;
    t.after(async () => { try { await browser?.close(); } finally { await fixture.stop(); } });
    browser = await type.launch();
    const context = await browser.newContext({ viewport: { width: 1024, height: 768 }, serviceWorkers: 'block' });
    const login = await context.request.post(`${fixture.origin}/api/auth/sign-in/email`, {
      headers: { origin: fixture.origin }, data: { email: fixture.accounts[0].email, password: fixture.accounts[0].password },
    });
    assert.equal(login.status(), 200);
    const attachmentId = crypto.randomUUID(), bytes = musicXmlFixture(48), name = '启动回归.musicxml';
    const base = `/api/choirs/${fixture.choirId}/scores/${fixture.scoreId}/attachments/${attachmentId}`;
    const uploaded = await context.request.post(`${fixture.origin}${base}/file?${new URLSearchParams({ name, size: String(bytes.length) })}`, { data: bytes });
    assert.equal(uploaded.status(), 201);
    await context.addInitScript(() => {
      localStorage.setItem('reader-gesture-hint-seen', 'true');
      window.__xmlStartup = { metrics: [], midi: 0 };
      window.addEventListener('same-page:loading-performance', event => window.__xmlStartup.metrics.push(event.detail));
      document.addEventListener('alphaTab.midiLoad', () => window.__xmlStartup.midi++, true);
    });
    const page = await context.newPage(), errors = [], requests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => requests.push(new URL(request.url()).pathname));
    const library = `${fixture.origin}/choirs/${fixture.choirId}`;
    const evidence = `artifacts/verification/musicxml-startup/${engine}`, timings = [];
    // Hold the first real file response so switching to PDF definitely happens
    // before the XML model/layout. Hidden notation must still finish preparation.
    const originalRequested = Promise.withResolvers(), originalReleased = Promise.withResolvers();
    await context.route(url => url.pathname === `${base}/file`, async route => {
      originalRequested.resolve();
      await originalReleased.promise;
      await route.continue();
    });
    await withBrowserEvidence(context, evidence, async () => {
      await page.goto(library);
      await page.getByRole('button', { name: '本地链路测试：1 个附件', exact: true }).click();
      const open = async (tier, switchBeforeReady = false) => {
        await page.evaluate(() => { window.__xmlStartup.metrics = []; window.__xmlStartup.midi = 0; });
        const start = requests.length;
        await page.getByRole('button', { name, exact: true }).click();
        if (switchBeforeReady) {
          await originalRequested.promise;
          await selectPracticeView(page, '原始 PDF');
          assert.equal(await hasStoredOriginal(page, attachmentId), false, 'background saving waits for foreground startup');
          originalReleased.resolve();
        }
        await expect(page.getByTestId('musicxml-player').getByRole('button', { name: '播放', exact: true })).toBeEnabled({ timeout: 60000 });
        // Ready is independent from notation rendering. Returning to XML must
        // expose actual note glyphs, rather than treating a title as first paint.
        if (switchBeforeReady) await selectPracticeView(page, '重排谱面');
        await expect.poll(() => page.evaluate(() => window.__xmlStartup.metrics.some(record => record.name === 'musicxml:first-system')), { timeout: 20000 }).toBe(true);
        await expect(page.locator('.practice-notation .at-surface svg text').filter({ hasText: '\uE0A2' }).first()).toBeVisible();
        const result = await page.evaluate(() => window.__xmlStartup);
        assert.equal(result.midi, 1, 'one generated playback payload per new score');
        assert.ok(result.metrics.some(record => record.name === `musicxml:source:${tier}`));
        assert.equal(requests.slice(start).filter(path => path === base).length, 1, 'one freshly authorized metadata read per explicit opening');
        assert.equal(requests.slice(start).filter(path => path === `${base}/file`).length, tier === 'network' ? 1 : 0, 'local/prepared paths do not request the original again');
        const intent = result.metrics.find(record => record.name === 'open-musicxml:start')?.startTime;
        timings.push({
          tier, midiGenerations: result.midi,
          milestones: result.metrics.filter(record => record.name.startsWith('musicxml:')).map(record => ({ name: record.name, milliseconds: Math.max(0, record.startTime - (intent ?? record.startTime)) })),
        });
      };
      await open('network', true);
      // Saving the online original does not require a Service Worker or complete
      // optional bundle. The blocked profile must never claim offline readiness.
      await expect.poll(() => hasStoredOriginal(page, attachmentId), { timeout: 20000 }).toBe(true);
      await page.getByRole('button', { name: '结束练习', exact: true }).click();
      if (!await page.getByRole('button', { name: '练习谱', exact: true }).isVisible()) {
        await page.locator('canvas[data-pdf-canvas-active]').first().click({ position: { x: 195, y: 350 } });
      }
      await page.getByRole('button', { name: '练习谱', exact: true }).click();
      await open('prepared');
      await page.getByRole('button', { name: '结束练习', exact: true }).click();
      // A new document has no in-memory preparation, but retains the raw record.
      await page.goto(library);
      await page.getByRole('button', { name: '本地链路测试：1 个附件', exact: true }).click();
      await open('local');
      // A fresh document opening audio must retain the small common lifetime
      // module without importing the optional MusicXML/native/parser chunk.
      const audio = practiceWave();
      const audioUploaded = await context.request.post(`${fixture.origin}/api/choirs/${fixture.choirId}/scores/${fixture.scoreId}/attachments/${crypto.randomUUID()}/file?${new URLSearchParams({ name: '试听.wav', size: String(audio.length) })}`, { data: audio });
      assert.equal(audioUploaded.status(), 201);
      const audioStart = requests.length;
      await page.goto(library);
      await page.getByRole('button', { name: '本地链路测试：2 个附件', exact: true }).click();
      await page.getByRole('button', { name: '试听.wav', exact: true }).click();
      await expect(page.locator('.practice-audio-preview').getByRole('button', { name: '播放', exact: true })).toBeEnabled();
      assert.equal(requests.slice(audioStart).some(path => /musicxml-engine|alphaTab\.|soundfont/.test(path)), false, 'ordinary audio must not load the optional XML engine');
      assert.deepEqual(errors, []);
      await mkdir(evidence, { recursive: true });
      await page.screenshot({ path: `${evidence}/audio-without-xml-engine.png` });
      await writeFile(`${evidence}/timings.json`, JSON.stringify({
        engine, scope: 'Owned 48-measure fixture, installed application bundle; local integration timing, not a physical-device budget', timings,
      }, null, 2));
    });
  });
}
