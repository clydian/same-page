import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { basename, resolve } from 'node:path';

const root = process.cwd();
const output = resolve(process.argv[2] ?? '/tmp/sight-integrated/screens');
const require = createRequire(`${root}/package.json`);
const { chromium, expect } = require('@playwright/test');
const { strToU8, zipSync } = require('fflate');
const { createVisualFixtureSession } = await import(pathToFileURL(`${root}/visual-report/fixtures.mjs`));
const { startProductionPreview } = await import(pathToFileURL(`${root}/visual-report/production-preview.mjs`));
const questionPath = '/api/choirs/visual-choir/sight-singing/questions';
const challengePath = '/choirs/visual-choir/sight-singing';
const choir = [
  { name: 'Soprano', notes: [79, 81, 72, 71, 74, 76, 77, 76], clef: 'G' },
  { name: 'Alto', notes: [64, 62, 65, 67, 69, 67, 65, 64], clef: 'G' },
  { name: 'Tenor', notes: [60, 57, 57, 55, 60, 62, 62, 60], clef: 'G' },
  { name: 'Bass', notes: [48, 50, 53, 55, 48, 52, 53, 48], clef: 'F' },
];
const names = ['C', 'C', 'D', 'E', 'E', 'F', 'F', 'G', 'A', 'A', 'B', 'B'];
const accidental = new Map([[1, 1], [3, -1], [6, 1], [8, -1], [10, -1]]);
function note(midi, chord = false) {
  const semitone = midi % 12;
  return `<note>${chord ? '<chord/>' : ''}<pitch><step>${names[semitone]}</step>${accidental.has(semitone) ? `<alter>${accidental.get(semitone)}</alter>` : ''}<octave>${Math.floor(midi / 12) - 1}</octave></pitch><duration>2</duration><type>half</type></note>`;
}
function musicXml({ count, tempo, title, variation = false }) {
  return `<?xml version="1.0"?><score-partwise version="4.0"><work><work-title>${title}</work-title></work><part-list>
${choir.map(({ name }, i) => `<score-part id="P${i + 1}"><part-name>${variation && i === 0 ? 'Replaced original track' : name}</part-name></score-part>`).join('')}</part-list>
${choir.map(({ notes, clef }, i) => `<part id="P${i + 1}">${Array.from({ length: count }, (_, bar) => `<measure number="${bar + 1}">${bar === 0 ? `<attributes><divisions>1</divisions><key><fifths>0</fifths><mode>major</mode></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>${clef}</sign><line>${clef === 'G' ? 2 : 4}</line></clef></attributes><direction><sound tempo="${tempo}"/></direction>` : ''}${i === 1 && bar === 0 ? note(60) + note(notes[0], true) : note(notes[2 * bar % notes.length])}${note(notes[(2 * bar + 1) % notes.length])}</measure>`).join('')}</part>`).join('')}</score-partwise>`;
}
const sourceXml = musicXml({ count: 6, tempo: 120, title: 'Choir rehearsal library score' });
const replacedXml = musicXml({ count: 3, tempo: 120, title: 'Edited library item', variation: true });
const directXml = musicXml({ count: 8, tempo: 240, title: 'Standalone choir excerpt' });
const directMxl = Buffer.from(zipSync({
  mimetype: [strToU8('application/vnd.recordare.musicxml'), { level: 0 }],
  'META-INF/container.xml': strToU8('<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="score.musicxml" media-type="application/vnd.recordare.musicxml+xml"/></rootfiles></container>'),
  'score.musicxml': strToU8(directXml),
}));
const labels = {
  zh: {
    title: '合唱练习 · 和弦找音', uploadTitle: '独立合唱片段 · 长谱', create: '新建题目', name: '题目名称', sourceMode: '题目谱源',
    upload: '上传 MusicXML / MXL', source: '云盘乐谱', first: '起始小节', last: '结束小节', publishQuestion: '发布到云盘', replace: '保存为新版', edit: '编辑题目', voice: '我要唱的声部',
    backing: '其他声部伴奏', drone: /持续主音/, hint: /戴耳机/, start: '开始唱', count: /预备/, target: '目标 C4 / E4', sung: '唱出 E4', result: '本次反馈',
    replay: '回听演唱与钢琴答案', pause: '暂停回听', position: '回听进度', publishRun: '向本云盘成员发布成绩', confirm: '确认成绩', publish: '确认并发布', confirmed: '成绩已确认', published: '成绩已发布',
    back: '返回题目列表', retry: '再试一次', flat: '偏高', good: '准确', seventyFive: '75 分', longScore: '94 分',
  },
  en: {
    title: 'Choir rehearsal · chord matching', uploadTitle: 'Standalone ensemble excerpt · full score', create: 'New question', name: 'Question name', sourceMode: 'Question score source',
    upload: 'Upload MusicXML / MXL', source: 'Drive score', first: 'First measure', last: 'Last measure', publishQuestion: 'Publish to drive', replace: 'Save as new version', edit: 'Edit question', voice: 'Part to sing',
    backing: 'Other parts', drone: /Tonic drone/, hint: /Wear headphones/, start: 'Start singing', count: /Get ready/, target: 'Target C4 / E4', sung: 'Sung E4', result: 'Take feedback',
    replay: 'Play recording with piano', pause: 'Pause playback', position: 'Playback position', publishRun: 'Publish score to this drive’s members', confirm: 'Confirm score', publish: 'Confirm and publish', confirmed: 'Score confirmed', published: 'Score published',
    back: 'Back to questions', retry: 'Try again', flat: 'Sharp', good: 'In tune', seventyFive: '75 points', longScore: '94 points',
  },
};

