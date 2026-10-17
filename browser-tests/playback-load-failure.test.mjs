import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdir} from 'node:fs/promises';
import { chromium, webkit, expect } from '@playwright/test';
import { startStorageFixture } from './storage-fixture.mjs';
import { musicXmlFixture } from './musicxml-fixture.mjs';

for (const [engine,type] of [['chromium',chromium],['webkit',webkit]]) test(`failed optional player keeps PDF and safe update recovery (${engine})`,{timeout:120000},async t=>{
 const fixture=await startStorageFixture({authenticated:true,previewEntry:false}); let browser;
 t.after(async()=>{try{await browser?.close();}finally{await fixture.stop();}});
 browser=await type.launch();const context=await browser.newContext({viewport:{width:1024,height:768},serviceWorkers:'block'});
 for (const path of ['/assets/musicxml-player-removed.js','/pdfjs/removed.wasm','/font/removed.woff2','/soundfont/removed.sf2']) {
  const missing=await context.request.get(`${fixture.origin}${path}`);
  assert.equal(missing.status(),404);assert.equal(missing.headers()['cache-control'],'no-store');assert.doesNotMatch(await missing.text(),/<!doctype html>/i);
 }
 const shell=await context.request.get(`${fixture.origin}/about`);assert.equal(shell.status(),200);const html=await shell.text();assert.match(html,/<!doctype html>/i);
 const scriptPath=html.match(/<script[^>]+src="([^"]+\.js)"/)[1];
 const script=await context.request.get(`${fixture.origin}${scriptPath}`);assert.equal(script.status(),200);assert.match(script.headers()['content-type'],/javascript/);assert.match(script.headers()['cache-control'],/immutable/);
 await context.request.post(fixture.origin+'/api/auth/sign-in/email',{headers:{origin:fixture.origin},data:{email:fixture.accounts[0].email,password:fixture.accounts[0].password}});
 const bytes=Buffer.from(musicXmlFixture(4)),id=crypto.randomUUID();
 const upload=await context.request.post(`${fixture.origin}/api/choirs/${fixture.choirId}/scores/${fixture.scoreId}/attachments/${id}/file?name=practice.xml&size=${bytes.length}`,{data:bytes,headers:{'content-length':String(bytes.length)}});assert.equal(upload.status(),201);
 const page=await context.newPage();let navigations=0;page.on('framenavigated',frame=>{if(frame===page.mainFrame())navigations++;});
 await page.addInitScript(()=>localStorage.setItem('reader-gesture-hint-seen','true'));
 await page.route('**/assets/musicxml-player-*.js',route=>route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><html>old chunk missing</html>'}));
 await page.goto(`${fixture.origin}/choirs/${fixture.choirId}/scores/${fixture.scoreId}`);
 const canvas=page.locator('canvas[data-pdf-canvas-active]').first();await expect(canvas).toBeAttached({timeout:20000});
 const reader=await page.locator('.reader-shell').elementHandle();
 const reveal=async()=>{if(!await page.getByRole('button',{name:'本谱附件',exact:true}).isVisible())await page.locator('.page-reader__viewport').click({position:{x:400,y:300}});};
 await reveal();await page.getByRole('button',{name:'本谱附件',exact:true}).click();await page.getByRole('button',{name:'practice.xml',exact:true}).click();
 const failure=page.getByRole('complementary',{name:'播放器加载失败'});await expect(failure.getByRole('alert')).toContainText('播放器加载失败');
 assert.equal(await reader.evaluate(element=>element.isConnected),true,'reader root must not be unmounted by lazy rejection');await expect(canvas).toBeAttached();
 const before=navigations;await failure.getByRole('button',{name:'检查更新',exact:true}).click();await expect(failure.getByRole('status')).not.toBeEmpty();
 await expect(failure.getByRole('link',{name:'关于合谱与版本更新'})).toHaveAttribute('href','/about');assert.equal(navigations,before,'checking for update never reloads');
 await mkdir('artifacts/verification/playback-load-failure',{recursive:true});await page.screenshot({path:`artifacts/verification/playback-load-failure/${engine}.png`});
 await failure.getByRole('button',{name:'关闭播放器'}).click();await expect(failure).toHaveCount(0);await expect(canvas).toBeAttached();assert.equal(await reader.evaluate(element=>element.isConnected),true);
});
