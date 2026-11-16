import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir } from 'node:fs/promises';
import { chromium, webkit, expect } from '@playwright/test';
import { startStorageFixture } from './storage-fixture.mjs';
import { musicXmlFixture } from './musicxml-fixture.mjs';
import { expandPracticeTools, selectPracticeView } from './practice-controls.mjs';

const baseline = process.env.SCRUB_BASELINE === '1';
for (const engine of (process.env.SCRUB_ENGINE ? [process.env.SCRUB_ENGINE] : ['chromium','webkit'])) test(`score scrub previews, cancellation and tap follow (${engine})`, {timeout:120000}, async t => {
 const fixture=await startStorageFixture({authenticated:true,previewEntry:false});let browser;
 t.after(async()=>{try{await browser?.close();}finally{await fixture.stop();}});
 browser=await ({chromium,webkit})[engine].launch(engine==='chromium' && process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{});
 const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,serviceWorkers:'block'});
 await context.addInitScript(()=>{localStorage.setItem('reader-gesture-hint-seen','true');window.__seeks=[];const post=Worker.prototype.postMessage;Worker.prototype.postMessage=function(value,...args){if(value?.cmd==='alphaSynth.setTickPosition')window.__seeks.push(value.value);return post.call(this,value,...args);};});
 await context.request.post(fixture.origin+'/api/auth/sign-in/email',{headers:{origin:fixture.origin},data:{email:fixture.accounts[0].email,password:fixture.accounts[0].password}});
 const bytes=musicXmlFixture(48),id=crypto.randomUUID();
 assert.equal((await context.request.post(`${fixture.origin}/api/choirs/${fixture.choirId}/scores/${fixture.scoreId}/attachments/${id}/file?name=scrub.xml&size=${bytes.length}`,{data:bytes,headers:{'content-length':String(bytes.length)}})).status(),201);
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`${fixture.origin}/choirs/${fixture.choirId}/scores/${fixture.scoreId}`);
 await expect(page.locator('canvas[data-pdf-canvas-active]').first()).toBeVisible({timeout:20000});
 await page.locator('.page-reader__viewport').click({position:{x:180,y:300}});
 await page.getByRole('button',{name:'练习谱',exact:true}).click();await page.getByRole('button',{name:'scrub.xml',exact:true}).click();
 const bar=page.getByTestId('musicxml-player'),slider=bar.getByRole('slider',{name:'播放进度',exact:true}),viewport=page.locator('.practice-notation-scroll');
 await expect(bar.getByRole('button',{name:'播放',exact:true})).toBeEnabled({timeout:60000});
 const expand=bar.getByRole('button',{name:'展开练习控制',exact:true});if(await expand.isVisible()) await expand.click();await expandPracticeTools(page);
 await expect(page.locator('.at-surface svg')).not.toHaveCount(0);
 const output='artifacts/verification/xml-scrub';await mkdir(output,{recursive:true});
 const box=await slider.boundingBox(),y=box.y+box.height/2,x=box.x+10,target=box.x+box.width*.8;
 const start=()=>page.mouse.move(x,y).then(()=>page.mouse.down());
 await start();await page.mouse.move(target,y,{steps:12});
 if(!baseline){await expect(page.locator('.practice-measure-preview')).toHaveCount(1);await expect.poll(()=>viewport.evaluate(e=>e.scrollTop)).toBeGreaterThan(200);const marker=await page.locator('.practice-measure-preview').boundingBox(),region=await viewport.boundingBox();assert.ok(marker.y>=region.y && marker.y+marker.height<=region.y+region.height,'target measure is visible inside the score viewport');}
 await page.screenshot({path:`${output}/${baseline?'before':'after'}-${engine}-preview.png`});
 if(baseline){await page.mouse.up();return;}
 await page.mouse.move(target,y-100,{steps:8});await expect(bar.locator('.practice-timeline-preview')).toHaveCount(0);await expect(page.locator('.practice-measure-preview')).toHaveCount(0);
 await page.screenshot({path:`${output}/after-${engine}-cancel.png`});
 await page.mouse.move(target,y,{steps:8});await page.mouse.up();await expect(slider).toHaveValue('0');await expect.poll(()=>viewport.evaluate(e=>e.scrollTop)).toBe(0);
 assert.deepEqual(await page.evaluate(()=>window.__seeks),[],'cancel sends no seek');
 // Mouse release, keyboard cancellation, and fresh gesture after abort.
 await start();await page.mouse.move(target,y,{steps:8});const value=await slider.inputValue();await page.mouse.up();await expect(slider).toHaveValue(value);assert.equal((await page.evaluate(()=>window.__seeks)).length,1);
 for(const abort of [()=>page.keyboard.press('Escape'),()=>page.evaluate(()=>window.dispatchEvent(new Event('blur'))),()=>slider.dispatchEvent('pointercancel')]){
  await start();await page.mouse.move(target-30,y,{steps:6});await abort();await page.mouse.move(target-50,y,{steps:6});await page.mouse.up();await expect(slider).toHaveValue(value);
 }
 // Real Chromium touch input uses browser hit testing and native range behavior.
 if(engine==='chromium'){
  const cdp=await context.newCDPSession(page);const touch=async(type,x,y)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'?[]:[{x,y}]});
  await touch('touchStart',x,y);await touch('touchMove',target-70,y);await expect(slider).not.toHaveValue(value);await expect(page.locator('.practice-measure-preview')).toHaveCount(1);await touch('touchMove',target-70,y-100);await touch('touchMove',target-70,y);await touch('touchEnd');await expect(slider).toHaveValue(value);
  await touch('touchStart',x,y);await touch('touchMove',target-40,y);const next=await slider.inputValue();assert.notEqual(next,value);await touch('touchEnd');await expect(slider).toHaveValue(next);
 }
 // Manual browsing followed by a valid score tap must restore following immediately.
 const wheelStart=await viewport.evaluate(e=>e.scrollTop);await viewport.hover();await page.mouse.wheel(0,-300);await expect.poll(()=>viewport.evaluate(e=>e.scrollTop)).toBe(Math.max(0,wheelStart-300));await expect(page.getByRole('button',{name:'恢复自动跟随'})).toBeVisible();
 await viewport.dispatchEvent('wheel',{deltaY:-60,ctrlKey:true,clientX:100,clientY:200});await expect(page.getByRole('button',{name:'恢复查看比例',exact:true})).toBeVisible();const browseLeft=await viewport.evaluate(e=>e.scrollLeft),browseTop=await viewport.evaluate(e=>e.scrollTop);await start();await page.mouse.move(target-30,y,{steps:6});const previewBox=await page.locator('.practice-measure-preview').boundingBox(),viewBox=await viewport.boundingBox();assert.ok(previewBox.y>=viewBox.y && previewBox.y+previewBox.height<=viewBox.y+viewBox.height,'magnified preview target is vertically visible');await page.keyboard.press('Escape');await page.mouse.up();await expect.poll(()=>viewport.evaluate(e=>e.scrollTop)).toBe(browseTop);await expect.poll(()=>viewport.evaluate(e=>e.scrollLeft)).toBe(browseLeft);await expect(page.getByRole('button',{name:'恢复查看比例',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'恢复自动跟随'})).toBeVisible();
 const note=page.locator('.at-surface svg text').filter({hasText:'\uE0A2'});
 const rect=await note.evaluateAll(elements=>{const region=document.querySelector('.practice-notation-scroll').getBoundingClientRect();return elements.map(e=>e.getBoundingClientRect().toJSON()).find(r=>r.y>region.y+20&&r.bottom<region.bottom-20);});assert.ok(rect);
 await page.mouse.click(rect.x+rect.width/2,rect.y+rect.height/2);await expect(page.getByRole('button',{name:'恢复自动跟随'})).toHaveCount(0);await expect(page.getByRole('button',{name:'恢复查看比例',exact:true})).toHaveCount(0);
 await bar.getByRole('button',{name:'播放',exact:true}).click();await expect(bar.getByRole('button',{name:'暂停',exact:true})).toBeVisible();
 await start();await page.mouse.move(target,y,{steps:6});await page.mouse.move(target,y-100,{steps:6});await page.mouse.up();await expect(bar.getByRole('button',{name:'暂停',exact:true})).toBeVisible();
 await start();await page.mouse.move(target-50,y,{steps:6});const playingTarget=await slider.inputValue();await page.mouse.up();await expect(slider).toHaveValue(playingTarget);await expect(bar.getByRole('button',{name:'暂停',exact:true})).toBeVisible();
 await bar.getByRole('button',{name:'暂停',exact:true}).click();
 await selectPracticeView(page,'原始 PDF');
 await start();await page.mouse.move(target,y,{steps:6});await expect(page.locator('.practice-notation')).toHaveAttribute('data-visible','true');await page.keyboard.press('Escape');await page.mouse.up();await expect(page.locator('.practice-notation')).toHaveAttribute('aria-hidden','true');
 await start();await page.mouse.move(target-40,y,{steps:6});await page.mouse.up();await expect(page.locator('.practice-notation')).toHaveAttribute('data-visible','true');
 assert.deepEqual(errors,[]);
});