function installCapture() {
  const worklets = new WeakMap();
  const nativeWorklet = window.AudioWorkletNode, nativeContext = window.AudioContext;
  const nativeStart = window.OscillatorNode.prototype.start;
  window.captureClock = [];
  window.scheduledPitches = [];
  window.audioProbe = [];
  window.lastWorkletMessages = [];
  window.audioContexts = [];
  window.qaToneSequence = [64.35, 62, 65, 67, 69, 67, 65, 64];
  window.OscillatorNode.prototype.start = function (time) {
    window.scheduledPitches.push({ frequency: this.frequency.value, time, context: this.context.constructor.name });
    return nativeStart.call(this, time);
  };
  window.AudioWorkletNode = class extends nativeWorklet {
    constructor(context, name, options) {
      super(context, name, options);
      worklets.set(this, options.processorOptions);
      window.captureClock.push(options.processorOptions);
      this.port.addEventListener('message', ({ data }) => {
        window.lastWorkletMessages.push(data.samples ? [data.samples.length, data.done] : data.count);
      });
    }
  };
  window.AudioContext = class extends nativeContext {
    constructor() { super({ sampleRate: 48000 }); window.audioContexts.push(this); }
    createMediaStreamSource() {
      // Real AudioWorklet and capture callbacks get calibrated synthetic samples.
      // GUM tracks are native Chromium fake media. This excludes acoustic bleed.
      const context = this;
      const source = context.createBufferSource();
      const connect = source.connect.bind(source);
      source.connect = node => {
        const { beatFrames, beats, durationFrames, startFrame } = worklets.get(node);
        const countFrames = beatFrames * beats;
        const noteFrames = beatFrames * 2;
        const buffer = context.createBuffer(1, countFrames + durationFrames + beatFrames, context.sampleRate);
        const samples = buffer.getChannelData(0);
        const tones = window.qaToneSequence;
        for (let i = 0; i < durationFrames; i++) {
          const phase = i % noteFrames / noteFrames;
          if (phase < .07 || phase > .95) continue;
          const index = Math.floor(i / noteFrames);
          const midi = index ? Math.round(tones[index % tones.length]) : tones[0];
          const t = i / context.sampleRate;
          samples[i + countFrames] = .35 * Math.sin(2 * Math.PI * 440 * 2 ** ((midi - 69) / 12) * t);
        }
        source.buffer = buffer;
        const result = connect(node);
        source.start(startFrame === undefined ? 0 : startFrame / context.sampleRate);
        source.onended = () => window.audioProbe.push({ end: context.currentTime, length: buffer.duration, time: Date.now() });
        return result;
      };
      return source;
    }
  };
}

