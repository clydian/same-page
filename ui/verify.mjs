import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const before = process.env.SIGHT_UI_BEFORE === '1';
const root = process.cwd(), output = resolve(process.argv[2] ?? '/tmp/sight-choral/frames');
const { createVisualFixtureSession } = await import(pathToFileURL(`${root}/visual-report/fixtures.mjs`));
const { startProductionPreview } = await import(pathToFileURL(`${root}/visual-report/production-preview.mjs`));
const { chromium, expect } = createRequire(`${root}/package.json`)('@playwright/test');
const questionPath = '/api/choirs/visual-choir/sight-singing/questions';
const challengePath = '/choirs/visual-choir/sight-singing';
const pitch = (step, octave, chord = false) => `<note>${chord ? '<chord/>' : ''}<pitch><step>${step}</step><octave>${octave}</octave></pitch><duration>2</duration><type>half</type></note>`;
const parts = [
  { name:'Soprano', bars:[pitch('G', 5) + pitch('A', 5), pitch('C', 5) + pitch('B', 4)] },
  { name:'Alto', bars:[pitch('C', 4) + pitch('E', 4, true) + pitch('D', 4), pitch('F', 4) + pitch('G', 4)] },
  { name:'Tenor', bars:[pitch('C', 3) + pitch('E', 3), pitch('F', 3) + pitch('G', 3)] },
];
const keyAndTempo = '<attributes><divisions>1</divisions><key><fifths>0</fifths><mode>major</mode></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><direction><sound tempo="120"/></direction>';
const xml = `<?xml version="1.0"?><score-partwise version="4.0"><work><work-title>Choir rehearsal</work-title></work><part-list>
${parts.map(({ name }, i) => `<score-part id="P${i + 1}"><part-name>${name}</part-name></score-part>`).join('')}</part-list>
${parts.map(({ bars }, i) => `<part id="P${i + 1}">${bars.map((notes, b) => `<measure number="${b + 1}">${b === 0 ? keyAndTempo : ''}${notes}</measure>`).join('')}</part>`).join('')}</score-partwise>`;
const translations = {
  zh: { title: '合唱练习样例', create: '新建题目', name: '题目名称', source: '云盘乐谱', first: '起始小节', publish: '发布到云盘', edit: '编辑题目', voice: '我要唱的声部', settings: /练习设置/, backing: /其他声部伴奏/, drone: /持续主音/, hint: /戴耳机/, close: '关闭', start: '开始唱', count: /预备/, target: '目标 C4 / E4', sung: '唱出 E4', result: '本次反馈', answer: '回听时叠加钢琴答案', history: '我的练习记录', back: '返回题目列表', score: '75 分', flat: '偏高', good: '准确' },
  en: { title: 'Choir rehearsal sample', create: 'New question', name: 'Question name', source: 'Drive score', first: 'First measure', publish: 'Publish to drive', edit: 'Edit question', voice: 'Part to sing', settings: /Practice setup/, backing: /Other parts/, drone: /Tonic drone/, hint: /Wear headphones/, close: 'Close', start: 'Start singing', count: /Get ready/, target: 'Target C4 / E4', sung: 'Sung E4', result: 'Take feedback', answer: 'Hear the piano answer with my recording', history: 'My practice history', back: 'Back to questions', score: '75 points', flat: 'Sharp', good: 'In tune' },
};

