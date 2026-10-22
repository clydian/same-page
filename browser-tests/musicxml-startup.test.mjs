import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
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
    let context, profile;
    t.after(async () => {
      try { await context?.close(); }
      finally {
        try { await fixture.stop(); }
        finally { if (profile) await rm(profile, { recursive: true, force: true }); }
      }
    });
    profile = await mkdtemp(path.join(tmpdir(), `same-page-xml-startup-${engine}-`));
    // This scenario verifies persisted Blob originals. Local macOS WebKit's
    // nonpersistent automation context rejects Blob/File IDB writes.
    context = await type.launchPersistentContext(profile, { viewport: { width: 1024, height: 768 }, serviceWorkers: 'block' });
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
    const directoryPath = `/api/choirs/${fixture.choirId}/attachments`;
    const expandDirectory = async (target, count) => {
      // Persisted rows can appear before the fresh directory read completes.
      // Finish that exact transport before a file click unmounts the library.
      const requested = target.waitForResponse(response => {
        const url = new URL(response.url());
        return url.pathname === directoryPath && url.searchParams.get('scoreIds') === fixture.scoreId;
      });
      await target.getByRole('button', { name: `本地链路测试：${count} 个附件`, exact: true }).click();
      const response = await requested;
      assert.equal(response.status(), 200);
      assert.equal(await response.finished(), null);
    };
    let holdDirectory = false;
    const directoryHeld = Promise.withResolvers(), directoryReleased = Promise.withResolvers();
    await context.route(url => url.pathname === directoryPath, async route => {
      if (holdDirectory) {
        holdDirectory = false;
        directoryHeld.resolve();
        await directoryReleased.promise;
      }
      await route.continue();
    });
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
      await expandDirectory(page, 1);
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
      const endPractice = async () => {
        await page.getByRole('button', { name: '结束练习', exact: true }).click();
        if (!await page.getByRole('button', { name: '练习谱', exact: true }).isVisible()) {
          await page.locator('canvas[data-pdf-canvas-active]').first().click({ position: { x: 195, y: 350 } });
        }
        // Reader chrome mounts its own directory consumer after practice ends.
        await expect(page.locator('.reader-playback-entries')).toHaveAttribute('aria-busy', 'false');
      };
      await endPractice();
      await page.getByRole('button', { name: '练习谱', exact: true }).click();
      await open('prepared');
      await endPractice();
      // A new document has no in-memory preparation, but retains the raw record.
      await page.goto(library);
      holdDirectory = true;
      let directoryReady = false;
      const expanding = expandDirectory(page, 1).then(() => { directoryReady = true; });
      await directoryHeld.promise;
      await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
      assert.equal(directoryReady, false, 'a cached row must not finish the directory boundary while its fresh request is held');
      assert.equal(page.url(), library);
      await expect(page.getByTestId('musicxml-player')).toHaveCount(0);
      directoryReleased.resolve();
      await expanding;
      await open('local');
      await mkdir(evidence, { recursive: true });
      await page.screenshot({ path: `${evidence}/online-local.png` });
      assert.deepEqual(errors, [], 'the XML document must finish without page errors');
      // Retire the XML document before observing the audio document: its
      // automatic public-asset preparation can still be in flight after ready.
      await page.close();
      // A fresh document opening audio must retain the small common lifetime
      // module without importing the optional MusicXML/native/parser chunk.
      const audio = practiceWave();
      const audioUploaded = await context.request.post(`${fixture.origin}/api/choirs/${fixture.choirId}/scores/${fixture.scoreId}/attachments/${crypto.randomUUID()}/file?${new URLSearchParams({ name: '试听.wav', size: String(audio.length) })}`, { data: audio });
      assert.equal(audioUploaded.status(), 201);
      const audioPage = await context.newPage(), audioErrors = [], audioRequests = [];
      audioPage.on('pageerror', error => audioErrors.push(error.message));
      audioPage.on('request', request => audioRequests.push(new URL(request.url()).pathname));
      await audioPage.goto(library);
      await expandDirectory(audioPage, 2);
      await audioPage.getByRole('button', { name: '试听.wav', exact: true }).click();
      await expect(audioPage.locator('.practice-audio-preview').getByRole('button', { name: '播放', exact: true })).toBeEnabled();
      assert.deepEqual(audioRequests.filter(path => /musicxml-engine|alphaTab\.|soundfont|\.sf2$/.test(path)), [], 'ordinary audio must not load the optional XML engine');
      assert.deepEqual(audioErrors, [], 'the audio document must finish without page errors');
      await mkdir(evidence, { recursive: true });
      await audioPage.screenshot({ path: `${evidence}/audio-without-xml-engine.png` });
      await writeFile(`${evidence}/timings.json`, JSON.stringify({
        engine, browserVersion: context.browser()?.version(), persistentProfile: true,
        scope: 'Owned 48-measure fixture, installed application bundle; local integration timing, not a physical-device budget', timings,
      }, null, 2));
    });
  });
}
