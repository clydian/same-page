import { selectPracticeView } from './practice-controls.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium, webkit, expect } from '@playwright/test';
import { zipSync, strToU8 } from 'fflate';
import { startStorageFixture } from './storage-fixture.mjs';
import { polyphonicMusicXmlFixture } from './musicxml-fixture.mjs';
for (const [engine, type] of [['chromium',chromium],['webkit',webkit]]) {
 test(`MusicXML preparation Worker preserves its own response protocol (${engine})`, {timeout:60000}, async t => {
  const names = (await readdir('dist/client/assets')).filter(name => /^prepare\.worker-.*\.js$/.test(name));
  assert.equal(names.length,1,'test the exact built preparation worker');
  const fixture = await startStorageFixture();
  let browser;t.after(async()=>{try{await browser?.close();}finally{await fixture.stop();}});
  browser = await type.launch();
  const page = await browser.newPage();
  await page.goto(fixture.origin);
  const reply = await page.evaluate(({url,xml}) => new Promise((resolve,reject) => {
   const worker = new Worker(url,{type:'module'});
   worker.onerror = event => {worker.terminate();reject(new Error(event.message));};
   worker.onmessage = event => {
    worker.terminate();
    resolve({keys:Object.keys(event.data),visibility:event.data.prepared?.timeVisibility,byteLength:event.data.prepared?.bytes?.byteLength,wedges:event.data.prepared?.wedgeEventsByPart,creators:event.data.prepared?.creatorCredits,tempos:event.data.prepared?.tempoMeasures,glyphCompleteness:event.data.prepared?.dynamicGlyphsCompleteByPart,dynamics:event.data.prepared?.dynamicEventsByPart});
   };
   const bytes = new TextEncoder().encode(xml);
   worker.postMessage(bytes,[bytes.buffer]);
  }),{url:`/assets/${names[0]}`,xml:'<score-partwise version="4.0"><identification><creator type="composer">Worker Composer</creator><creator type="arranger">Worker Arranger</creator></identification><part-list><score-part id="P1"><part-name>Voice</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><time print-object="no"><beats>3</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><direction placement="above"><direction-type><dynamics><pp/></dynamics></direction-type><offset>0.5</offset></direction><direction><direction-type><wedge type="diminuendo" number="1"/></direction-type><offset>0.5</offset></direction><direction><direction-type><wedge type="stop" number="1"/></direction-type><offset>1.5</offset></direction><note><rest/><duration>3</duration><type>half</type><dot/></note></measure><measure number="2"><attributes><time><beats>2</beats><beat-type>2</beat-type></time></attributes><direction><direction-type><metronome><beat-unit>half</beat-unit><beat-unit-dot/><beat-unit>whole</beat-unit></metronome></direction-type></direction><note><rest/><duration>4</duration><type>whole</type></note></measure></part></score-partwise>'});
  assert.deepEqual(reply.keys,['prepared'],'no unrelated renderer/synth Worker initialization message may arrive first');
  assert.ok(reply.byteLength>0);
  assert.deepEqual(reply.glyphCompleteness,[true]);
  assert.deepEqual(reply.dynamics[0].map(event=>[event.quarter,event.value,event.placement]),[[0.5,"pp","above"]]);
  assert.deepEqual(reply.creators,{composers:['Worker Composer'],arrangers:['Worker Arranger']});
  assert.deepEqual(reply.tempos,[{events:[],complete:true},{events:[{quarter:0,bpm:160,visible:false}],complete:true}]);
  assert.deepEqual(reply.wedges[0].map(event=>[event.quarter,event.type]),[[0.5,'diminuendo'],[1.5,'stop']]);
  assert.deepEqual(reply.visibility,{partIds:['P1'],parts:[{trackIndex:0,measures:[{index:0,all:false,staves:[]}]}]});
 });
 test(`MusicXML attachment practice and PDF handoff (${engine})`, {timeout:180000}, async t => {
  const fixture=await startStorageFixture({authenticated:true,previewEntry:false});
  let browser;t.after(async()=>{try{await browser?.close();}finally{await fixture.stop();}});
  browser=await type.launch();const context=await browser.newContext({viewport:{width:1024,height:768},serviceWorkers:'block'});
  assert.equal((await context.request.post(fixture.origin+'/api/auth/sign-in/email',{headers:{origin:fixture.origin},data:{email:fixture.accounts[0].email,password:fixture.accounts[0].password}})).status(),200);
  await context.addInitScript(() => {
    window.__audioAnalysers = [];
    const connect = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function(destination, ...args) {
      if (destination instanceof AudioDestinationNode) {
        const analyser = this.context.createAnalyser(); analyser.fftSize = 256;
        window.__audioAnalysers.push(analyser);
        connect.call(this, analyser);
        connect.call(analyser, destination);
        return destination;
      }
      return connect.call(this, destination, ...args);
    };
  });
  const page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));const requests=[];page.on('request',request=>requests.push(request.url()));
  await page.goto(`${fixture.origin}/choirs/${fixture.choirId}`);
  await expect(page.getByRole('button',{name:'本地链路测试 更多操作',exact:true})).toBeVisible();
  assert.equal(requests.some(url=>/musicxml-engine|alphaTab\.|soundfont/.test(url)),false,'ordinary library must not load playback assets');
  await page.getByRole('button',{name:'本地链路测试 更多操作',exact:true}).click();
  await page.getByRole('menuitem',{name:'添加附件',exact:true}).click();
  await page.getByRole('button',{name:'可播放乐谱',exact:true}).click();
  const bytes=zipSync({'META-INF/container.xml':strToU8('<container><rootfiles><rootfile full-path="score.musicxml"/></rootfiles></container>'),'score.musicxml':polyphonicMusicXmlFixture()});
  await page.getByLabel('选择附件文件').setInputFiles({name:'分声部练习.mxl',mimeType:'application/vnd.recordare.musicxml',buffer:Buffer.from(bytes)});
  await page.getByRole('button',{name:'上传',exact:true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const attachmentId = (await (await context.request.get(`${fixture.origin}/api/choirs/${fixture.choirId}/attachments?scoreIds=${fixture.scoreId}`,{headers:{"X-Same-Page-Attachments":"2"}})).json()).attachments[0].id;
  const legacyKey = `same-page.practice:${JSON.stringify([`user:${fixture.accounts[0].id}`,fixture.choirId,attachmentId,1])}`;
  const legacyValue = JSON.stringify({speed:.5,focus:1,measure:2,parts:[]});
  await page.evaluate(({key,value})=>localStorage.setItem(key,value),{key:legacyKey,value:legacyValue});
  await page.getByRole('button',{name:'本地链路测试：1 个附件',exact:true}).click();
  await page.getByRole('button',{name:'分声部练习.mxl',exact:true}).click();
  const player=page.getByTestId('musicxml-player');
  const settings=page.getByRole('dialog',{name:'练习设置',exact:true});
  const notation=page.locator('.practice-notation .at-surface svg').first();
  const guide=page.getByRole('dialog',{name:'阅读器使用指引',exact:true});
  await expect(guide).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`/scores/${fixture.scoreId}`));
  await expect(page.locator('canvas[data-pdf-canvas-active]').first()).toBeAttached({timeout:20000});
  await expect(player.getByRole('button',{name:'播放',exact:true})).toBeEnabled({timeout:60000});
  await expect(player.getByLabel('播放进度',{exact:true})).toHaveValue('0');
  await expect(player.getByLabel('速度',{exact:true})).toHaveValue('1');
  await expect(page.getByRole('button',{name:'显示谱面',exact:true})).toHaveText('重排谱面');
  await selectPracticeView(page, '重排谱面');
  await expect(notation).toBeVisible({timeout:20000});
  const surface=await notation.elementHandle();
  assert.equal(await page.locator('.at-surface svg').evaluateAll(svgs => svgs.flatMap(svg => [...svg.querySelectorAll('path,text')]).some(element => /^rgba\(0, 0, 0, 0\./.test(getComputedStyle(element).fill))), false, 'secondary-voice notation stays opaque');
  await player.getByRole('button',{name:'练习设置',exact:true}).click();

  await settings.getByLabel('关注声部',{exact:true}).selectOption('1');
  await settings.getByRole('button',{name:'关闭练习设置',exact:true}).click();
  await player.getByLabel('速度',{exact:true}).selectOption('0.75');
  await player.getByRole('button',{name:'练习设置',exact:true}).click();
  await settings.locator('summary').filter({hasText:'片段循环'}).click();
  await settings.getByLabel('循环终点').selectOption('2');
  await settings.getByRole('button',{name:'循环这一段',exact:true}).click();
  await expect(settings.getByRole('button',{name:'取消循环',exact:true})).toBeVisible();
  await settings.getByRole('button',{name:'关闭练习设置',exact:true}).click();
  await player.getByRole('button',{name:'播放',exact:true}).click();
  await expect(player.getByRole('button',{name:'暂停',exact:true})).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__audioAnalysers.some(analyser => {
    const samples = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(samples);
    return samples.some(value => Math.abs(value) > 0.0001);
  })), {timeout:10000}).toBe(true);
  // The engine creates cursor/highlight nodes, but the host must give them visible styles.
  const beatCursor = page.locator('.practice-notation .at-cursor-beat');
  await expect.poll(() => beatCursor.evaluate(element => {
    const color = getComputedStyle(element).backgroundColor;
    const bounds = element.getBoundingClientRect();
    return color !== 'rgba(0, 0, 0, 0)' && bounds.width >= 2.5 && bounds.height > 20;
  })).toBe(true);
  await expect.poll(() => page.locator('.practice-notation .at-highlight *').evaluateAll(elements =>
    elements.some(element => getComputedStyle(element).fill === 'rgb(189, 111, 57)')
  )).toBe(true);
  const cursorX = await beatCursor.evaluate(element => element.getBoundingClientRect().x);
  await expect.poll(() => beatCursor.evaluate(element => element.getBoundingClientRect().x)).not.toBe(cursorX);
  await mkdir('artifacts/verification/playback-413',{recursive:true});
  await page.screenshot({path:`artifacts/verification/playback-413/${engine}-playing.png`});
  let furthest = 0;
  await expect.poll(async () => { const index = Number(await player.getByLabel('播放进度',{exact:true}).inputValue()); furthest = Math.max(furthest,index); return furthest >= 2 && index === 0; }, {timeout:20000}).toBe(true);
  await selectPracticeView(page, '原始 PDF');
  await expect(player.getByRole('button',{name:'暂停',exact:true})).toBeVisible();
  assert.ok(await surface.evaluate(element=>element.isConnected),'view switching must retain the renderer');
  const geometry=await player.evaluate(bar=>({height:bar.getBoundingClientRect().height,width:bar.getBoundingClientRect().width,viewport:innerWidth,readerBottom:document.querySelector('.reader-shell').getBoundingClientRect().bottom,barTop:bar.getBoundingClientRect().top}));
  assert.ok(geometry.height<=72 && geometry.width===geometry.viewport && geometry.readerBottom<=geometry.barTop,'full-width bar reserves score space');
  await expect(page.locator('canvas[data-pdf-canvas-active]').first()).toBeVisible({timeout:20000});
  await mkdir('artifacts/verification/musicxml-350',{recursive:true});
  await page.screenshot({path:`artifacts/verification/musicxml-350/${engine}-pdf.png`});
  await selectPracticeView(page, '重排谱面');
  await expect(notation).toBeVisible({timeout:20000});
  await page.screenshot({path:`artifacts/verification/musicxml-350/${engine}-player.png`});
  await player.getByRole('button',{name:'暂停',exact:true}).click();
  await player.getByRole('button',{name:'练习设置',exact:true}).click();
  await settings.locator('summary').filter({hasText:'片段循环'}).click();
  await settings.getByRole('button',{name:'取消循环',exact:true}).click();
  await settings.getByRole('button',{name:'关闭练习设置',exact:true}).click();
  await player.getByLabel('播放进度',{exact:true}).fill('4');
  await expect(player.getByLabel('播放进度',{exact:true})).toHaveValue('4');
  await page.getByRole('button',{name:'结束播放',exact:true}).click();
  await expect(player).toHaveCount(0);
  await expect(notation).toHaveCount(0);
  await page.goto(`${fixture.origin}/choirs/${fixture.choirId}`);
  await page.getByRole('button',{name:'本地链路测试：1 个附件',exact:true}).click();
  await page.getByRole('button',{name:'分声部练习.mxl',exact:true}).click();
  await expect(player.getByRole('button',{name:'播放',exact:true})).toBeEnabled({timeout:60000});
  await expect(page.getByRole('button',{name:'显示谱面',exact:true})).toHaveText('重排谱面');
  await player.getByRole('button',{name:'练习设置',exact:true}).click();
  await expect(settings.getByLabel('关注声部',{exact:true})).toHaveValue('');
  await expect(player.getByLabel('速度',{exact:true})).toHaveValue('1');
  await expect(player.getByLabel('播放进度',{exact:true})).toHaveValue('0');
  assert.equal(await page.evaluate(key=>localStorage.getItem(key),legacyKey),legacyValue,'legacy preferences remain inert and are never overwritten');
  await settings.getByRole('button',{name:'关闭练习设置',exact:true}).click();
  await page.setViewportSize({width:390,height:844});
  await selectPracticeView(page, '重排谱面');
  await expect(notation).toBeVisible({timeout:20000});
  await expect.poll(() => notation.evaluate(svg => svg.getBoundingClientRect().width), {timeout:20000}).toBeLessThan(370);
  await page.screenshot({path:`artifacts/verification/musicxml-350/${engine}-mobile.png`});
  assert.ok((await player.boundingBox()).height<=72,'mobile playback controls remain thin');
  await selectPracticeView(page, '原始 PDF');
  await expect(page.locator('canvas[data-pdf-canvas-active]').first()).toBeVisible({timeout:20000});
  await page.goBack();
  await expect(page).toHaveURL(`${fixture.origin}/choirs/${fixture.choirId}`);
  await expect(player).toHaveCount(0);
  await expect(notation).toHaveCount(0);
  assert.equal(requests.some(url=>url.endsWith('/attachments/capabilities')),false,'upload and playback do not require a capability request');
  assert.deepEqual(errors,[]);
 });
}

test('built host publicly serves the exact installed native sources and notices', { timeout: 60000 }, async t => {
  const directory = 'public/third-party/alphatab';
  const names = (await readdir(directory)).filter(name => name.endsWith('.json'));
  assert.ok(names.length > 0);
  const fixture = await startStorageFixture();
  t.after(() => fixture.stop());
  for (const name of names) {
    const expected = JSON.parse(await readFile(`${directory}/${name}`, 'utf8'));
    const response = await fetch(`${fixture.origin}/third-party/alphatab/${name}`);
    assert.equal(response.status, 200);
    const manifest = await response.json();
    assert.deepEqual(manifest, expected);
    for (const file of [manifest.archive, manifest.license, manifest.notices]) {
      const response = await fetch(`${fixture.origin}/third-party/alphatab/${file}`);
      assert.equal(response.status, 200);
      const bytes = Buffer.from(await response.arrayBuffer());
      assert.deepEqual(bytes, await readFile(`${directory}/${file}`));
      if (file === manifest.archive) assert.equal(createHash('sha256').update(bytes).digest('hex'), manifest.sha256);
    }
  }
});
