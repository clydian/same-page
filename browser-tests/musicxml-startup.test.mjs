import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium, webkit, expect, request } from '@playwright/test';
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
  describe(`${engine}: MusicXML startup`, { timeout: 180000 }, () => {
    let fixture, cookies, attachmentId, base;
    const name = '启动回归.musicxml';
    before(async () => {
      fixture = await startStorageFixture({ authenticated: true, previewEntry: false });
      const seed = await request.newContext();
      try {
        const login = await seed.post(`${fixture.origin}/api/auth/sign-in/email`, {
          headers: { origin: fixture.origin }, data: { email: fixture.accounts[0].email, password: fixture.accounts[0].password },
        });
        assert.equal(login.status(), 200);
        attachmentId = crypto.randomUUID();
        const bytes = musicXmlFixture(48);
        base = `/api/choirs/${fixture.choirId}/scores/${fixture.scoreId}/attachments/${attachmentId}`;
        const uploaded = await seed.post(`${fixture.origin}${base}/file?${new URLSearchParams({ name, size: String(bytes.length) })}`, { data: bytes });
        assert.equal(uploaded.status(), 201);
        const audio = practiceWave();
        const audioUploaded = await seed.post(`${fixture.origin}/api/choirs/${fixture.choirId}/scores/${fixture.scoreId}/attachments/${crypto.randomUUID()}/file?${new URLSearchParams({ name: '试听.wav', size: String(audio.length) })}`, { data: audio });
        assert.equal(audioUploaded.status(), 201);
        cookies = (await seed.storageState()).cookies;
      } finally { await seed.dispose(); }
    });
    after(async () => fixture?.stop());

    for (const scenario of ['hidden-notation', 'prepared-reopen', 'local-directory-boundary', 'audio-only']) {
      test(scenario, async t => {
        const profile = await mkdtemp(path.join(tmpdir(), `same-page-xml-startup-${engine}-${scenario}-`));
        let context;
        const directoryHeld = Promise.withResolvers(), directoryReleased = Promise.withResolvers();
        const originalRequested = Promise.withResolvers(), originalReleased = Promise.withResolvers();
        t.after(async () => {
          directoryReleased.resolve(); originalReleased.resolve();
          try { await context?.close(); } finally { await rm(profile, { recursive: true, force: true }); }
        });
        // Actual Blob originals need a persistent WebKit profile on local macOS.
        // Each scenario owns its IDB, preparation cache, routes and error list.
        context = await type.launchPersistentContext(profile, { viewport: { width: 1024, height: 768 }, serviceWorkers: 'block' });
        await context.addCookies(cookies);
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
        const evidence = `artifacts/verification/musicxml-startup/${engine}-${scenario}`, timings = [];
        await context.route(url => url.pathname === directoryPath, async route => {
          if (holdDirectory) { holdDirectory = false; directoryHeld.resolve(); await directoryReleased.promise; }
          await route.continue();
        });
        if (scenario === 'hidden-notation') await context.route(url => url.pathname === `${base}/file`, async route => {
          originalRequested.resolve(); await originalReleased.promise; await route.continue();
        });
        await withBrowserEvidence(context, evidence, async () => {
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
          const endPractice = async () => {
            await page.getByRole('button', { name: '结束练习', exact: true }).click();
            if (!await page.getByRole('button', { name: '练习谱', exact: true }).isVisible()) {
              const canvas = page.locator('canvas[data-pdf-canvas-active]').first();
              try {
                await canvas.click({ position: { x: 195, y: 350 } });
              } catch (error) {
                const geometry = await page.evaluate(() => {
                  const element = document.querySelector('canvas[data-pdf-canvas-active]');
                  if (!element) return { canvas: null };
                  const rect = element.getBoundingClientRect();
                  const shell = element.closest('.reader-shell');
                  const hit = document.elementFromPoint(rect.x + 195, rect.y + 350);
                  return {
                    canvas: rect.toJSON(), viewport: { width: innerWidth, height: innerHeight },
                    hitTag: hit?.tagName, hitsCanvas: hit === element,
                    inert: Boolean(element.closest('[inert]')),
                    visibility: getComputedStyle(element).visibility,
                    pointerEvents: getComputedStyle(element).pointerEvents,
                    readerVisibility: shell && getComputedStyle(shell).visibility,
                    practicing: shell?.hasAttribute('data-practicing'),
                    playbackView: shell?.getAttribute('data-playback-view'),
                  };
                }).catch(() => ({ unavailable: true }));
                await mkdir(evidence, { recursive: true });
                await writeFile(`${evidence}/reader-hit-target.json`, JSON.stringify(geometry, null, 2));
                throw error;
              }
            }
            // Reader chrome mounts its own directory consumer after practice ends.
            await expect(page.locator('.reader-playback-entries')).toHaveAttribute('aria-busy', 'false');
          };
          if (scenario === 'audio-only') {
            await page.goto(library);
            await expandDirectory(page, 2);
            await page.getByRole('button', { name: '试听.wav', exact: true }).click();
            await expect(page.locator('.practice-audio-preview').getByRole('button', { name: '播放', exact: true })).toBeEnabled();
            assert.deepEqual(requests.filter(path => /musicxml-engine|alphaTab\.|soundfont|\.sf2$/.test(path)), [], 'ordinary audio must not load the optional XML engine');
            await mkdir(evidence, { recursive: true });
            await page.screenshot({ path: `${evidence}/audio-without-xml-engine.png` });
          } else {
            await page.goto(library);
            await expandDirectory(page, 2);
            await open('network', scenario === 'hidden-notation');
            await expect.poll(() => hasStoredOriginal(page, attachmentId), { timeout: 20000 }).toBe(true);
            if (scenario === 'prepared-reopen') {
              await endPractice();
              await page.getByRole('button', { name: '练习谱', exact: true }).click();
              await open('prepared');
            } else if (scenario === 'local-directory-boundary') {
              await endPractice();
              // A new document has no in-memory preparation, but retains the raw record.
              await page.goto(library);
              holdDirectory = true;
              let directoryReady = false;
              const expanding = expandDirectory(page, 2).then(() => { directoryReady = true; });
              await directoryHeld.promise;
              await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
              assert.equal(directoryReady, false, 'a cached row must not finish the directory boundary while its fresh request is held');
              assert.equal(page.url(), library);
              await expect(page.getByTestId('musicxml-player')).toHaveCount(0);
              directoryReleased.resolve();
              await expanding;
              await open('local');
            }
            await mkdir(evidence, { recursive: true });
            await page.screenshot({ path: `${evidence}/online-local.png` });
          }
          assert.deepEqual(errors, [], 'the document must finish without page errors');
          await mkdir(evidence, { recursive: true });
          await writeFile(`${evidence}/timings.json`, JSON.stringify({
            engine, scenario, browserVersion: context.browser()?.version(), persistentProfile: true,
            scope: 'Owned 48-measure fixture, installed application bundle; local integration timing, not a physical-device budget', timings,
          }, null, 2));
        });
      });
    }
  });
}
