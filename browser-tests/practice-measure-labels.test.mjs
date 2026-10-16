import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium, webkit, expect } from '@playwright/test';
import { startStorageFixture } from './storage-fixture.mjs';
import { musicXmlFixture } from './musicxml-fixture.mjs';

for (const [engine, type] of [['chromium', chromium], ['webkit', webkit]]) test(`measure labels distinguish repeat order only when needed (${engine})`, {timeout:90000}, async t => {
  const fixture = await startStorageFixture({authenticated:true, previewEntry:false}); let browser;
  t.after(async () => { try { await browser?.close(); } finally { await fixture.stop(); } });
  browser = await type.launch();
  const context = await browser.newContext({viewport:{width:390,height:844}, serviceWorkers:'block'});
  await context.addInitScript(() => localStorage.setItem('reader-gesture-hint-seen','true'));
  await context.request.post(fixture.origin+'/api/auth/sign-in/email',{headers:{origin:fixture.origin},data:{email:fixture.accounts[0].email,password:fixture.accounts[0].password}});
  const bytes = Buffer.from(musicXmlFixture(4).toString().replaceAll('<measure number="1">','<measure number="1"><barline location="left"><repeat direction="forward"/></barline>').replaceAll(/(<measure number="2">[\s\S]*?)(<\/measure>)/g,'$1<barline location="right"><repeat direction="backward"/></barline>$2'));
  const id = crypto.randomUUID();
  assert.equal((await context.request.post(`${fixture.origin}/api/choirs/${fixture.choirId}/scores/${fixture.scoreId}/attachments/${id}/file?name=repeats.xml&size=${bytes.length}`,{data:bytes,headers:{'content-length':String(bytes.length)}})).status(),201);
  const page = await context.newPage();
  await page.goto(`${fixture.origin}/choirs/${fixture.choirId}/scores/${fixture.scoreId}`);
  await expect(page.locator('canvas[data-pdf-canvas-active]').first()).toBeVisible({timeout:20000});
  await page.locator('.page-reader__viewport').click({position:{x:180,y:200}});
  await page.getByRole('button',{name:'本谱附件',exact:true}).click();
  await page.getByRole('button',{name:'repeats.xml',exact:true}).click();
  await expect(page.getByRole('button',{name:'播放',exact:true})).toBeEnabled({timeout:60000});
  const range = page.getByRole('slider',{name:'播放进度',exact:true});
  await expect(range).toHaveAttribute('max','5');
  for (const [index,label] of ['第 1 小节','第 2 小节','第 1 小节 · 播放次序 3','第 2 小节 · 播放次序 4','第 3 小节 · 播放次序 5','第 4 小节 · 播放次序 6'].entries()) {
    await range.fill(String(index));
    await expect(range).toHaveAttribute('aria-valuetext',label);
  }
  await page.getByRole('button',{name:'练习设置',exact:true}).click();
  await page.locator('summary').filter({hasText:'片段循环'}).click();
  assert.deepEqual(await page.getByLabel('循环起点',{exact:true}).locator('option').allTextContents(),['第 1 小节','第 2 小节','第 1 小节 · 播放次序 3','第 2 小节 · 播放次序 4','第 3 小节 · 播放次序 5','第 4 小节 · 播放次序 6']);
});
