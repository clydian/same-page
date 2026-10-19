import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';
import { zipSync, strToU8 } from 'fflate';
import { startStorageFixture } from './storage-fixture.mjs';
import { polyphonicMusicXmlFixture } from './musicxml-fixture.mjs';

test('MusicXML and MXL: verified optional bundle, closed-browser offline cold start, refresh, playback and recovery', {timeout:240000}, async t => {
 const fixture=await startStorageFixture({authenticated:true,previewEntry:false});
 const profile=await mkdtemp(path.join(tmpdir(),'same-page-xml-offline-'));
 const options={headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? {executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{}),serviceWorkers:'allow',viewport:{width:1024,height:768}};
 let context;
 t.after(async()=>{await context?.close();await fixture.stop();await rm(profile,{recursive:true,force:true});});
 context=await chromium.launchPersistentContext(profile,options);
 assert.equal((await context.request.post(`${fixture.origin}/api/auth/sign-in/email`,{headers:{origin:fixture.origin},data:{email:fixture.accounts[0].email,password:fixture.accounts[0].password}})).status(),200);
 await context.addInitScript(()=>localStorage.setItem('reader-gesture-hint-seen','true'));
 const page=await context.newPage();
 const requests=[];page.on('request',request=>requests.push(request.url()));
 await page.goto(`${fixture.origin}/choirs/${fixture.choirId}`);
 await page.getByRole('button',{name:'本地链路测试 更多操作',exact:true}).waitFor();
 await page.evaluate(()=>navigator.serviceWorker.ready.then(()=>undefined));
 assert.equal(requests.some(url=>/musicxml-engine|soundfont/.test(url)),false);
 // Download both supported original formats through the ordinary attachment UI.
 for(const ext of ['xml','mxl']) {
  await page.getByRole('button',{name:'本地链路测试 更多操作',exact:true}).click();
  await page.getByRole('menuitem',{name:'添加附件',exact:true}).click();
  await page.getByRole('button',{name:'可播放乐谱',exact:true}).click();
  const xml=polyphonicMusicXmlFixture();
  const bytes=ext==='xml'?Buffer.from(xml):Buffer.from(zipSync({'META-INF/container.xml':strToU8('<container><rootfiles><rootfile full-path="score.musicxml"/></rootfiles></container>'),'score.musicxml':strToU8(xml)}));
  await page.getByLabel('选择附件文件').setInputFiles({name:`离线练习.${ext}`,mimeType:'application/octet-stream',buffer:bytes});
  await page.getByRole('button',{name:'上传',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
 }
 await page.getByRole('button',{name:'本地链路测试：2 个附件',exact:true}).click();
 const open = async(target,ext)=>{
  await target.getByRole('button',{name:`离线练习.${ext}`,exact:true}).click();
  const player=target.getByTestId('musicxml-player');
  await expect(player.getByRole('button',{name:'播放',exact:true})).toBeEnabled({timeout:60000});
  await expect(target.locator('.practice-notation .at-surface svg').first()).toBeVisible({timeout:20000});
  await player.getByRole('button',{name:'展开播放控制',exact:true}).click();
  await player.getByRole('button',{name:'练习设置',exact:true}).click();
  await expect(target.getByText('此练习谱可离线打开与播放。',{exact:true})).toBeVisible({timeout:60000});
  await target.getByRole('button',{name:'关闭练习设置',exact:true}).click();
  return player;
 };
 await open(page,'xml');
 await page.getByRole('button',{name:'结束练习',exact:true}).click();
 await page.goto(`${fixture.origin}/choirs/${fixture.choirId}`);
 await page.getByRole('button',{name:'本地链路测试：2 个附件',exact:true}).click();
 await open(page,'mxl');
 await page.getByRole('button',{name:'结束练习',exact:true}).click();
 await context.close();
 context=await chromium.launchPersistentContext(profile,options);await context.setOffline(true);
 await context.addInitScript(()=>{
  window.__audioAnalysers=[];const connect=AudioNode.prototype.connect;
  AudioNode.prototype.connect=function(destination,...args){if(destination instanceof AudioDestinationNode){const analyser=this.context.createAnalyser();window.__audioAnalysers.push(analyser);connect.call(this,analyser);connect.call(analyser,destination);return destination;}return connect.call(this,destination,...args);};
 });
 const offline=await context.newPage();const errors=[];offline.on('pageerror',error=>errors.push(error.message));
 await offline.goto(`${fixture.origin}/choirs/${fixture.choirId}`);
 await offline.getByRole('button',{name:'本地链路测试：2 个附件',exact:true}).click();
 let player=await open(offline,'mxl');
 await player.getByLabel('速度',{exact:true}).selectOption('0.75');
 await player.getByRole('button',{name:'练习设置',exact:true}).click();
 await offline.getByRole('dialog',{name:'练习设置',exact:true}).getByLabel('关注声部',{exact:true}).selectOption('1');
 await offline.getByRole('button',{name:'关闭练习设置',exact:true}).click();
 await player.getByRole('button',{name:'播放',exact:true}).click();
 await expect(player.getByRole('button',{name:'暂停',exact:true})).toBeVisible();
 await expect.poll(()=>offline.evaluate(()=>window.__audioAnalysers.some(analyser=>{const samples=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(samples);return samples.some(value=>Math.abs(value)>.0001);})),{timeout:15000}).toBe(true);
 await player.getByRole('button',{name:'暂停',exact:true}).click();
 await mkdir('artifacts/verification/musicxml-offline',{recursive:true});
 await offline.screenshot({path:'artifacts/verification/musicxml-offline/chromium-cold-offline.png'});
 await offline.reload();await offline.locator('canvas[data-pdf-canvas-active]').first().waitFor();
 await offline.screenshot({path:'artifacts/verification/musicxml-offline/reader-after-refresh.png'});
 if (!await offline.getByRole('button',{name:'练习谱',exact:true}).isVisible()) await offline.locator('canvas[data-pdf-canvas-active]').first().click({position:{x:195,y:350}});
 await offline.getByRole('button',{name:'练习谱',exact:true}).click();
 player=await open(offline,'xml');await expect(player.getByLabel('速度',{exact:true})).toHaveValue('1');
 await player.getByRole('button',{name:'播放',exact:true}).click();await expect(player.getByRole('button',{name:'暂停',exact:true})).toBeVisible();
 await expect.poll(()=>offline.evaluate(()=>window.__audioAnalysers.some(analyser=>{const samples=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(samples);return samples.some(value=>Math.abs(value)>.0001);})),{timeout:15000}).toBe(true);
 await player.getByRole('button',{name:'暂停',exact:true}).click();
 // A confirmed endpoint denial must revoke the local original rather than
 // treating it as another temporary network failure. Other originals survive.
 await context.route('**/api/choirs/*/scores/*/attachments/*',route=>route.fulfill({status:403,contentType:'application/json',body:'{"error":"forbidden"}'}));
 await offline.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await expect(offline.getByTestId('musicxml-player')).toHaveCount(0);
 await expect.poll(()=>offline.evaluate(()=>new Promise((resolve,reject)=>{
  const request=indexedDB.open('same-page');request.onerror=()=>reject(request.error);request.onsuccess=()=>{
   const db=request.result;const keys=db.transaction('system').objectStore('system').getAllKeys();
   keys.onsuccess=()=>{resolve(keys.result.filter(key=>String(key).startsWith('["offline-musicxml",')).length);db.close();};keys.onerror=()=>reject(keys.error);
  };
 }))).toBe(1);
 await expect(offline.locator('canvas[data-pdf-canvas-active]').first()).toBeVisible();
 assert.deepEqual(errors,[]);
});