function isolatedApi(app, record) {
  const fixture = createVisualFixtureSession({ id: 'reader-practice-sight-singing', practiceXml: sourceXml, buildId: app.buildId });
  const current = new Map(), versions = new Map(), results = new Map();
  const json = (route, value, status = 200) => route.fulfill({ status, json: value, headers: { 'cache-control': 'no-store' } });
  const mediaType = name => name.endsWith('.mxl') ? 'application/vnd.recordare.musicxml' : 'application/vnd.recordare.musicxml+xml';
  let originalRevision = 1, originalBytes = Buffer.from(sourceXml);
  const versionKey = (id, version) => `${id}:${version}`;
  async function dispatch(route, identity) {
    const request = route.request(), url = new URL(request.url()), method = request.method();
    const pathname = url.pathname;
    if (url.origin !== app.origin) return route.abort('blockedbyclient');
    if (!pathname.startsWith('/api/')) return route.continue();
    if (pathname === questionPath) {
      assert.equal(method, 'GET');
      assert.equal(request.headers()['x-same-page-sight-singing'], '2');
      return json(route, { questions: [...current.values()] });
    }
    if (pathname.startsWith(`${questionPath}/`)) {
      const [id, endpoint] = pathname.slice(questionPath.length + 1).split('/');
      if (!endpoint && method === 'PUT') {
        assert.equal(identity, 'admin');
        assert.equal(request.headers()['x-same-page-owner-user-id'], 'visual-user-admin');
        const contentType = request.headers()['content-type'];
        let fields;
        let bytes;
        let name;
        if (contentType.startsWith('multipart/form-data')) {
          const parsed = await new Request('http://fixture.invalid', { method: 'POST', headers: { 'content-type': contentType }, body: request.postDataBuffer() }).formData();
          fields = JSON.parse(parsed.get('fields'));
          assert.deepEqual(Object.keys(fields).sort(), current.has(id)
            ? ['expectedEditToken', 'expectedVersion', 'first', 'last', 'title']
            : ['expectedVersion', 'first', 'last', 'title']);
          const file = parsed.get('file');
          name = file.name;
          bytes = Buffer.from(await file.arrayBuffer());
          assert.equal(name, 'choir-excerpt.mxl');
          assert.deepEqual(bytes, directMxl);
        } else {
          fields = request.postDataJSON();
          if (fields.reuseSnapshot) {
            ({ bytes, name } = versions.get(versionKey(id, fields.expectedVersion)));
          } else {
            assert.equal(fields.scoreId, 'visual-score');
            assert.equal(fields.attachmentId, 'practice-xml');
            assert.equal(fields.revision, originalRevision);
            name = '声部练习版.musicxml';
            bytes = originalBytes;
          }
        }
        const previous = current.get(id);
        if (fields.expectedVersion !== (previous?.version ?? null) ||
            (previous && fields.expectedEditToken !== previous.snapshot.editToken)) {
          return json(route, { error: 'question_conflict' }, 409);
        }
        const titleOnly = fields.reuseSnapshot && fields.first === previous.first && fields.last === previous.last;
        const question = {
          id, title: fields.title, first: fields.first, last: fields.last,
          version: titleOnly ? previous.version : (previous?.version ?? 0) + 1,
          scoreId: fields.reuseSnapshot ? previous.scoreId : fields.scoreId ?? null,
          attachmentId: fields.reuseSnapshot ? previous.attachmentId : fields.attachmentId ?? null,
          revision: fields.reuseSnapshot ? previous.revision : fields.revision ?? null,
          snapshot: { name, editToken: crypto.randomUUID() },
        };
        current.set(id, question);
        versions.set(versionKey(id, question.version), { question, bytes: Buffer.from(bytes), name });
        record.push({ type: 'save', id, version: question.version, source: contentType.startsWith('multipart/form-data') ? 'upload' : fields.reuseSnapshot ? 'snapshot' : 'drive', first: fields.first, last: fields.last });
        return json(route, { question });
      }
      if (endpoint === 'score' && method === 'GET') {
        const version = Number(url.searchParams.get('version')) || current.get(id)?.version;
        const saved = versions.get(versionKey(id, version));
        record.push({ type: 'snapshot', identity, id, version, exists: Boolean(saved) });
        if (!saved) return json(route, { error: 'question_not_found' }, 404);
        return route.fulfill({ status: 200, body: saved.bytes, contentType: mediaType(saved.name), headers: { 'cache-control': 'no-store' } });
      }
      if (endpoint === 'results' && method === 'POST') {
        const fields = request.postDataJSON();
        assert.deepEqual(Object.keys(fields).sort(), ['id', 'score', 'version', 'voiceId', 'voiceName']);
        assert.equal(request.headers()['x-same-page-owner-user-id'], `visual-user-${identity}`);
        assert.ok(versions.has(versionKey(id, fields.version)));
        assert.ok(Number.isInteger(fields.score) && fields.score >= 0 && fields.score <= 100);
        const result = { ...fields, questionId: id, displayName: identity === 'member' ? '周宁' : '管理员', own: true };
        results.set(fields.id, { result, identity });
        record.push({ type: 'publish', id, version: fields.version, score: fields.score, voice: fields.voiceName });
        return json(route, { result });
      }
      if (endpoint === 'results' && method === 'GET') {
        const version = Number(url.searchParams.get('version'));
        const visible = [...results.values()].filter(({ result }) => result.questionId === id && result.version === version)
          .map(entry => ({ ...entry.result, own: entry.identity === identity }));
        record.push({ type: 'readScores', id, version, count: visible.length });
        return json(route, { results: visible });
      }
      throw new Error(`Unhandled sight-singing route: ${method} ${pathname}`);
    }
    const response = fixture.resolve({ method, pathname, identity, cookie: '' });
    if (method === 'GET' && pathname.includes('/attachments') && pathname.includes('visual-choir')) {
      if (pathname.endsWith('/practice-xml/file')) {
        record.push({ type: 'readLibraryXml', identity, revision: originalRevision });
        return route.fulfill({ ...response, body: originalBytes, headers: { ...response.headers, 'X-Attachment-Revision': String(originalRevision) } });
      }
      if (originalRevision !== 1 && pathname.endsWith('/attachments')) {
        const old = JSON.parse(response.body);
        return json(route, { attachments: old.attachments.map(file => ({ ...file, revision: originalRevision })) });
      }
      if (originalRevision !== 1 && pathname.endsWith('/practice-xml')) {
        const old = JSON.parse(response.body);
        return json(route, { attachment: { ...old.attachment, revision: originalRevision } });
      }
    }
    return route.fulfill(response);
  }
  return { current, versions, results, dispatch, replaceOriginal() { originalRevision++; originalBytes = Buffer.from(replacedXml); } };
}

