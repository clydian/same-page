import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { takes, samplesFor } from './sources.mjs';
const root = process.cwd(), out = resolve(process.argv[2] ?? '/tmp/sight-quality/output');
const { createVisualFixtureSession } = await import(pathToFileURL(`${root}/visual-report/fixtures.mjs`));
const { startProductionPreview } = await import(pathToFileURL(`${root}/visual-report/production-preview.mjs`));
const { chromium, expect } = createRequire(`${root}/package.json`)('@playwright/test');
const languages = {
  zh: { locale: 'zh-CN', create: '新建题目', name: '题目名称', score: '云盘乐谱', voice: '目标声部', save: '保存题目', start: '开始唱', count: /预备|准备/, result: '本次反馈', retry: '再试一次', statuses: ['准确', '偏高', '偏低', '错音', '未唱到', '无法判断'] },
  en: { locale: 'en-US', create: 'New question', name: 'Question name', score: 'Drive score', voice: 'Target voice', save: 'Save question', start: 'Start singing', count: /Get ready|Count in/, result: 'Take feedback', retry: 'Try again', statuses: ['In tune', 'Sharp', 'Flat', 'Wrong note', 'Missed', 'Unable to assess'] },
};
const classify = ['inTune', 'sharp', 'flat', 'wrongNote', 'missed', 'insufficientData'];
const names = ['C','C','D','D','E','F','F','G','G','A','A','B'];
const complexTypes = [[16,'half'], [8,'quarter'], [4,'eighth'], [2,'16th'], [1,'32nd']];
function xmlOf({ notes, duration }) {
  const bars = [];
  for (let bar = 0; bar < Math.ceil(duration / 2); bar++) {
    let used = 0;
    const tokens = [];
    for (const { midi, start, end } of notes.filter(note => Math.floor(note.start / 2) === bar)) {
      const length = Math.round((end - start) * 16);
      const type = complexTypes.find(([ticks]) => ticks === length)?.[1];
      assert.ok(type);
      used += length;
      tokens.push(`<note><pitch><step>${names[midi % 12]}</step><octave>${Math.floor(midi / 12) - 1}</octave></pitch><duration>${length}</duration><type>${type}</type></note>`);
    }
    for (const [ticks, type] of complexTypes) {
      while (32 - used >= ticks) { tokens.push(`<note><rest/><duration>${ticks}</duration><type>${type}</type></note>`); used += ticks; }
    }
    const lead = bar === 0 ? '<attributes><divisions>8</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><direction><sound tempo="120"/></direction>' : '';
    bars.push(`<measure number="${bar + 1}">${lead}${tokens.join('')}</measure>`);
  }
  return `<?xml version="1.0"?><score-partwise version="4.0"><work><work-title>Morning exercise</work-title></work><part-list><score-part id="P1"><part-name>Soprano</part-name></score-part></part-list><part id="P1">${bars.join('')}</part></score-partwise>`;
}
async function execute(browser, app, take, rate, config) {
  const { language = 'zh', colorScheme = 'light', mobile = false, name = '' } = config ?? {};
  const labels = languages[language];
  const page = await browser.newPage({ viewport: mobile ? {width:390,height:844} : {width:1200,height:1030}, locale: labels.locale, colorScheme, serviceWorkers:'block', permissions:['microphone'] });
  const pcm = new Float32Array(Math.round((2 + Math.ceil(take.duration / 2) * 2 + .1) * rate));
  pcm.set(samplesFor(take, rate, 2));
  const packed = Buffer.alloc(pcm.length * 2);
  for (let i = 0; i < pcm.length; i++) packed.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(pcm[i] * 32768))), i * 2);
  try {
    await page.addInitScript(({ encoded, sampleRate }) => {
      const audioContext = window.AudioContext;
      // Supply labelled PCM at the input node, before the real app worklet.
      // Use the browser's fake microphone for the permission and stream lifecycle.
      window.AudioContext = class extends audioContext {
        constructor(options) { super({ ...options, sampleRate }); }
        createMediaStreamSource() {
          const pcm = Uint8Array.from(atob(encoded), ch => ch.charCodeAt(0));
          const view = new DataView(pcm.buffer);
          const data = this.createBuffer(1, pcm.length / 2, sampleRate);
          const mono = data.getChannelData(0);
          for (let i = 0; i < mono.length; i++) mono[i] = view.getInt16(i * 2, true) / 32768;
          const source = this.createBufferSource();
          source.buffer = data;
          const connect = source.connect.bind(source);
          source.connect = (worklet) => { const result = connect(worklet); source.start(); return result; };
          return source;
        }
      };
    }, { encoded: packed.toString('base64'), sampleRate: rate });
    const fixture = createVisualFixtureSession({ id:'reader-practice-sight-singing', practiceXml:xmlOf(take), buildId:app.buildId });
    await page.route('**/*', route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== app.origin) return route.abort('blockedbyclient');
      if (!url.pathname.startsWith('/api/')) return route.continue();
      return route.fulfill(fixture.resolve({method:request.method(),pathname:url.pathname,identity:'member',cookie:''}));
    });
    await page.goto(`${app.origin}/choirs/visual-choir/sight-singing`);
    await page.getByRole('button', {name:labels.create, exact:true}).click();
    await page.getByLabel(labels.name).fill(language === 'zh' ? '晨练 · 合成样例' : 'Morning exercise · synthetic take');
    await page.getByLabel(labels.score).selectOption('visual-score');
    await expect(page.getByLabel(labels.voice)).toHaveValue('0:0:0');
    await page.getByRole('button', {name:labels.save, exact:true}).click();
    await page.locator('.challenge-notation svg').first().waitFor();
    if (name) {
      await expect(page.locator('html')).toHaveAttribute('data-ui-theme', colorScheme);
      await page.screenshot({path:`${out}/${name}-ready.png`});
    }
    await page.getByRole('button',{name:labels.start,exact:true}).click();
    if (name) {
      await expect(page.locator('.challenge-stage')).toContainText(labels.count);
      await page.screenshot({path:`${out}/${name}-count.png`});
      await page.locator('.challenge-pitches').waitFor({state:'visible'});
      await page.waitForTimeout(375);
      if (process.env.SIGHT_CHECK_REVIEW==='1') await expect(page.locator('.challenge-notation-beat')).toBeVisible();
      await page.screenshot({path:`${out}/${name}-sing.png`});
    }
    const result=page.getByRole('region',{name:labels.result});
    await expect(result).toBeVisible({timeout:15000});
    const strings = await result.locator('tbody tr > td[data-result], tbody tr:not(:has(td[data-result])) > td:last-child').allTextContents();
    const statuses = strings.map(text=>classify[labels.statuses.indexOf(text.trim())]);
    assert.equal(statuses.length, take.truth.length);
    assert.ok(statuses.every(Boolean), strings);
    const expected = take.truth.map(note=>note.status);
    const counts={matched:0,falseMiss:0,falseVoiced:0,falseInTune:0,unscored:0,otherWrongPitch:0};
    for(const [i,actual] of statuses.entries()) {
      const want=expected[i];
      if(want===actual) counts.matched++;
      else if(actual==='insufficientData')counts.unscored++;
      else if(actual==='missed')counts.falseMiss++;
      else if(want==='missed')counts.falseVoiced++;
      else if(actual==='inTune')counts.falseInTune++;
      else counts.otherWrongPitch++;
    }
    if (name) {
      await page.screenshot({path:`${out}/${name}-result.png`,fullPage:true});
      const audio = result.locator('audio');
      const replaySampleRate = await audio.evaluate(async node => (new DataView(await (await fetch(node.src)).arrayBuffer())).getUint32(24,true));
      assert.equal(replaySampleRate, rate);
      if (process.env.SIGHT_CHECK_REVIEW==='1') {
        await result.getByRole('button',{name:language==='zh'?/从第 3 音/:/Play from note 3/}).click();
        await expect.poll(() => audio.evaluate(node => node.currentTime)).toBeGreaterThan(.99);
        await expect(result.locator('tbody tr[data-active=true]')).toHaveCount(1);
        if (name === 'desktop-zh-dark') await page.screenshot({path:`${out}/${name}-replay.png`,fullPage:true});
        await page.getByRole('button',{name:labels.retry,exact:true}).click();
        await expect(page.locator('.challenge-stage')).toContainText(labels.count);
        await expect(result).toHaveCount(0);
      }
    }
    return {name:take.name,rate,counts,expected,statuses};
  } finally { await page.close(); }
}
const layouts = [
  {name:'phone-en-dark',language:'en',colorScheme:'dark',mobile:true},
  {name:'phone-zh-light',language:'zh',colorScheme:'light',mobile:true},
  {name:'desktop-en-light',language:'en',colorScheme:'light'},
  {name:'desktop-zh-dark',language:'zh',colorScheme:'dark'},
];
await mkdir(out, {recursive:true});
const app=await startProductionPreview();
const browser=await chromium.launch({args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
try {
  const work = [ ...takes.flatMap(take => [44100,48000].map(rate=>[take,rate])), ...layouts.map(config=>[takes.find(take=>take.name==='deviations'),48000,config]) ];
  const reports=[];
  // Bounded concurrency keeps worklet and browser scheduling comparable.
  const workers=Array.from({length:4},async()=>{
    for (;;) {
      const next=work.shift(); if(!next)break;
      const result=await execute(browser,app,...next);
      if(!next[2])reports.push(result);
      console.log(JSON.stringify(next[2] ? {layout:next[2].name} : {take:result.name,rate:result.rate,...result.counts}));
    }
  });
  await Promise.all(workers);
  await writeFile(`${out}/metrics.json`, JSON.stringify(reports.sort((a,b)=>a.name.localeCompare(b.name)||a.rate-b.rate),null,2)+'\n');
} finally { await browser.close(); await app.stop(); }
