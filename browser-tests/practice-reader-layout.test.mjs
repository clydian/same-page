import { selectPracticeView, changeNotationSize } from './practice-controls.mjs';
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
  const context = await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block',hasTouch:true,isMobile:engine === 'chromium'});
  await context.addInitScript(() => localStorage.setItem('reader-gesture-hint-seen','true'));
  await context.request.post(fixture.origin+'/api/auth/sign-in/email',{headers:{origin:fixture.origin},data:{email:fixture.accounts[0].email,password:fixture.accounts[0].password}});
  const bytes = Buffer.from(musicXmlFixture(128).toString().replaceAll('<measure number="1">','<measure number="0" implicit="yes">').replaceAll('<measure number="2">','<measure number="25">').replaceAll(/(<measure[^>]*>)/g,'$1<print new-system="yes"/>')), id = crypto.randomUUID();
  assert.equal((await context.request.post(`${fixture.origin}/api/choirs/${fixture.choirId}/scores/${fixture.scoreId}/attachments/${id}/file?name=layout.xml&size=${bytes.length}`,{data:bytes,headers:{'content-length':String(bytes.length)}})).status(),201);
  const page = await context.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${fixture.origin}/choirs/${fixture.choirId}/scores/${fixture.scoreId}`);
  await expect(page.locator('canvas[data-pdf-canvas-active]').first()).toBeVisible({timeout:20000});
  await page.locator('.page-reader__viewport').click({position:{x:180,y:200}});
  await page.getByRole('button',{name:'练习谱',exact:true}).click();
  await page.getByRole('button',{name:'layout.xml',exact:true}).click();
  const bar = page.getByTestId('musicxml-player'), header = page.getByRole('banner',{name:'练习看谱'});
  await expect(bar.getByRole('button',{name:'播放',exact:true})).toBeEnabled({timeout:60000});
  await expect(page.locator('.practice-measure-label').first()).toHaveText('0');
  await expect(page.locator('.practice-measure-label').nth(1)).toHaveText('25');
  const size = page.getByRole('button',{name:'谱面大小',exact:true});
  await expect(size).toHaveText('60%');
  // A native mobile pinch must resize notation, never the browser or transport.
  const pinch = async (from, to) => {
    if (engine === 'chromium') {
      const cdp = await context.newCDPSession(page);
      const points = distance => [{x:195-distance/2,y:300,id:1},{x:195+distance/2,y:300,id:2}];
      await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:points(from)});
      for (let step=1;step<=10;step++) await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:points(from+(to-from)*step/10)});
      await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
      await cdp.detach();
    } else {
      // WebKit's automation protocol has no multi-touch input command.
      await page.locator('.practice-notation-scroll').evaluate((element,{from,to}) => {
        const send = (type,distance) => {
          const touches = distance ? [{identifier:1,target:element,clientX:195-distance/2,clientY:300},{identifier:2,target:element,clientX:195+distance/2,clientY:300}] : [];
          const event = new Event(type,{bubbles:true,cancelable:true});
          Object.defineProperty(event,'touches',{value:touches});
          element.dispatchEvent(event);
        };
        send('touchstart',from);send('touchmove',to);send('touchend',0);
      },{from,to});
    }
  };
  const chromeBefore = await bar.boundingBox();
  await pinch(80,120);
  await expect(size).toHaveText('90%');
  assert.equal(await page.evaluate(()=>visualViewport.scale),1,'pinch never magnifies the whole page');
  assert.deepEqual(await bar.boundingBox(),chromeBefore,'playback controls retain their geometry');
  await pinch(120,80);
  await expect(size).toHaveText('60%');
  await expect(page.getByRole('button',{name:'恢复自动跟随',exact:true})).toHaveCount(0);
  if (engine === 'chromium') {
    const scroll = page.locator('.practice-notation-scroll');
    const cdp = await context.newCDPSession(page);
    await scroll.evaluate(element => { element.scrollTop = 0; });
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:195,y:500,id:1}]});
    for (let y=480;y>=300;y-=20) await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:195,y,id:1}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await cdp.detach();
    await expect.poll(()=>scroll.evaluate(element=>element.scrollTop)).toBeGreaterThan(0);
    await page.getByRole('button',{name:'恢复自动跟随',exact:true}).click();
  }

  const rowCount = () => page.locator('.practice-measure-label').evaluateAll(labels => new Set(labels.map(label => Math.round(label.getBoundingClientRect().top))).size);
  await expect.poll(() => page.locator('.practice-measure-label').evaluateAll(labels => labels.length < 2 ? Infinity : Math.abs(labels[0].getBoundingClientRect().top-labels[1].getBoundingClientRect().top))).toBeLessThan(1);
  await changeNotationSize(page, '缩小谱面', 3);
  await expect(size).toHaveText('30%');
  await size.click();
  await expect(page.getByRole('button',{name:'缩小谱面',exact:true})).toBeDisabled();
  await page.keyboard.press('Escape');
  const compactRows = await rowCount();
  await changeNotationSize(page, '放大谱面', 9);
  await expect(size).toHaveText('120%');
  await expect.poll(rowCount).toBeGreaterThan(compactRows);
  await changeNotationSize(page, '恢复默认谱面大小');
  const range = bar.getByRole('slider',{name:'播放进度',exact:true});
  await range.fill('1'); await expect(bar.locator('.practice-position')).toHaveText('25');
  await expect(range).toHaveAttribute('aria-valuetext', '第 25 小节 · 播放次序 2');
  await range.fill('2'); await expect(range).toHaveAttribute('aria-valuetext', '第 3 小节');
  await range.fill('0'); await expect(bar.locator('.practice-position')).toHaveText('0');
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
  await expect(bar.locator('.practice-position')).toHaveText('0');
  await page.mouse.up(); await expect(preview).toHaveCount(0);
  await expect(bar.locator('.practice-position')).toHaveText(String(Number(target)+1));
  await expect.poll(() => page.locator('.at-cursor-bar').evaluate(cursor => { const b=cursor.getBoundingClientRect(),v=document.querySelector('.practice-notation-scroll').getBoundingClientRect(); return b.y>=v.y && b.y<v.bottom; })).toBe(true);
  await bar.getByRole('button',{name:'前一小节',exact:true}).click(); await expect(range).toHaveValue(String(Number(target)-1));
  await bar.getByRole('button',{name:'后一小节',exact:true}).click(); await expect(range).toHaveValue(target);

  await bar.getByRole('button',{name:'练习设置',exact:true}).click();
  await page.locator('.practice-switch').click();
  await expect(page.getByLabel('标注范围',{exact:true})).toHaveValue('all');
  const degrees = page.locator('.solfege-degree-label'); await expect(degrees).toHaveCount(256);
  await page.getByRole('button',{name:'关闭练习设置',exact:true}).click();
  const scroll = page.locator('.practice-notation-scroll');
  const measureLabels = page.locator('.practice-measure-label');
  // Align a known system deliberately: track-first annotation DOM order can
  // otherwise select a note from a different system after font-dependent reflow.
  // Keep enough systems after this anchor even at the compact default to avoid scroll-end clamping.
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
  const oldDegreeSize = await degrees.first().evaluate(label => parseFloat(getComputedStyle(label).fontSize));
  const oldPosition = await range.inputValue();
  const oldHeight = await page.locator('.at-surface').evaluate(e => e.getBoundingClientRect().height);
  await changeNotationSize(page, '放大谱面');
  await expect(page.getByRole('button',{name:'谱面大小',exact:true})).toHaveText('70%');
  // Reflow changes notation geometry and rebuilds numbers, retaining the browsed system.
  await expect.poll(() => page.locator('.at-surface').evaluate(e => e.getBoundingClientRect().height)).not.toBe(oldHeight);
  await expect(degrees).toHaveCount(256);
  await expect.poll(() => degrees.first().evaluate(label => parseFloat(getComputedStyle(label).fontSize))).toBeGreaterThan(oldDegreeSize);
  await expect(range).toHaveValue(oldPosition);
  await expect(page.getByRole('button',{name:'恢复自动跟随',exact:true})).toBeVisible();
  await expect.poll(async()=>Math.abs(await anchorOffset()-beforeOffset)).toBeLessThan(32);
  await changeNotationSize(page, '恢复默认谱面大小');
  await expect(page.getByRole('button',{name:'谱面大小',exact:true})).toHaveText('60%');

  await selectPracticeView(page, '原始 PDF');
  await expect(page.getByRole('button',{name:'显示谱面',exact:true})).toHaveText('原始 PDF');
  await expect(page.locator('canvas[data-pdf-canvas-active]').first()).toBeVisible();
  await expect(page.getByRole('button',{name:'谱面大小',exact:true})).toHaveCount(0);
  await page.locator('.page-reader__viewport').click({position:{x:180,y:200}});
  await expect(page.getByLabel('阅读器控制',{exact:true})).toHaveCount(0);
  const pages = page.getByRole('button',{name:/展开页码网格/}); await pages.click();
  await expect(page.getByRole('dialog',{name:'页面总览',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'关闭页面总览',exact:true}).click();
  await selectPracticeView(page, '重排谱面'); await expect(range).toHaveValue(oldPosition);
  await page.getByRole('button',{name:'结束播放',exact:true}).click(); await expect(bar).toHaveCount(0);
  // Ending removes both insets; let the ordinary reader measure its restored
  // viewport before starting a tap that resize cancellation would invalidate.
  await expect.poll(async () => Math.round((await page.locator('.page-reader__viewport').boundingBox()).height)).toBe(844);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  if(await page.getByLabel('阅读器控制',{exact:true}).isVisible())await page.locator('.page-reader__viewport').click();
  await expect(page.getByLabel('阅读器控制',{exact:true})).toHaveCount(0);
  await page.locator('.page-reader__viewport').click();
  await expect(page.getByLabel('阅读器控制',{exact:true})).toBeVisible(); assert.deepEqual(errors,[]);
});
