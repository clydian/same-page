import assert from 'node:assert/strict';
import test from 'node:test';
import { join } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { startStorageFixture } from './storage-fixture.mjs';

const note = (step, length, type, extra = '') =>
  `<note><pitch><step>${step}</step>${step === 'F' ? '<alter>1</alter>' : ''}<octave>4</octave></pitch><duration>${length}</duration><type>${type}</type>${extra}</note>`;
const quarter = (step, extra) => note(step, 2, 'quarter', extra);
const eighth = (step, beam, extra = '') => note(step, 1, 'eighth', `<stem>up</stem><beam number="1">${beam}</beam>${extra}`);
const tie = type => `<tie type="${type}"/><notations><tied type="${type}"/></notations>`;
const slur = type => `<notations><slur type="${type}" number="1"/></notations>`;
const attributes = '<attributes><divisions>2</divisions><key><fifths>1</fifths><mode>major</mode></key><time><beats>4</beats><beat-type>4</beat-type></time></attributes>';
const xml = `<?xml version="1.0"?><score-partwise version="4.0"><part-list>
<score-part id="P1"><part-name>Tenor</part-name></score-part><score-part id="P2"><part-name>Other</part-name></score-part>
</part-list><part id="P1"><measure number="1">${attributes}<direction><sound tempo="120"/></direction>
${eighth('E', 'begin')}${eighth('F', 'end')}${eighth('G', 'begin', slur('start'))}${eighth('A', 'end', slur('stop'))}${quarter('E')}${quarter('E', tie('start'))}</measure>
<measure number="2"><print new-system="yes"/><attributes><key><fifths>2</fifths><mode>major</mode></key></attributes>
${quarter('E', tie('stop'))}${quarter('F')}${quarter('G')}${quarter('A')}</measure></part>
<part id="P2"><measure number="1">${attributes}${eighth('G', 'begin')}${eighth('A', 'end')}${quarter('A')}${quarter('A')}${quarter('A')}</measure>
<measure number="2"><print new-system="yes"/>${quarter('A')}${quarter('A')}${quarter('A')}${quarter('A')}</measure></part></score-partwise>`;