const viewports = [
  { language: 'zh', mobile: true, theme: 'light', full: true },
  { language: 'en', mobile: true, theme: 'dark', full: false },
  { language: 'zh', mobile: false, theme: 'dark', full: false },
  { language: 'en', mobile: false, theme: 'light', full: false },
];

function questionButton(page, title) { return page.locator('.challenge-question').filter({ hasText: title }); }
function button(scope, name) { return scope.getByRole('button', { name, exact: typeof name === 'string' }); }
function checkbox(scope, name) { return scope.getByRole('checkbox', { name, exact: typeof name === 'string' }); }
const toMidi = frequency => Math.round(69 + 12 * Math.log2(frequency / 440));

async function setVoice(page, l, name) {
  const select = page.getByRole('combobox', { name: l.voice });
  if (await select.count()) await select.selectOption({ label: name });
  else {
    const radio = page.getByRole('radio', { name, exact: true });
    if (await radio.count()) await radio.check();
    else await button(page, name).click();
  }
}

async function selectFile(page, l) {
  const source = page.getByLabel(l.sourceMode, { exact: true });
  if (await source.count() && await source.evaluate(el => el.tagName === 'SELECT')) await source.selectOption({ label: l.upload });
  else {
    const radio = page.getByRole('radio', { name: l.upload, exact: true });
    if (await radio.count()) await radio.check();
    else await button(page, l.upload).click();
  }
  await page.locator('input[type=file]').setInputFiles({ name: 'choir-excerpt.mxl', mimeType: 'application/vnd.recordare.musicxml', buffer: directMxl });
}

async function openQuestion(page, l, title = l.title) {
  await questionButton(page, title).click();
  await page.locator('.challenge-notation svg').first().waitFor();
  await button(page, l.start).waitFor();
}

async function audioState(page) {
  return page.locator('.challenge-run audio').evaluateAll(nodes => nodes.map(node => ({ src: node.getAttribute('src'), paused: node.paused, time: node.currentTime, controls: node.controls })));
}

async function durableSingingState(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('same-page');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    try {
      const rows = await new Promise((resolve, reject) => {
        const req = db.transaction('system').objectStore('system').getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      return rows.filter(row => row.key.includes('sight-singing') && /take|result/.test(row.key)).map(row => {
        if (typeof row.value === 'string') {
          try { return { key: row.key, value: JSON.parse(row.value) }; } catch { return row; }
        }
        return row;
      });
    } finally { db.close(); }
  });
}

