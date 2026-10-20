import assert from 'node:assert/strict';
import test from 'node:test';
import {createServer} from 'node:http';
import {mkdtemp, rm, mkdir, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {chromium, expect} from '@playwright/test';
import {observeBrowserTargets} from './ctrl-target-observer.mjs';

// Pure HTML isolates native new-tab initialization from Same Page, its worker,
// storage, PDF engine and touch handlers. Every iteration must pass; no retries.
// Set SAME_PAGE_MODIFIER_CHANNEL=shell to reproduce the upstream baseline.
test('native modifier tabs initialize repeatedly in Chromium', {timeout: 120_000}, async t => {
  const repetitions = Number(process.env.SAME_PAGE_MODIFIER_REPETITIONS ?? 60);
  assert.ok(Number.isSafeInteger(repetitions) && repetitions > 0 && repetitions <= 120, 'repetitions must be 1..120');
  const shell = process.env.SAME_PAGE_MODIFIER_CHANNEL === 'shell';
  const events = [];
  const profile = await mkdtemp(path.join(tmpdir(), 'same-page-native-tabs-'));
  const server = createServer((request, response) => {
    response.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
    response.end(request.url === '/target'
      ? '<!doctype html><title>Native target</title><h1>Native target ready</h1>'
      : '<!doctype html><title>Native opener</title><a href="/target">Open target</a>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let context, observer, completed = 0;
  t.after(async () => {
    try {
      await observer?.snapshot().catch(error => events.push({type: 'snapshot-error', message: error.message}));
      await observer?.close().catch(error => events.push({type: 'observer-close-error', message: error.message}));
      const directory = 'artifacts/verification/modifier-tab-readiness';
      await mkdir(directory, {recursive: true});
      const evidence = {backend: shell ? 'headless-shell' : 'chromium', completed, events};
      await writeFile(`${directory}/${shell ? 'shell' : 'chromium'}.json`, JSON.stringify(evidence, null, 2));
      console.log('NATIVE_TAB_EVIDENCE', JSON.stringify({...evidence, events: events.filter(event => ['cdp-targets', 'cdp-frame-tree', 'cdp-runtime', 'cdp-inspection-error', 'snapshot-error'].includes(event.type))}));
    } finally {
      await context?.close();
      await new Promise(resolve => server.close(resolve));
      await rm(profile, {recursive: true, force: true});
    }
  });
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  context = await chromium.launchPersistentContext(profile, {
    headless: true, ...(shell ? {} : {channel: 'chromium'}), ...(executablePath ? {executablePath} : {}),
    viewport: {width: 390, height: 844}, hasTouch: true,
  });
  observer = await observeBrowserTargets(context, (type, detail) => events.push({type, ...detail}));
  const page = await context.newPage();
  await page.goto(origin);
  const initialPages = context.pages().length;
  for (let iteration = 0; iteration < repetitions; iteration++) {
    const [other] = await Promise.all([
      context.waitForEvent('page', {timeout: 5_000}),
      page.getByRole('link', {name: 'Open target', exact: true}).click({modifiers: ['Control']}),
    ]);
    // Native modifier activation may intentionally disown window.opener.
    assert.equal(context.pages().length, initialPages + 1);
    await expect(other).toHaveURL(`${origin}/target`);
    await expect(other.getByRole('heading', {name: 'Native target ready', exact: true})).toBeVisible();
    await other.close();
    await expect(page).toHaveURL(origin + '/');
    completed++;
    if (completed % 10 === 0) console.log("NATIVE_TAB_PROGRESS", completed);
  }
});
