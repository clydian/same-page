import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir } from 'node:fs/promises';
import { chromium, webkit, expect } from '@playwright/test';
import { startStorageFixture } from './storage-fixture.mjs';
import { musicXmlFixture } from './musicxml-fixture.mjs';
import { setLoopRange } from './practice-controls.mjs';

for (const [engine,type] of [['chromium',chromium],['webkit',webkit]]) test(`loop bounds unify score taps, transport, and transparent range preview (${engine})`,{timeout:120000},async t=>{
 const fixture=await startStorageFixture({authenticated:true,previewEntry:false});let browser;
 t.after(async()=>{try{await browser?.close();}finally{await fixture.stop();}});
 browser=await type.launch();const context=await browser.newContext({viewport:{width:1024,height:768},serviceWorkers:'block'});
 await context.addInitScript(()=>{
  localStorage.setItem('reader-gesture-hint-seen','true');window.__loopCommands=[];
  const post=Worker.prototype.postMessage;
  Worker.prototype.postMessage=function(value,...rest){
   if(['alphaSynth.setTickPosition','alphaSynth.setPlaybackRange'].includes(value?.cmd))window.__loopCommands.push(value);
   return post.call(this,value,...rest);
  };
 });
 await context.request.post(fixture.origin+'/api/auth/sign-in/email',{headers:{origin:fixture.origin},data:{email:fixture.accounts[0].email,password:fixture.accounts[0].password}});
 const bytes=musicXmlFixture(48),id=crypto.randomUUID();
 assert.equal((await context.request.post(`${fixture.origin}/api/choirs/${fixture.choirId}/scores/${fixture.scoreId}/attachments/${id}/file?name=loop.xml&size=${bytes.length}`,{data:bytes,headers:{'content-length':String(bytes.length)}})).status(),201);
 const page=await context.newPage();await page.goto(`${fixture.origin}/choirs/${fixture.choirId}/scores/${fixture.scoreId}`);
 await expect(page.locator('canvas[data-pdf-canvas-active]').first()).toBeVisible({timeout:20000});
 await page.locator('.page-reader__viewport').click({position:{x:400,y:300}});
 await page.getByRole('button',{name:'练习谱',exact:true}).click();await page.getByRole('button',{name:'loop.xml',exact:true}).click();
 const bar=page.getByTestId('musicxml-player');await expect(bar.getByRole('button',{name:'播放',exact:true})).toBeEnabled({timeout:60000});
 await bar.getByRole('button',{name:'展开播放控制',exact:true}).click();
 const settings=page.getByRole('dialog',{name:'练习设置',exact:true}),progress=bar.getByRole('slider',{name:'播放进度',exact:true});
 const open=()=>bar.getByRole('button',{name:'练习设置',exact:true}).click();
 const close=()=>page.getByRole('button',{name:'关闭练习设置',exact:true}).click();
 for (const [width,height] of [[320,740],[390,844],[1024,768]]) {
  await page.setViewportSize({width,height});
  const geometry=()=>bar.evaluate(element=>['.practice-timeline','.practice-play','.practice-settings'].map(selector=>element.querySelector(selector).getBoundingClientRect().toJSON()).concat(element.getBoundingClientRect().toJSON()));
  const before=await geometry();
  await open();await setLoopRange(page,2,4);await close();
  const trigger=bar.getByRole('button',{name:'练习设置',exact:true});
  await expect(trigger).toHaveText('练习');await expect(trigger).toHaveAttribute('data-loop','true');
  assert.deepEqual(await geometry(),before,'enabling loop keeps the timeline, buttons and dock fixed');
  await open();await settings.getByRole('switch',{name:'片段循环',exact:true}).locator('xpath=ancestor::label').click();await close();
  await expect(trigger).toHaveText('练习');await expect(trigger).not.toHaveAttribute('data-loop','true');
  assert.deepEqual(await geometry(),before,'disabling loop keeps the timeline, buttons and dock fixed');
 }
 await page.evaluate(()=>{window.__loopCommands=[];});
 await open();await setLoopRange(page,2,4);await close();
 await expect(progress).toHaveAttribute('min','2');await expect(progress).toHaveAttribute('max','4');
 await expect(bar.getByRole('button',{name:'前一小节',exact:true})).toBeDisabled();
 const tap=async number=>{
  const label=page.locator('.at-surface svg text').filter({hasText:new RegExp(`^${number}\\s*$`)}).first();

  const rect=await label.evaluate(element=>{
   const texts=[...element.ownerSVGElement.querySelectorAll('text')],index=texts.indexOf(element);
   const note=texts.slice(index+1).find(e=>e.textContent==='\uE0A2');
   return note?.getBoundingClientRect().toJSON();
  });assert.ok(rect);await page.mouse.click(rect.x+rect.width/2,rect.y+rect.height/2);
 };
 await tap(8);await expect(progress).toHaveValue('4');
 await expect(bar.getByRole('button',{name:'后一小节',exact:true})).toBeDisabled();
 await tap(1);await expect(progress).toHaveValue('2');
 // The same visual point under magnification must use exactly the same seek rule.
 await page.locator('.practice-notation-scroll').dispatchEvent('wheel',{deltaY:-60,ctrlKey:true,clientX:100,clientY:200});
 await tap(8);await expect(progress).toHaveValue('4');
 await page.getByRole('button',{name:'恢复查看比例',exact:true}).click();
 const commands=await page.evaluate(()=>window.__loopCommands);
 assert.ok(!commands.some(c=>c.cmd==='alphaSynth.setPlaybackRange' && c.value===null),'score taps retain the active engine loop');
 assert.deepEqual(commands.filter(c=>c.cmd==='alphaSynth.setTickPosition').slice(-3).map(c=>c.value),[15360,7680,15360]);
 await progress.press('Home');await expect(progress).toHaveValue('2');await progress.press('End');await expect(progress).toHaveValue('4');
 await bar.getByRole('button',{name:'定位小节',exact:true}).click();const locator=page.getByRole('slider',{name:'目标小节',exact:true});
 await expect(locator).toHaveAttribute('min','2');await expect(locator).toHaveAttribute('max','4');await locator.fill('3');await page.getByRole('button',{name:'跳转',exact:true}).click();await expect(progress).toHaveValue('3');
 await bar.getByRole('button',{name:'播放',exact:true}).click();await expect(bar.getByRole('button',{name:'暂停',exact:true})).toBeVisible();
 await open();await setLoopRange(page,2,5);await close();await expect(bar.getByRole('button',{name:'暂停',exact:true})).toBeVisible();
 await bar.getByRole('button',{name:'暂停',exact:true}).click();
 await open();await setLoopRange(page,3,3);await close();
 await expect(progress).toHaveAttribute('min','3');await expect(progress).toHaveAttribute('max','3');await tap(8);await expect(progress).toHaveValue('3');
 await page.setViewportSize({width:390,height:844});await open();await setLoopRange(page,3,6);
 const viewport=page.locator('.practice-notation-scroll');const original=await viewport.evaluate(e=>e.scrollTop);
 const thumb=settings.locator('.practice-range-thumb').nth(1),track=settings.locator('.practice-range-track');
 const grip=await thumb.boundingBox(),rail=await track.boundingBox();assert.ok(grip&&rail);
 await page.mouse.move(grip.x+grip.width/2,grip.y+grip.height/2);await page.mouse.down();
 await page.mouse.move(rail.x+rail.width-1,grip.y+grip.height/2,{steps:12});
 await expect(page.locator('.practice-popover')).toHaveAttribute('data-loop-previewing','true');
 await expect(settings.locator('header')).toHaveCSS('opacity','0');await expect(page.locator('.practice-popover')).toHaveCSS('background-color','rgba(0, 0, 0, 0)');
 await expect.poll(()=>viewport.evaluate(e=>e.scrollTop)).toBeGreaterThan(original);
 const markers=page.locator('.practice-measure-preview');assert.ok(await markers.count()>1,'draft highlight spans multiple score rows');const marker=markers.last();await expect(marker).toBeVisible();const bounds=await marker.boundingBox();assert.ok(bounds.width>10 && bounds.height>10,'whole-note target has a real measure highlight');const visible=await viewport.boundingBox();assert.ok(bounds.y>=visible.y && bounds.y+bounds.height<=visible.y+visible.height,'target measure is inside the score viewport');
 await mkdir('artifacts/verification/practice-loop',{recursive:true});await page.screenshot({path:`artifacts/verification/practice-loop/${engine}-mobile-drag.png`});
 await page.mouse.up();await expect(page.locator('.practice-popover')).not.toHaveAttribute('data-loop-previewing','true');
 await expect(settings.getByRole('status').filter({hasText:'正在循环'})).toContainText('第 4 小节 至 第 48 小节');
 await expect(progress).toHaveAttribute('max','47');
 for (const cancel of [()=>page.keyboard.press('Escape'),()=>page.evaluate(()=>window.dispatchEvent(new Event('blur')))]) {
  const endpoint=await settings.locator('.practice-range-thumb').nth(1).boundingBox(),line=await track.boundingBox();
  await page.mouse.move(endpoint.x+endpoint.width/2,endpoint.y+endpoint.height/2);await page.mouse.down();
  await page.mouse.move(line.x+line.width*.65,endpoint.y+endpoint.height/2,{steps:5});
  await expect(page.locator('.practice-popover')).toHaveAttribute('data-loop-previewing','true');
  await cancel();
  await page.mouse.move(line.x+line.width*.4,endpoint.y+endpoint.height/2,{steps:5});await page.mouse.up();
  await expect(settings.getByRole('slider',{name:/循环终点/})).toHaveValue('47');
  await expect(progress).toHaveAttribute('max','47');
  await expect(page.locator('.practice-popover')).not.toHaveAttribute('data-loop-previewing','true');
 }
 await close();
 await expect(progress).toHaveValue('3');await expect(progress).toHaveAttribute('max','47');
 await open();await page.screenshot({path:`artifacts/verification/practice-loop/${engine}-mobile-settings.png`});
 await settings.getByRole('switch',{name:'片段循环',exact:true}).locator('xpath=ancestor::label').click();await close();await expect(progress).toHaveAttribute('min','0');await expect(progress).toHaveAttribute('max','47');
});
