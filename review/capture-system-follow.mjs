import { chromium, webkit, expect } from '@playwright/test';
import { startStorageFixture } from '../browser-tests/storage-fixture.mjs';
import { musicXmlFixture } from '../browser-tests/musicxml-fixture.mjs';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
const engine=process.env.ENGINE||'chromium', phase=process.env.PHASE||'before';
const output=`artifacts/verification/system-follow/${phase}-${engine}`;await mkdir(output,{recursive:true});
const originalSession=await readFile('packages/player/dist/session.js','utf8');
let instrumented=phase==='before'?await readFile('/tmp/follow-baseline/session.baseline.js','utf8'):phase==='candidate'?await readFile('/tmp/system-follow-after.js','utf8'):originalSession;
if(phase==='instant')instrumented=instrumented.replace('Boolean(state.playing &&','Boolean(false && state.playing &&');
instrumented=instrumented.replace('const api = createPlaybackApi(', 'const api = window.__followApi = createPlaybackApi(').replace('return {\n        getSnapshot:', 'return window.__followSession = {\n        getSnapshot:');
await writeFile('packages/player/dist/session.js',instrumented);
const fixture=await startStorageFixture({authenticated:true,previewEntry:false,script:'dev'});let browser;
try{
 browser=await ({chromium,webkit})[engine].launch();
 const context=await browser.newContext({locale:'zh-CN',viewport:{width:390,height:640},hasTouch:true,serviceWorkers:'block',recordVideo:{dir:output,size:{width:390,height:640}}});
 await context.route('**/playback/**',async route=>{const path='dist/client'+new URL(route.request().url()).pathname;try{await route.fulfill({body:await readFile(path),contentType:path.endsWith('.json')?'application/json':path.endsWith('.woff2')?'font/woff2':'application/octet-stream'});}catch{await route.continue();}});

 await context.addInitScript(()=>{localStorage.setItem('reader-gesture-hint-seen','true');window.__trace=[];});
 await context.request.post(fixture.origin+'/api/auth/sign-in/email',{headers:{origin:fixture.origin},data:{email:fixture.accounts[0].email,password:fixture.accounts[0].password}});
 // Alternate whole notes with eight eighth notes to produce unequal measure widths.
 const bytes=Buffer.from(musicXmlFixture(32).toString().replaceAll('<divisions>1</divisions>','<divisions>8</divisions>').replaceAll('<duration>4</duration>','<duration>32</duration>').replace(/<measure number="(\d+)">([\s\S]*?)<\/measure>/g,(all,n,body)=>Number(n)%2?all:`<measure number="${n}">${body.replace(/<note>[\s\S]*?<\/note>/,Array.from({length:4},(_,i)=>`<note><pitch><step>${['C','D','E','F'][i%4]}</step><octave>4</octave></pitch><duration>8</duration><type>quarter</type></note>`).join(''))}</measure>`));
 let xml=bytes.toString();xml=xml.replace('</part-list>','<score-part id="P2"><part-name>Tenor</part-name></score-part><score-part id="P3"><part-name>Bass</part-name></score-part></part-list>');const extra=xml.match(/<part id="P1">[\s\S]*?<\/part>/)[0];xml=xml.replace('</score-partwise>',extra.replace('id="P1"','id="P2"')+extra.replace('id="P1"','id="P3"')+'</score-partwise>').replaceAll('</note>','<lyric number="1"><text>la</text></lyric><lyric number="2"><text>la</text></lyric></note>');const uploadBytes=Buffer.from(xml);await writeFile(`${output}/sample.musicxml`,uploadBytes);
 const id=crypto.randomUUID();const upload=await context.request.post(`${fixture.origin}/api/choirs/${fixture.choirId}/scores/${fixture.scoreId}/attachments/${id}/file?name=system-follow.musicxml&size=${uploadBytes.length}`,{data:uploadBytes,headers:{'content-length':String(uploadBytes.length)}});if(upload.status()!==201)throw Error(await upload.text());
 console.log('uploaded');const pageCreated=Date.now();const page=await context.newPage();page.on('request',r=>{if(r.url().includes('session.js')) console.log('SESSION',r.url());});page.on('pageerror',e=>console.error('PAGE',e.message));page.on('console',m=>{if(m.type()==='error')console.error('CONSOLE',m.text());});page.on('requestfailed',r=>console.error('FAILED',r.url(),r.failure()));
 await page.goto(`${fixture.origin}/choirs/${fixture.choirId}/scores/${fixture.scoreId}`);
 await expect(page.locator('canvas[data-pdf-canvas-active]').first()).toBeVisible({timeout:20000});await page.locator('.page-reader__viewport').click({position:{x:180,y:300}});
 await page.getByRole('button',{name:'练习谱',exact:true}).click();await page.getByRole('button',{name:'system-follow.musicxml',exact:true}).click();
 await page.screenshot({path:`${output}/opening.png`});const bar=page.getByTestId('musicxml-player');await expect(bar.getByRole('button',{name:'播放',exact:true})).toBeEnabled({timeout:60000});
 await page.screenshot({path:`${output}/ready.png`});console.log('ready',await page.evaluate(()=>({api:!!window.__followApi,systems:window.__followApi?.boundsLookup?.staffSystems.length})));await page.waitForFunction(()=>window.__followApi?.boundsLookup?.staffSystems.length>3,null,{timeout:10000});
 const data=await page.evaluate(()=>{const a=window.__followApi;window.__rows=a.boundsLookup.staffSystems.map((r,i)=>({i,y:r.realBounds.y,h:r.realBounds.h,bars:r.bars.map(b=>({index:b.index,y:b.realBounds.y,x:b.realBounds.x}))}));return {rows:window.__rows,view:document.querySelector('.practice-notation-scroll').getBoundingClientRect().toJSON()};});console.log(JSON.stringify(data));
 await page.evaluate(()=>{const a=window.__followApi,v=document.querySelector('.practice-notation-scroll');a.playerPositionChanged.on(e=>window.__trace.push({tick:e.currentTick,scroll:v.scrollTop}));});
{
 const slider=bar.getByRole('slider',{name:'播放进度',exact:true});await expect(slider).toHaveValue('0');
 await page.evaluate(()=>{window.__trace=[];window.__frames=[];const v=document.querySelector('.practice-notation-scroll');window.__record=true;const frame=()=>{window.__frames.push({time:performance.now(),scroll:v.scrollTop});if(window.__record)requestAnimationFrame(frame);};requestAnimationFrame(frame);});
 const clipStart=(Date.now()-pageCreated)/1000;
 await bar.getByRole('button',{name:'播放',exact:true}).click();
 for(let index=0;index<4;index++) {await expect(slider).toHaveValue(String(index),{timeout:5000});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await page.screenshot({path:`${output}/natural-${index+1}.png`});}
 await page.evaluate(()=>new Promise(resolve=>{let n=0;const step=()=>++n>=12?resolve():requestAnimationFrame(step);requestAnimationFrame(step);}));
 await bar.getByRole('button',{name:'暂停',exact:true}).click();await page.evaluate(()=>window.__record=false);
 const natural=await page.evaluate(()=>({positions:window.__trace,frames:window.__frames}));
 await writeFile(`${output}/natural.json`,JSON.stringify({clipStart,clipDuration:(Date.now()-pageCreated)/1000-clipStart,...natural},null,2));
 }
 await writeFile(`${output}/layout.json`,JSON.stringify(data,null,2));
 if(phase==='final'){
  const viewport=page.locator('.practice-notation-scroll');await viewport.hover();await page.mouse.wheel(0,120);
  await expect(page.getByRole('button',{name:'恢复自动跟随'})).toBeVisible();
  const manual=await viewport.evaluate(e=>e.scrollTop);
  await page.evaluate(()=>window.__followSession.seek(4));await expect(bar.getByRole('slider',{name:'播放进度',exact:true})).toHaveValue('4');
  if(await viewport.evaluate(e=>e.scrollTop)!==manual)throw Error('manual seek moved viewport');
  await page.getByRole('button',{name:'恢复自动跟随'}).click();await expect(page.getByRole('button',{name:'恢复自动跟随'})).toHaveCount(0);
  await page.evaluate(()=>window.__followSession.loop(2,3));
  await bar.getByRole('button',{name:'播放',exact:true}).click();
  await expect(bar.getByRole('slider',{name:'播放进度',exact:true})).toHaveValue('3',{timeout:5000});
  await expect(bar.getByRole('slider',{name:'播放进度',exact:true})).toHaveValue('2',{timeout:5000});
  await bar.getByRole('button',{name:'暂停',exact:true}).click();
  await page.evaluate(()=>{window.__followSession.notationScale(.7);window.__followSession.lyricSize(17);});
  await page.waitForFunction(()=>window.__followApi.boundsLookup.staffSystems[0].realBounds.h>270);
  await writeFile(`${output}/checks.json`,JSON.stringify({manualBrowse:true,manualSeekPreservesScroll:true,restore:true,loopBack:true,reflow:true}));
 }
  const video=page.video();await context.close();await video.saveAs(`${output}/recording.webm`);
}finally{await browser?.close();await fixture.stop();await writeFile('packages/player/dist/session.js',originalSession);}