function installCapture() {
  const worklets = new WeakMap();
  const nativeWorklet = window.AudioWorkletNode, nativeContext = window.AudioContext;
  const nativeStart = window.OscillatorNode.prototype.start;
  window.captureClock = [];
  window.scheduledPitches = [];
  window.OscillatorNode.prototype.start = function (time) {
    window.scheduledPitches.push({ frequency: this.frequency.value, time, context: this.context.constructor.name });
    return nativeStart.call(this, time);
  };
  window.AudioWorkletNode = class extends nativeWorklet {
    constructor(context, name, options) {
      super(context, name, options);
      worklets.set(this, options.processorOptions);
      window.captureClock.push(options.processorOptions);
    }
  };
  window.AudioContext = class extends nativeContext {
    constructor() { super({ sampleRate: 48000 }); }
    createMediaStreamSource() {
      // The real AudioWorklet consumes this labelled signal. Native fake GUM
      // supplies the permission and track lifecycle; there is no speaker bleed.
      const buffer = this.createBuffer(1, 7 * this.sampleRate, this.sampleRate);
      const samples = buffer.getChannelData(0);
      for (let i = 0; i < samples.length; i++) {
        const time = i / this.sampleRate - 2;
        const withinNote = time - Math.floor(time);
        const pitch = withinNote >= .07 && withinNote <= .95 ? [64.35, 62, 65, 67][Math.floor(time)] ?? null : null;
        if (pitch !== null) samples[i] = .35 * Math.sin(2 * Math.PI * 440 * 2 ** ((pitch - 69) / 12) * time);
      }
      const source = this.createBufferSource();
      source.buffer = buffer;
      const connect = source.connect.bind(source);
      source.connect = node => {
        const result = connect(node), frame = worklets.get(node).startFrame;
        source.start(frame === undefined ? 0 : frame / this.sampleRate);
        return result;
      };
      return source;
    }
  };
}