async function check(browser, app, { language, mobile, theme, full }) {
  const l = labels[language], identity = `${mobile ? 'phone' : 'desktop'}-${language}-${theme}`;
  const viewport = mobile ? { width: 390, height: 844 } : { width: 1200, height: 1030 };
  const locale = language === 'zh' ? 'zh-CN' : 'en-US';
  const record = [], locations = [], routeErrors = [], errors = [], consoleErrors = [];
  const api = isolatedApi(app, record);
  const pages = [];
  async function pageFor(kind) {
    const page = await browser.newPage({ viewport, locale, colorScheme: theme, serviceWorkers: 'block', permissions: ['microphone'], hasTouch: mobile });
    pages.push(page);
    await page.addInitScript(installCapture);
    page.on('pageerror', error => errors.push(String(error)));
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    await page.route('**/*', async route => {
      try { await api.dispatch(route, kind); }
      catch (error) { routeErrors.push(String(error)); await route.abort('failed'); }
    });
    return page;
  }
  async function frame(page, name, fullPage = false) {
    await page.evaluate(() => document.fonts.ready);
    const path = `${output}/${identity}-${name}.png`;
    await page.screenshot({ path, fullPage, animations: 'disabled' });
    locations.push({ name, path });
  }
  let step = 'starting';
  let page;
  try {
    const owner = await pageFor('admin');
    page = owner;
    step = 'publish the library selection';
    await owner.goto(`${app.origin}${challengePath}`);
    await button(owner, l.create).click();
    await owner.getByLabel(l.name, { exact: true }).fill(l.title);
    await owner.getByLabel(l.source, { exact: true }).selectOption('visual-score');
    await expect(owner.getByLabel(l.first, { exact: true })).toHaveValue('0');
    await owner.getByLabel(l.last, { exact: true }).selectOption('1');
    await frame(owner, '01-create-from-drive', true);
    await button(owner, l.publishQuestion).click();
    await button(owner, l.start).waitFor();
    const v1 = [...api.current.values()].find(q => q.title === l.title);
    assert.equal(v1.version, 1);
    assert.equal(v1.last, 1);
    const v1Baseline = api.versions.get(`${v1.id}:1`).bytes;
    api.replaceOriginal();

    step = 'open frozen version and configure';
    const member = await pageFor('member');
    page = member;
    await member.goto(`${app.origin}${challengePath}`);
    await expect(member.locator('html')).toHaveAttribute('data-ui-theme', theme);
    await questionButton(member, l.title).waitFor();
    await frame(member, '02-question-list', true);
    await openQuestion(member, l);
    const notation = member.locator('.challenge-notation');
    await expect(notation.locator('[data-challenge-part=focus]').first()).toBeVisible();
    await expect(notation.locator('[data-challenge-part=context]').first()).toBeVisible();
    assert.ok(record.some(event => event.type === 'snapshot' && event.identity === 'member' && event.version === 1));
    assert.ok(!record.some(event => event.type === 'readLibraryXml' && event.identity === 'member'));
    await expect(notation).not.toContainText('Replaced original track');
    await expect(member.getByText(l.hint)).toHaveCount(0);
    assert.equal(await member.evaluate(() => document.documentElement.scrollWidth), viewport.width);
    await expect(button(member, l.edit)).toHaveCount(0);
    assert.deepEqual(await member.getByLabel(l.voice).locator('option').allTextContents(), ['Soprano', 'Alto', 'Tenor', 'Bass']);
    await setVoice(member, l, 'Alto');
    await frame(member, '03-score-visible-settings');
    await expect(button(member, /^(?:Starting note|Preview|起音|示范)$/)).toHaveCount(0);
    await checkbox(member, l.drone).check();
    await expect(member.getByText(l.hint)).toBeVisible();
    await checkbox(member, l.drone).uncheck();
    await expect(member.getByText(l.hint)).toHaveCount(0);
    const tap = notation.locator('.challenge-notation-note[data-midi="64"][data-bar="0"][data-track="1"]').first();
    await expect(tap).toBeVisible();
    const hitNote = async note => {
      await note.scrollIntoViewIfNeeded();
      const bounds = await note.boundingBox();
      assert.ok(bounds);
      const x = bounds.x + bounds.width / 2, y = bounds.y + bounds.height / 2;
      if (mobile) await member.touchscreen.tap(x, y);
      else await member.mouse.click(x, y);
    };
    await hitNote(tap);
    await expect.poll(() => member.evaluate(() => window.scheduledPitches.length), { timeout: 2500 }).toBeGreaterThan(0);
    assert.ok((await member.evaluate(() => window.scheduledPitches.map(tone => tone.frequency))).some(frequency => toMidi(frequency) === 64));
    await expect(member.getByText(l.hint)).toBeVisible();
    await checkbox(member, l.backing).check();
    await expect(member.getByText(l.hint)).toBeVisible();
    await frame(member, '04-ensemble-and-headphone-tip', true);

    async function recordTake(captureName, scoreText) {
      const been = await member.evaluate(() => ({ clock: window.captureClock.length, pitches: window.scheduledPitches.length }));
      await button(member, l.start).click();
      await expect(member.getByText(l.count).first()).toBeVisible();
      await frame(member, `${captureName}-count-in`);
      await expect(member.locator('.challenge-graph').getByText(l.sung, { exact: true })).toBeVisible();
      await expect(member.locator('.challenge-graph').getByText(l.target, { exact: true })).toBeVisible();
      await expect(member.locator('.challenge-pitch-axis')).toContainText('E4');
      await frame(member, `${captureName}-singing`);
      await expect(member.getByText(scoreText, { exact: true }).first()).toBeVisible({ timeout: 20000 });
      const data = await member.evaluate(({ clock, pitches }) => ({ clocks: window.captureClock.slice(clock), pitches: window.scheduledPitches.slice(pitches) }), been);
      assert.equal(data.clocks.length, 1);
      const livePitches = data.pitches.filter(tone => tone.context !== 'OfflineAudioContext').map(tone => toMidi(tone.frequency));
      assert.ok(livePitches.includes(79) && livePitches.includes(48) && !livePitches.includes(64), { livePitches });
    }

    step = 'record, review synchronized mix, and publish explicitly';
    await recordTake('05', l.seventyFive);
    assert.equal(api.results.size, 0);
    await expect(checkbox(member, l.publishRun)).toBeChecked();
    await expect(notation.locator('.challenge-notation-feedback[data-status=sharp]').first()).toBeVisible();
    await frame(member, '06-score-review-default-publish', true);
    if (full) {
      await member.locator('.challenge-review-details > summary').click();
      await expect(member.locator('.challenge-review-details')).toHaveAttribute('open', '');
      await expect(member.locator('.challenge-review-details tbody tr')).toHaveCount(4);
      await frame(member, '06b-note-by-note-feedback', true);
      await member.locator('.challenge-review-details > summary').click();
    }
    await button(member, l.replay).click();
    await expect.poll(async () => (await audioState(member))[0]?.time ?? 0).toBeGreaterThan(.1);
    const media = (await audioState(member))[0];
    assert.equal(media.controls, false);
    assert.match(media.src, /^blob:/);
    const mixed = await member.locator('.challenge-run audio').first().evaluate(async node => {
      const file = new DataView(await (await fetch(node.src)).arrayBuffer());
      const sampleRate = file.getUint32(24, true);
      const angle = (midi, i) => 2 * Math.PI * 440 * 2 ** ((midi - 69) / 12) * i / sampleRate;
      const amplitude = (midi, offset) => {
        let sine = 0, cosine = 0;
        for (let i = Math.round(offset * sampleRate); i < (offset + .1) * sampleRate; i++) {
          const signal = file.getInt16(44 + i * 2, true) / 32768;
          sine += signal * Math.sin(angle(midi, i));
          cosine += signal * Math.cos(angle(midi, i));
        }
        return Math.hypot(sine, cosine);
      };
      return { sampleRate, pianoHarmonic: amplitude(76, .2), wrongChordHarmonic: amplitude(72, .2) };
    });
    assert.equal(mixed.sampleRate, 48000);
    assert.ok(mixed.pianoHarmonic > 6 && mixed.pianoHarmonic > 2 * mixed.wrongChordHarmonic, mixed);
    const nextMeasure = notation.locator('.challenge-notation-note[data-midi="65"][data-bar="1"][data-track="1"]').first();
    await hitNote(nextMeasure);
    await expect.poll(async () => (await audioState(member))[0]?.time ?? 0).toBeGreaterThan(1.8);
    await frame(member, '07-linked-score-replay', true);
    if (await button(member, l.pause).count()) await button(member, l.pause).click();
    assert.equal(api.results.size, 0);
    await button(member, l.publish).click();
    await expect.poll(() => api.results.size).toBe(1);
    await expect(member.getByText(l.published, { exact: true })).toBeVisible();
    await expect.poll(async () => (await audioState(member)).filter(media => media.src?.startsWith('blob:')).length).toBe(0);
    await expect(notation.locator('.challenge-notation-feedback')).toHaveCount(0);
    await frame(member, '08-published-summary', true);
    const publishedList = member.locator('.challenge-published-results');
    await publishedList.locator('summary').click();
    await expect(publishedList.locator('li').filter({ hasText: 'Alto' })).toContainText(l.seventyFive);
    await frame(member, '08b-member-published-score-list', true);
    if (full) {
      await button(member, l.retry).click();
      await button(member, l.start).waitFor();
      await expect(member.getByRole('combobox', { name: l.voice })).toContainText('Alto');
      assert.equal(api.results.size, 1);
      await frame(member, '08c-retake-ready', true);
    }
    [...api.results.values()].forEach(({ result }) => assert.deepEqual([result.version, result.score, result.voiceName], [1, 75, 'Alto']));

    if (full) {
      step = 'standalone upload, long score and opt-out';
      page = owner;
      await button(owner, l.back).click();
      await button(owner, l.create).click();
      await owner.getByLabel(l.name, { exact: true }).fill(l.uploadTitle);
      await selectFile(owner, l);
      await expect(owner.getByLabel(l.last, { exact: true })).toHaveValue('7');
      await frame(owner, '09-standalone-mxl-upload', true);
      await button(owner, l.publishQuestion).click();
      await button(owner, l.start).waitFor();
      const upload = [...api.current.values()].find(q => q.title === l.uploadTitle);
      assert.equal(upload.scoreId, null);
      assert.equal(upload.version, 1);
      assert.equal(upload.last, 7);

      page = member;
      await button(member, l.back).click();
      await openQuestion(member, l, l.uploadTitle);
      await setVoice(member, l, 'Alto');
      await checkbox(member, l.backing).check();
      assert.ok(await notation.evaluate(node => node.scrollHeight > node.clientHeight), 'long notation must scroll inside its viewport');
      await frame(member, '10-long-score-ready', true);
      await recordTake('11-long', l.longScore);
      const range = member.getByRole('slider', { name: l.position, exact: true });
      if (await range.count()) {
        await expect(range).toBeEnabled();
        await range.focus();
        await member.keyboard.press('Home');
        await notation.evaluate(node => { node.scrollTop = 0; });
        await member.keyboard.press('End');
        await member.keyboard.press('PageDown');
      } else {
        await button(member, l.replay).click();
        const note = notation.locator('.challenge-notation-note[data-bar="6"][data-track="1"]').first();
        await hitNote(note);
      }
      await expect.poll(async () => (await audioState(member))[0]?.time ?? 0).toBeGreaterThan(5.8);
      await expect.poll(() => notation.evaluate(node => node.scrollTop)).toBeGreaterThan(20);
      await frame(member, '12-long-score-follow-and-seek', true);
      if (await button(member, l.pause).count()) await button(member, l.pause).click();
      await checkbox(member, l.publishRun).uncheck();
      await member.evaluate(() => new Promise(resolve => {
        window.scrollTo(0, 0);
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }));
      await frame(member, '13-publication-opt-out', true);
      await button(member, l.confirm).click();
      await expect(member.getByText(l.confirmed, { exact: true })).toBeVisible();
      assert.equal(api.results.size, 1, 'unchecked confirmation must not post a score');
      await expect.poll(async () => (await audioState(member)).filter(media => media.src?.startsWith('blob:')).length).toBe(0);
      await expect(notation.locator('.challenge-notation-feedback')).toHaveCount(0);
      const durable = await durableSingingState(member);
      assert.ok(durable.length >= 2, durable);
      assert.ok(durable.every(({ value }) => value.voiceName && Number.isInteger(value.version) && Number.isInteger(value.percent)), durable);
      assert.ok(!JSON.stringify(durable).match(/\"(?:notes|frames|recording|recordingUrl|blob)\"/), durable);
      await frame(member, '14-private-confirmed-summary', true);
      await button(member, l.back).click();
      const history = member.locator('section').filter({ has: member.getByRole('heading', { name: language === 'zh' ? '我的练习记录' : 'My practice history' }) });
      await expect(history.locator('li')).toHaveCount(2);
      for (const points of [l.seventyFive, l.longScore]) {
        const row = history.locator('li', { hasText: points });
        await expect(row).toContainText('Alto · V1');
      }
      await frame(member, '14b-summary-only-practice-history', true);

      step = 'replace with MXL as version two';
      page = owner;
      await button(owner, l.back).click();
      await openQuestion(owner, l);
      await button(owner, l.edit).click();
      await selectFile(owner, l);
      await owner.getByLabel(l.last, { exact: true }).selectOption('7');
      await frame(owner, '15-update-question-version', true);
      await button(owner, l.replace).click();
      await expect.poll(() => api.current.get(v1.id).version).toBe(2);
      const revision = api.current.get(v1.id);
      assert.equal(revision.scoreId, null);
      assert.deepEqual(api.versions.get(`${v1.id}:1`).bytes, v1Baseline);
      assert.deepEqual(api.versions.get(`${v1.id}:2`).bytes, directMxl);
      page = member;
      await member.reload();
      await openQuestion(member, l);
      await expect(member.getByText(language === 'zh' ? /题目第 2 版|\bv2\b/i : /\bv2\b/i).first()).toBeVisible();
      await member.locator('.challenge-published-results summary').click();
      await expect.poll(() => record.findLast(event => event.type === 'readScores' && event.id === v1.id && event.version === 2)?.count).toBe(0);
      await expect(member.locator('.challenge-published-results li')).toHaveCount(0);
      await frame(member, '16-reopen-version-two', true);
      assert.ok(record.some(event => event.type === 'snapshot' && event.id === v1.id && event.version === 2));
      assert.ok(record.filter(event => event.type === 'publish').every(event => event.version === 1));
    }
    assert.deepEqual(routeErrors, []);
    assert.deepEqual(errors, []);
    return { identity, viewport, mixed, locations, record };
  } catch (error) {
    await page?.screenshot({ path: `${output}/${identity}-failure.png`, fullPage: true, timeout: 4000 }).catch(() => {});
    const probes = page ? await page.evaluate(() => ({
      phase: document.querySelector('.challenge-run')?.dataset.phase, visibility: document.visibilityState,
      clocks: window.captureClock, pitches: window.scheduledPitches, sourceEnds: window.audioProbe,
      contexts: window.audioContexts.map(audio => ({ state: audio.state, time: audio.currentTime })),
      messages: window.lastWorkletMessages,
    })).catch(() => null) : null;
    const details = page ? await page.locator('body').ariaSnapshot({ timeout: 4000 }).catch(() => '') : '';
    await writeFile(`${output}/${identity}-failure.json`, JSON.stringify({ step, error: String(error), record, routeErrors, errors, consoleErrors, probes, details }, null, 2));
    throw new Error(`${identity} failed at ${step}: ${String(error)}\n${routeErrors.join('\n')}`, { cause: error });
  } finally { await Promise.all(pages.map(page => page.close())); }
}

await mkdir(output, { recursive: true });
const app = process.env.SIGHT_INTEGRATED_DEV === '1'
  ? { ...await (await import(pathToFileURL(`${root}/scripts/vite-server.mjs`))).startViteServer({ script: 'dev', env: { ...process.env, SAME_PAGE_BUILD_ID: 'development' } }), buildId: 'development' }
  : await startProductionPreview();
const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
try {
  const chosen = process.env.SIGHT_INTEGRATED_ONLY ? viewports.filter(config => `${config.mobile ? 'phone' : 'desktop'}-${config.language}-${config.theme}` === process.env.SIGHT_INTEGRATED_ONLY) : viewports;
  assert.ok(chosen.length > 0);
  const checks = [];
  for (const config of chosen) checks.push(await check(browser, app, config));
  const report = {
    buildId: app.buildId,
    setup: 'Isolated production preview, Chromium, synthetic SATB scores with intercepted drive APIs and 48 kHz calibrated notes sent to the actual AudioWorklet',
    checks: checks.map(({ identity, viewport, mixed, locations, record }) => ({
      identity, viewport,
      replay: { sampleRate: mixed.sampleRate, alignedPianoOvertoneRatio: Math.round(100 * mixed.pianoHarmonic / mixed.wrongChordHarmonic) / 100 },
      publishedScores: record.filter(event => event.type === 'publish').map(({ version, score, voice }) => ({ version, score, voice })),
      questionSaves: record.filter(event => event.type === 'save').map(({ version, source, first, last }) => ({ version, source, first, last })),
      snapshotsServed: record.filter(event => event.type === 'snapshot').map(({ identity, version, exists }) => ({ identity, version, exists })),
      publishedLists: record.filter(event => event.type === 'readScores').map(({ version, count }) => ({ version, count })),
      screenshots: locations.map(({ path }) => basename(path)),
    })),
  };
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ buildId: app.buildId, viewports: checks.map(({ identity, locations }) => ({ identity, screenshots: locations.length })) }));
} finally { await browser.close(); await app.stop(); }