test('sight-singing result marks a unanimous beam and ties, with a keyed narrow pitch graph', { timeout: 90_000 }, async t => {
  const fixture = await startStorageFixture({ authenticated: true, previewEntry: false });
  let browser;
  t.after(async () => { try { await browser?.close(); } finally { await fixture.stop(); } });
  browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const context = await browser.newContext({
    locale: 'zh-CN', viewport: { width: 390, height: 920 }, serviceWorkers: 'block', colorScheme: 'dark',
  });
  await context.addInitScript(() => {
    const Worklet = AudioWorkletNode;
    window.AudioWorkletNode = class extends Worklet {
      constructor(audio, name, options) {
        super(audio, name, options);
        const { port1, port2 } = new MessageChannel();
        this.capturePort = port1;
        const { chunkFrames, durationFrames, recordFrom } = options.processorOptions;
        let phase = 0, offset = 0;
        window.sendTakeThrough = (until, done = false) => {
          const limit = done ? durationFrames - recordFrom : Math.round(until * audio.sampleRate - recordFrom);
          while (offset < limit) {
            const samples = Float32Array.from({ length: Math.min(chunkFrames, limit - offset) }, (_, index) => {
              const time = (offset + index + recordFrom) / audio.sampleRate;
              const midi = time < .25 ? 64 : time < .5 ? 66 : time < .75 ? 67 : time < 1 ? 64
                : time < 2.5 ? 64 : time < 3 ? 66 : time < 3.5 ? 67 : 69;
              phase += 2 * Math.PI * 440 * 2 ** ((midi - 69) / 12) / audio.sampleRate;
              return time < 0 ? 0 : .18 * (Math.sin(phase) + .4 * Math.sin(2 * phase + .4));
            });
            offset += samples.length;
            port2.postMessage({ samples, done: done && offset >= limit }, [samples.buffer]);
          }
        };
      }
      get port() { return this.capturePort; }
    };
  });
  const { email, password } = fixture.accounts[0];
  assert.equal((await context.request.post(`${fixture.origin}/api/auth/sign-in/email`, {
    headers: { origin: fixture.origin }, data: { email, password },
  })).status(), 200);
  const page = await context.newPage();
  await page.goto(`${fixture.origin}/choirs/${fixture.choirId}`);
  await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '工具', exact: true }).click();
  await page.getByRole('link', { name: '视唱练习', exact: true }).click();
  await page.getByRole('button', { name: '新建题目' }).click();
  await page.locator('select[name=source]').selectOption('upload');
  await page.locator('input[type=file]').setInputFiles({ name: 'Result Marks.musicxml', mimeType: 'application/xml', buffer: Buffer.from(xml) });
  await page.locator('input[name=title]').fill('结果谱例');
  await page.getByRole('button', { name: '发布到云盘' }).click();
  await page.getByRole('combobox', { name: '谱面范围' }).selectOption('part');
  await page.getByRole('button', { name: '练习设置' }).click();
  await page.getByRole('switch', { name: '音高轨迹' }).press('Space');
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  const run = page.locator('.challenge-run');
  const graph = page.locator('.challenge-graph');
  const pitch = graph.locator('.challenge-pitch-axis').first().getByText('E4', { exact: true });
  const row = await pitch.evaluate(label => label.style.top);
  const solfege = () => graph.locator('.challenge-solfege-axis span').evaluateAll((labels, y) =>
    labels.find(label => label.style.top === y)?.textContent, row);
  await expect.poll(solfege).toBe('La');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
  await expect(page.getByLabel('音高模式')).toHaveCount(0);
  await page.getByRole('button', { name: '开始唱', exact: true }).click();
  await expect.poll(() => page.evaluate(() => typeof window.sendTakeThrough)).toBe('function');
  await page.evaluate(() => window.sendTakeThrough(2.25));
  await expect(run).toHaveAttribute('data-phase', 'sing');
  await expect.poll(solfege).toBe('Re');
  await page.evaluate(() => window.sendTakeThrough(0, true));
  await expect(run).toHaveAttribute('data-phase', 'result');
  await expect.poll(solfege).toBe('La');
  await expect(run.locator('.challenge-score strong')).toHaveText(/88\.89/);

  const sheet = page.locator('.challenge-notation-sheet');
  const selectedNote = (bar, beat) => sheet.locator(`.challenge-notation-note[data-track="0"][data-bar="${bar}"][data-beat-index="${beat}"]`);
  const start = selectedNote(0, 5), tail = selectedNote(1, 0);
  await expect(start).toHaveAttribute('aria-description', /0/);
  await expect.poll(() => tail.getAttribute('aria-description')).toBe(await start.getAttribute('aria-description'));
  assert.ok(Math.abs((await tail.boundingBox()).y - (await start.boundingBox()).y) > 30, 'tie crosses a system');
  await expect(selectedNote(0, 3)).toHaveAttribute('aria-description', /-500/);
  await expect(sheet.locator('svg.at-surface-svg > path[data-challenge-feedback]')).toHaveCount(1);
  await expect(sheet.locator('svg.at-surface-svg g > path[data-challenge-feedback]')).toHaveCount(0);
  const evidence = process.env.SIGHT_RESULT_MARKS_EVIDENCE;
  if (evidence) await run.screenshot({ path: join(evidence, 'result-dark.png') });
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-ui-theme', 'light');
  if (evidence) await run.screenshot({ path: join(evidence, 'result-light.png') });
  await tail.focus();
  await tail.press('Enter');
  await expect(page.locator('.challenge-note-detail')).toHaveText('E4音准偏差（音分） 0');
  await expect.poll(solfege).toBe('Re');
  await page.getByRole('combobox', { name: '谱面范围' }).selectOption('full');
  await expect(sheet.locator('.challenge-notation-note[data-focused-part="false"]').first()).toBeAttached();
  await expect(sheet.locator('.challenge-notation-note[data-focused-part="false"][aria-description]')).toHaveCount(0);
});