async function check(browser, app, { language, mobile, theme }) {
  const labels = translations[language], name = `${mobile ? 'phone' : 'desktop'}-${language}-${theme}`;
  const viewport = mobile ? { width: 390, height: 844 } : { width: 1200, height: 1030 };
  const locale = language === 'zh' ? 'zh-CN' : 'en-US';
  const published = new Map(), writes = [];
  const fixture = createVisualFixtureSession({ id: 'reader-practice-sight-singing', practiceXml: xml, buildId: app.buildId });
  async function pageFor(identity) {
    const page = await browser.newPage({ viewport, locale, colorScheme: theme, serviceWorkers: 'block', permissions: ['microphone'] });
    await page.addInitScript(installCapture);
    await page.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url()), method = request.method();
      if (url.origin !== app.origin) return route.abort('blockedbyclient');
      if (!url.pathname.startsWith('/api/')) return route.continue();
      if (url.pathname === questionPath) return route.fulfill({ json: { questions: [...published.values()] } });
      if (url.pathname.startsWith(`${questionPath}/`) && method === 'PUT') {
        const id = url.pathname.split('/').at(-1);
        assert.equal(identity, 'admin');
        assert.equal(request.headers()['x-same-page-owner-user-id'], 'visual-user-admin');
        const { expectedVersion, ...data } = request.postDataJSON();
        assert.equal(expectedVersion, null);
        assert.deepEqual(Object.keys(data).sort(), ['attachmentId', 'first', 'last', 'revision', 'scoreId', 'title']);
        const question = { ...data, id, version: 1 };
        published.set(id, question);
        writes.push(url.pathname);
        return route.fulfill({ json: { question } });
      }
      return route.fulfill(fixture.resolve({ method, pathname: url.pathname, identity, cookie: '' }));
    });
    return page;
  }
  const owner = await pageFor('admin');
  let member;
  try {
    await owner.goto(`${app.origin}${challengePath}`);
    await owner.getByRole('button', { name: labels.create, exact: true }).click();
    await owner.getByLabel(labels.name).fill(labels.title);
    await owner.getByLabel(labels.source).selectOption('visual-score');
    await expect(owner.getByLabel(labels.first)).toHaveValue('0');
    await expect(owner.getByLabel(labels.voice)).toHaveCount(0);
    await expect(owner.getByRole('button', { name: labels.publish, exact: true })).toBeEnabled();
    await owner.screenshot({ path: `${output}/${name}-publish.png`, fullPage: true });
    await owner.getByRole('button', { name: labels.publish, exact: true }).click();
    await owner.getByRole('button', { name: labels.start, exact: true }).waitFor();
    assert.equal(writes.length, 1);
    member = await pageFor('member');
    await member.goto(`${app.origin}${challengePath}`);
    await member.getByRole('button', { name: labels.title, exact: true }).click();
    await expect(member.getByRole('button', { name: labels.edit, exact: true })).toHaveCount(0);
    const notation = member.locator('.challenge-notation');
    await notation.locator('svg').first().waitFor();
    const score = await notation.boundingBox();
    const startButton = member.getByRole('button', { name: labels.start, exact: true });
    const startLayout = await startButton.boundingBox();
    if (!before) {
      assert.ok(score.y + score.height < startLayout.y && startLayout.y + startLayout.height < viewport.height, { score, startLayout });
      await expect(member.getByRole('dialog')).toHaveCount(0);
      await expect(member.getByText(labels.hint)).toHaveCount(0);
      assert.ok(await member.evaluate(() => document.documentElement.scrollWidth === window.innerWidth));
    }
    await member.screenshot({ path: `${output}/${name}-ready.png` });
    if (before) {
      await member.getByLabel(labels.voice).selectOption({ label: 'Alto' });
      await member.locator('.challenge-backing summary').click();
      await member.screenshot({ path: `${output}/${name}-settings.png`, fullPage: true });
      await member.getByRole('checkbox', { name: labels.drone }).check();
      await member.getByRole('checkbox', { name: 'Soprano' }).check();
      await member.getByRole('checkbox', { name: 'Tenor' }).check();
    } else {
      const trigger = member.getByRole('button', { name: labels.settings });
      await trigger.focus();
      await member.keyboard.press('Enter');
      const dialog = member.getByRole('dialog', { name: labels.settings });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText(labels.hint)).toHaveCount(0);
      await member.keyboard.press('Escape');
      await expect(trigger).toBeFocused();
      await trigger.click();
      await dialog.getByRole('radio', { name: 'Alto', exact: true }).check();
      await dialog.getByRole('checkbox', { name: labels.backing }).check();
      await expect(dialog.getByText('Soprano · Tenor', { exact: true })).toBeVisible();
      await expect(dialog.getByText(labels.hint)).toBeVisible();
      await dialog.getByRole('radio', { name: 'Tenor', exact: true }).check();
      await expect(dialog.getByText('Soprano · Alto', { exact: true })).toBeVisible();
      await dialog.getByRole('radio', { name: 'Alto', exact: true }).check();
      await dialog.getByRole('checkbox', { name: labels.backing }).uncheck();
      await expect(dialog.getByText(labels.hint)).toHaveCount(0);
      await dialog.getByRole('checkbox', { name: labels.drone }).check();
      await expect(dialog.getByText(labels.hint)).toBeVisible();
      await dialog.getByRole('checkbox', { name: labels.backing }).check();
      await member.screenshot({ path: `${output}/${name}-settings.png` });
      await dialog.getByRole('button', { name: labels.close, exact: true }).click();
      await expect(trigger).toBeFocused();
    }
    await startButton.click();
    await expect(member.locator('.challenge-stage')).toContainText(labels.count);
    await expect(member.locator('.challenge-notation-beat')).toBeVisible();
    await member.getByText(labels.sung, { exact: true }).waitFor();
    if (!before) {
      const chart = member.locator('.challenge-graph');
      await expect(chart.getByText(labels.target, { exact: true })).toBeVisible();
      await expect(chart.locator('.challenge-pitch-axis')).toContainText('C4');
      await expect(chart.locator('.challenge-pitch-axis')).toContainText('E4');
      await expect(chart.locator('.challenge-time-axis')).toContainText('0:04');
      const chartLayout = await chart.boundingBox();
      assert.ok(chartLayout.y + chartLayout.height < viewport.height, chartLayout);
    }
    await member.screenshot({ path: `${output}/${name}-chord.png` });
    await member.getByText(language === 'zh' ? '唱出 F4' : 'Sung F4', { exact: true }).waitFor();
    await member.waitForTimeout(350);
    await member.screenshot({ path: `${output}/${name}-sing.png` });
    const result = member.getByRole('region', { name: labels.result });
    await expect(member.locator(".challenge-stage").getByText(labels.score, { exact: true })).toBeVisible();
    assert.deepEqual(await result.locator('[data-result]').allTextContents(), [labels.flat, labels.good, labels.good, labels.good]);
    assert.deepEqual(await result.locator('tbody .challenge-note-replay').allTextContents(), ['E4', 'D4', 'F4', 'G4']);
    const schedule = await member.evaluate(() => ({ clock: window.captureClock, pitches: window.scheduledPitches }));
    assert.equal(schedule.clock.length, 1);
    const clock = schedule.clock[0];
    const midi = hz => Math.round(69 + 12 * Math.log2(hz / 440));
    const at = (clock.startFrame + clock.beats * clock.beatFrames) / 48000;
    assert.deepEqual(schedule.pitches.map(tone => [midi(tone.frequency), Math.round((tone.time - at) * 1000)]), [[48,0],[79,0],[81,1000],[72,2000],[71,3000],[48,0],[52,1000],[53,2000],[55,3000]]);
    const audio = result.locator('audio');
    const originalUrl = await audio.getAttribute('src');
    await result.getByRole('checkbox', { name: labels.answer }).check();
    await expect(audio).not.toHaveAttribute('src', originalUrl);
    const comparison = await audio.evaluate(async (node, rawUrl) => {
      const read = async url => new DataView(await (await fetch(url)).arrayBuffer());
      const raw = await read(rawUrl), mix = await read(node.src);
      const sampleRate = mix.getUint32(24, true);
      const amplitude = (note, offset) => {
        const frequency = 440 * 2 ** ((note - 69) / 12);
        let sine = 0, cosine = 0;
        for (let i = Math.round(offset * sampleRate); i < (offset + .1) * sampleRate; i++) {
          const signal = (mix.getInt16(44 + i * 2, true) - .78 * raw.getInt16(44 + i * 2, true)) / 32768;
          const angle = 2 * Math.PI * frequency * i / sampleRate;
          sine += signal * Math.sin(angle); cosine += signal * Math.cos(angle);
        }
        return Math.hypot(sine, cosine);
      };
      return { sameLength: raw.byteLength === mix.byteLength, sampleRate, e: amplitude(64, .2), c: amplitude(60, .2), d: amplitude(62, 1.2) };
    }, originalUrl);
    assert.ok(comparison.sameLength && comparison.sampleRate === 48000 && comparison.e > 8 * comparison.c && comparison.d > 20, comparison);
    await result.locator('tbody .challenge-note-replay').nth(1).click();
    await expect.poll(() => audio.evaluate(node => node.currentTime)).toBeGreaterThan(.99);
    await expect(result.locator('tbody tr[data-active=true]')).toHaveCount(1);
    await member.screenshot({ path: `${output}/${name}-review.png`, fullPage: true });
    await member.getByRole('button', { name: labels.back, exact: true }).click();
    await member.reload();
    const history = member.locator('section').filter({ has: member.getByRole('heading', { name: labels.history, exact: true }) });
    await history.locator('summary').filter({ hasText: labels.title }).click();
    await expect(history.getByText('Alto', { exact: true })).toBeVisible();
    await expect(history.getByText(labels.score, { exact: true })).toBeVisible();
    await expect(history.locator('audio')).toHaveCount(0);
    await expect(history.getByText(labels.flat, { exact: true })).toBeVisible();
    await member.screenshot({ path: `${output}/${name}-history.png`, fullPage: true });
    console.log(JSON.stringify({ name, scoreTop: Math.round(score.y), scoreHeight: Math.round(score.height), startBottom: Math.round(startLayout.y + startLayout.height), comparison, schedule: schedule.pitches.map(tone => midi(tone.frequency)) }));
  } finally { await member?.close(); await owner.close(); }
}

await mkdir(output, { recursive: true });
const app = await startProductionPreview();
const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
try {
  for (const config of [{ language: 'zh', mobile: true, theme: 'light' }, { language: 'en', mobile: true, theme: 'dark' },
    { language: 'zh', mobile: false, theme: 'dark' }, { language: 'en', mobile: false, theme: 'light' }]) await check(browser, app, config);
} finally { await browser.close(); await app.stop(); }
