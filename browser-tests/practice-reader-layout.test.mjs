import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium, webkit, expect } from '@playwright/test';
import { startStorageFixture } from './storage-fixture.mjs';
import { musicXmlFixture } from './musicxml-fixture.mjs';

// Protect visible position, target scrubbing, and shared PDF/XML navigation on touch layouts.
for (const [engine, type] of [['chromium', chromium], ['webkit', webkit]]) test(`practice reader position, reflow and PDF controls (${engine})`, {timeout:120000}, async t => {
  const fixture = await startStorageFixture({authenticated:true, previewEntry:false}); let browser;
  t.after(async () => { try { await browser?.close(); } finally { await fixture.stop(); } });
  browser = await type.launch();
  const context = await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block',hasTouch:true});
  await context.addInitScript(() => localStorage.setItem('reader-gesture-hint-seen','true'));
  await context.request.post(fixture.origin+'/api/auth/sign-in/email',{headers:{origin:fixture.origin},data:{email:fixture.accounts[0].email,password:fixture.accounts[0].password}});
  const bytes = Buffer.from(musicXmlFixture(48).toString().replaceAll('<measure number="1">','<measure number="0" implicit="yes">').replaceAll('<measure number="2">','<measure number="25">')), id = crypto.randomUUID();
  assert.equal((await context.request.post(`${fixture.origin}/api/choirs/${fixture.choirId}/scores/${fixture.scoreId}/attachments/${id}/file?name=layout.xml&size=${bytes.length}`,{data:bytes,headers:{'content-length':String(bytes.length)}})).status(),201);
  const page = await context.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${fixture.origin}/choirs/${fixture.choirId}/scores/${fixture.scoreId}`);
  await expect(page.locator('canvas[data-pdf-canvas-active]').first()).toBeVisible({timeout:20000});
  await page.locator('.page-reader__viewport').click({position:{x:180,y:200}});
  await page.getByRole('button',{name:'本谱附件',exact:true}).click();
  await page.getByRole('button',{name:'layout.xml',exact:true}).click();
  const bar = page.getByTestId('musicxml-player'), header = page.getByRole('banner',{name:'练习看谱'});
  await expect(bar.getByRole('button',{name:'播放',exact:true})).toBeEnabled({timeout:60000});
  await expect(page.locator('.practice-measure-label').first()).toHaveText('0');
  await expect(page.locator('.practice-measure-label').nth(1)).toHaveText('25');
  const range = bar.getByRole('slider',{name:'播放进度',exact:true});
  await range.fill('1'); await expect(bar.locator('.practice-position')).toContainText('第 25 小节');
  await expect(range).toHaveAttribute('aria-valuetext', '第 25 小节 · 播放次序 2');
  await range.fill('2'); await expect(range).toHaveAttribute('aria-valuetext', '第 3 小节');
  await range.fill('0'); await expect(bar.locator('.practice-position')).toContainText('第 0 小节');
  for (const [width,height] of [[320,740],[390,844],[844,390],[820,1180],[1180,820]]) {
    await page.setViewportSize({width,height});
    await expect(bar.locator('.practice-position')).toBeVisible();
    const bounds = await page.locator('.practice-header button,.practice-bar button,.practice-bar select').evaluateAll(elements => elements.map(e => ({label:e.getAttribute('aria-label'),...e.getBoundingClientRect().toJSON()})));
    assert.ok(bounds.every(b => b.x>=0 && b.right<=width && b.height>=44),`practice controls remain reachable with touch targets at ${width}: ${JSON.stringify(bounds)}`);
    const [top, viewport, bottom] = await Promise.all([header.boundingBox(),page.locator('.practice-notation-scroll').boundingBox(),bar.boundingBox()]);
    assert.ok(viewport.y>=top.y+top.height && viewport.y+viewport.height<=bottom.y,'score stays between the two bars');
    await expect.poll(() => page.locator('.practice-notation .at-surface svg').first().evaluate(svg => svg.getBoundingClientRect().right)).toBeLessThanOrEqual(width);
  }
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await expect.poll(async()=>Math.round((await bar.boundingBox()).y+(await bar.boundingBox()).height)).toBe(844);
  // Use real coordinates: preview is visible before release, committed only on release.
  const track = await range.boundingBox();
  await page.mouse.move(track.x+track.width*.25,track.y+track.height/2); await page.mouse.down();
  await page.mouse.move(track.x+track.width*.6,track.y+track.height/2);
  const preview = page.locator('.practice-timeline-preview'); await expect(preview).toBeVisible();
  const target = await range.inputValue(); assert.ok(Number(target)>20);
  await expect(preview).toHaveText(`第 ${Number(target)+1} 小节`);
  const bubble = await preview.boundingBox(); assert.ok(bubble.x>=0 && bubble.x+bubble.width<=390 && bubble.y+bubble.height<track.y,'target stays above thumb and inside screen');
  await expect(bar.locator('.practice-position')).toContainText('第 0 小节');
  await page.mouse.up(); await expect(preview).toHaveCount(0);
  await expect(bar.locator('.practice-position')).toContainText(`第 ${Number(target)+1} 小节`);
  await expect.poll(() => page.locator('.at-cursor-bar').evaluate(cursor => { const b=cursor.getBoundingClientRect(),v=document.querySelector('.practice-notation-scroll').getBoundingClientRect(); return b.y>=v.y && b.y<v.bottom; })).toBe(true);
  await bar.getByRole('button',{name:'前一小节',exact:true}).click(); await expect(range).toHaveValue(String(Number(target)-1));
  await bar.getByRole('button',{name:'后一小节',exact:true}).click(); await expect(range).toHaveValue(target);

  await bar.getByRole('button',{name:'练习设置',exact:true}).click();
  await page.locator('.practice-switch').click();
  await expect(page.getByLabel('标注范围',{exact:true})).toHaveValue('all');
  const degrees = page.locator('.solfege-degree-label'); await expect(degrees).toHaveCount(96);
  await page.getByRole('button',{name:'关闭练习设置',exact:true}).click();
  const scroll = page.locator('.practice-notation-scroll');
  const measureLabels = page.locator('.practice-measure-label');
  // Align a known system deliberately: track-first annotation DOM order can
  // otherwise select a note from a different system after font-dependent reflow.
  const anchorIndex = await measureLabels.evaluateAll(labels => {
    const y=labels[16].getBoundingClientRect().y;
    return labels.findIndex(label => Math.abs(label.getBoundingClientRect().y-y)<1);
  });
  const anchorOffset = () => measureLabels.nth(anchorIndex).evaluate(label =>
    label.getBoundingClientRect().y-document.querySelector('.practice-notation-scroll').getBoundingClientRect().y);
  await scroll.hover(); await page.mouse.wheel(0,await anchorOffset()+4);
  await expect.poll(async()=>Math.abs(await anchorOffset()+4)).toBeLessThan(3);
  await expect(page.getByRole('button',{name:'恢复自动跟随',exact:true})).toBeVisible();
  const beforeOffset = await anchorOffset();
  const oldPosition = await range.inputValue();
  const oldHeight = await page.locator('.at-surface').evaluate(e => e.getBoundingClientRect().height);
  await page.getByRole('button',{name:'放大谱面',exact:true}).click();
  await expect(page.getByRole('button',{name:'恢复默认谱面大小',exact:true})).toHaveText('90%');
  // Reflow changes notation geometry and rebuilds numbers, retaining the browsed system.
  await expect.poll(() => page.locator('.at-surface').evaluate(e => e.getBoundingClientRect().height)).not.toBe(oldHeight);
  await expect(degrees).toHaveCount(96); await expect(range).toHaveValue(oldPosition);
  await expect(page.getByRole('button',{name:'恢复自动跟随',exact:true})).toBeVisible();
  await expect.poll(async()=>Math.abs(await anchorOffset()-beforeOffset)).toBeLessThan(32);
  await page.getByRole('button',{name:'恢复默认谱面大小',exact:true}).click();
  await expect(page.getByRole('button',{name:'恢复默认谱面大小',exact:true})).toHaveText('80%');

  await page.getByRole('button',{name:'原始 PDF',exact:true}).tap();
  await expect(page.getByRole('button',{name:'原始 PDF',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('canvas[data-pdf-canvas-active]').first()).toBeVisible();
  await expect(page.getByRole('group',{name:'谱面大小',exact:true})).toHaveCount(0);
  await page.locator('.page-reader__viewport').click({position:{x:180,y:200}});
  await expect(page.getByLabel('阅读器控制',{exact:true})).toHaveCount(0);
  const pages = page.getByRole('button',{name:/展开页码网格/}); await pages.click();
  await expect(page.getByRole('dialog',{name:'页面总览',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'关闭页面总览',exact:true}).click();
  await page.getByRole('button',{name:'重排谱面',exact:true}).tap(); await expect(range).toHaveValue(oldPosition);
  await page.getByRole('button',{name:'结束播放',exact:true}).click(); await expect(bar).toHaveCount(0);
  if(await page.getByLabel('阅读器控制',{exact:true}).isVisible())await page.locator('.page-reader__viewport').click();
  await expect(page.getByLabel('阅读器控制',{exact:true})).toHaveCount(0);
  await page.locator('.page-reader__viewport').click();
  await expect(page.getByLabel('阅读器控制',{exact:true})).toBeVisible(); assert.deepEqual(errors,[]);
});
