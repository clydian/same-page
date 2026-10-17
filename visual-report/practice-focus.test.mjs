import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { chromium, webkit, expect } from '@playwright/test';
import { startViteServer } from '../scripts/vite-server.mjs';
import { createVisualFixtureSession } from './fixtures.mjs';
import { practiceMusicXml } from './practice-fixture.mjs';

let server;
before(async () => {
  await promisify(execFile)('npm', ['run', 'build'], { cwd: process.cwd(), timeout: 180000, maxBuffer: 4 * 1024 * 1024 });
  server = await startViteServer({ script: 'preview', cwd: process.cwd() });
}, { timeout: 240000 });
after(async () => { await server?.stop(); });
const engines = process.env.PRACTICE_TEST_ENGINES?.split(',') ?? ['chromium', 'webkit'];
const evidence = 'artifacts/verification/practice-focus';
const denseXml = practiceMusicXml.replace(/<note>[\s\S]*?<\/note>/g, note => note.replace('<duration>4</duration>', '<duration>2</duration>').replace('<type>quarter</type>', '<type>eighth</type>').repeat(2));
for (const name of engines) test(`${name}: floating tools, direct zoom, transport preference, safe areas and fullscreen`, { timeout: 180000 }, async t => {
  const browser = await ({ chromium, webkit })[name].launch({ headless: true, ...(name === 'chromium' && process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
  t.after(() => browser.close());
  const fixture = createVisualFixtureSession({ id: 'reader-practice-focus' });
  const open = async (width, height) => {
    const page = await browser.newPage({ viewport: { width, height }, hasTouch: true, reducedMotion: 'reduce', locale: 'zh-CN' });
    await page.addInitScript(() => localStorage.setItem('reader-gesture-hint-seen', 'true'));
    await page.route('**/api/**', async route => {
      const request = route.request(), pathname = new URL(request.url()).pathname;
      const response = fixture.resolve({ pathname, method: request.method(), identity: 'member', cookie: request.headers().cookie ?? '' });
      if (pathname.endsWith('/practice-xml/file')) response.body = denseXml;
      await route.fulfill(response);
    });
    await page.goto(`${server.origin}/choirs/visual-choir/scores/visual-score`);
    await page.locator('.page-reader__sheet[data-page-turn-current] [data-pdf-canvas-active]').waitFor();
    await page.locator('.page-reader__viewport').click();
    await page.getByRole('button', { name: '练习谱', exact: true }).click();
    await page.getByRole('button', { name: '声部练习版.musicxml', exact: true }).click();
    await page.locator('.practice-bar').waitFor();
    await checkTransport(page); // Loading notices must not move the rightmost toggle inward.
    await page.locator('.practice-notation[data-visible] .at-surface').waitFor();
    await expect(page.getByRole('button', { name: '播放', exact: true })).toBeEnabled();
    return page;
  };
  const checkTools = async page => {
    const geometry = await page.locator('.practice-header').evaluate(header => {
      const box=header.getBoundingClientRect();
      return { x:box.x,right:box.right,width:box.width, viewport:innerWidth, items:[...header.querySelectorAll('button')].filter(el=>el.getBoundingClientRect().width).map(el=>{const r=el.getBoundingClientRect();return {label:el.getAttribute('aria-label'),x:r.x,right:r.right,y:r.y,bottom:r.bottom,width:r.width,height:r.height};}) };
    });
    assert.ok(geometry.x >= 0 && geometry.right <= geometry.viewport && geometry.width < geometry.viewport, JSON.stringify(geometry));
    for (const item of geometry.items) assert.ok(item.width >= 44 && item.height >= 44, JSON.stringify(item));
    for (let i=0;i<geometry.items.length;i++) for (let j=i+1;j<geometry.items.length;j++) {
      const a=geometry.items[i],b=geometry.items[j];
      assert.ok(a.right<=b.x || b.right<=a.x || a.bottom<=b.y || b.bottom<=a.y, `overlapping tools: ${JSON.stringify([a,b])}`);
    }
    await expect(page.getByRole('button', { name: '缩小谱面', exact:true })).toBeVisible();
    await expect(page.getByRole('button', { name: '放大谱面', exact:true })).toBeVisible();
    return geometry;
  };
  const checkTransport = async page => {
    const result=await page.locator('.practice-bar').evaluate(bar=>{
      const items=[...bar.querySelectorAll('button,select')].filter(el=>el.getBoundingClientRect().width).map(el=>{const r=el.getBoundingClientRect();return {label:el.getAttribute('aria-label'),x:r.x,right:r.right,width:r.width,height:r.height};});
      return {width:innerWidth,safeRight:parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--safe-right'))||0,items};
    });
    const sorted=[...result.items].sort((a,b)=>a.x-b.x);
    for (let i=0;i<sorted.length;i++) {
      assert.ok(sorted[i].x>=0 && sorted[i].right<=result.width && sorted[i].width>=44 && sorted[i].height>=44,JSON.stringify(sorted[i]));
      if(i) assert.ok(sorted[i].x>=sorted[i-1].right,JSON.stringify(sorted));
    }
    assert.match(sorted.at(-1).label,/展开播放控制|收起播放控制/);
    assert.equal(sorted.at(-2).label,'练习设置');
    assert.ok(sorted.at(-1).right>=result.width-Math.max(8,result.safeRight)-12,JSON.stringify(result));
    return result;
  };
  const checkFollowedSystem = async page => expect.poll(()=>page.locator('.at-cursor-bar').evaluate(cursor=>{
    const bar=cursor.getBoundingClientRect(),tools=document.querySelector('.practice-header').getBoundingClientRect(),area=cursor.closest('.practice-notation-scroll').getBoundingClientRect();
    const top=Math.max(area.top+8,bar.right>tools.left && bar.left<tools.right ? tools.bottom+8 : area.top+8);
    return bar.top>=top && bar.top<area.bottom-44 && (bar.height>area.bottom-top || bar.bottom<=area.bottom);
  })).toBe(true).catch(async error => {
    await page.screenshot({path:`${evidence}/${name}-occlusion-failure.png`});
    console.error(await page.locator('.at-cursor-bar').evaluate(cursor=>({cursor:cursor.getBoundingClientRect().toJSON(),tools:document.querySelector('.practice-header').getBoundingClientRect().toJSON(),area:cursor.closest('.practice-notation-scroll').getBoundingClientRect().toJSON(),scroll:cursor.closest('.practice-notation-scroll').scrollTop,following:!document.querySelector('.practice-follow')})));
    throw error;
  });
  await mkdir(evidence,{recursive:true});
  const landscape = await open(844,390);
  await expect(landscape.getByRole('button',{name:'展开播放控制'})).toBeVisible();
  await checkTools(landscape); await checkTransport(landscape); await checkFollowedSystem(landscape);
  assert.equal(await landscape.locator('.practice-notation-scroll').evaluate(el=>el.getBoundingClientRect().height),390);
  await landscape.screenshot({path:`${evidence}/${name}-landscape-default.png`});
  await landscape.getByRole('button',{name:'展开播放控制'}).click();
  await checkTransport(landscape);
  await landscape.screenshot({path:`${evidence}/${name}-landscape-expanded.png`});
  await landscape.setViewportSize({width:390,height:844});
  await expect(landscape.getByRole('button',{name:'收起播放控制'})).toBeVisible();
  await landscape.getByRole('button',{name:'收起播放控制'}).click();
  await landscape.setViewportSize({width:844,height:390});
  await expect(landscape.getByRole('button',{name:'展开播放控制'})).toBeVisible();
  // Menus and focus remain usable while the viewport rotates.
  await landscape.getByRole('button',{name:'练习设置',exact:true}).click();
  await landscape.setViewportSize({width:390,height:844});
  await expect(landscape.getByRole('dialog',{name:'练习设置'})).toBeVisible();
  await landscape.getByRole('button',{name:'关闭练习设置'}).click();
  await expect(landscape.getByRole('button',{name:'展开播放控制'})).toBeVisible();
  await landscape.close();

  const page = await open(390,844);
  const header = page.locator('.practice-header');
  await expect(page.getByRole('button',{name:'收起播放控制'})).toBeVisible();
  await checkTools(page); await checkTransport(page); await checkFollowedSystem(page);
  await page.screenshot({path:`${evidence}/${name}-portrait-default.png`});
  await page.setViewportSize({width:844,height:390});
  await expect(page.getByRole('button',{name:'收起播放控制'})).toBeVisible();
  await page.setViewportSize({width:320,height:568});
  await checkTools(page); await checkTransport(page);
  // Real separate presses are used because touch/keyboard activation is discrete.
  for(let i=0;i<6;i++) await page.getByRole('button',{name:'放大谱面',exact:true}).click();
  await expect(page.getByRole('button',{name:'谱面大小',exact:true})).toHaveText('120%');
  await page.getByRole('slider',{name:'播放进度'}).fill('12');
  await checkFollowedSystem(page); await checkTools(page);
  await page.screenshot({path:`${evidence}/${name}-small-dense-120.png`});
  await page.addStyleTag({content:':root { --safe-top:20px; --safe-left:28px; --safe-right:28px; }'});
  await expect.poll(async()=> (await header.boundingBox()).x).toBeGreaterThanOrEqual(28);
  await expect.poll(async()=> (await header.boundingBox()).x+(await header.boundingBox()).width).toBeLessThanOrEqual(292);
  await checkTools(page); await checkFollowedSystem(page);
  await page.screenshot({path:`${evidence}/${name}-safe-area.png`});
  await page.addStyleTag({content:':root { --safe-top:0px; --safe-left:0px; --safe-right:0px; }'});
  await page.getByRole('button',{name:'谱面大小',exact:true}).click();
  await expect(page.getByRole('button',{name:'谱面大小',exact:true})).toHaveText('60%');
  const slider=page.getByRole('slider',{name:'播放进度'});
  await slider.focus(); await page.keyboard.down('ArrowRight');
  await page.setViewportSize({width:390,height:844});
  await expect(slider).toBeFocused(); await page.keyboard.up('ArrowRight');
  await page.getByRole('button',{name:'播放',exact:true}).click();
  await expect(page.getByRole('button',{name:'暂停',exact:true})).toBeVisible();
  const region=page.getByRole('region',{name:'滚动谱面'});
  await region.evaluate(el=>{el.dispatchEvent(new WheelEvent('wheel',{bubbles:true,deltaY:120}));el.scrollTop+=120;el.dispatchEvent(new Event('scroll'));});
  const follow=page.getByRole('button',{name:'恢复自动跟随'});
  await expect(follow).toBeVisible();
  const before=await region.boundingBox(); await follow.click(); await expect(follow).toBeHidden();
  assert.deepEqual(await region.boundingBox(),before); await checkFollowedSystem(page);
  await page.getByRole('button',{name:'暂停',exact:true}).click();
  if(await page.evaluate(()=>document.fullscreenEnabled && typeof document.documentElement.requestFullscreen==='function')) {
    await page.getByRole('button',{name:'全屏看谱'}).click();
    await expect(page.getByRole('button',{name:'退出专注'})).toBeEnabled();
    await page.getByRole('button',{name:'显示谱面'}).click();
    await page.locator('.practice-view-option').filter({hasText:'对照'}).click();
    await expect(page.getByRole('button',{name:'退出专注'})).toBeVisible();
    await page.getByRole('button',{name:'显示谱面'}).click();
    await page.locator('.practice-view-option').filter({hasText:'重排谱面'}).click();
    await page.getByRole('button',{name:'退出专注'}).click();
  }
  await page.evaluate(()=>{Object.defineProperty(document,'fullscreenEnabled',{configurable:true,value:true});document.documentElement.requestFullscreen=()=>Promise.reject(new Error('fixture denial'));});
  await page.getByRole('button',{name:'收起播放控制'}).click(); await page.getByRole('button',{name:'展开播放控制'}).click();
  await page.getByRole('button',{name:/全屏看谱|专注看谱/}).click();
  await expect(page.getByRole('status')).toContainText('全屏未能开启');
  await page.getByRole('button',{name:'退出专注'}).click();
  assert.equal(fixture.diagnostics.unmatchedRequests.length,0);
  await writeFile(`${evidence}/${name}-geometry.json`,JSON.stringify({header:await checkTools(page),transport:await checkTransport(page)},null,2));
});
