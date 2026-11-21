import { chromium, expect } from '@playwright/test';
import { startStorageFixture } from '../browser-tests/storage-fixture.mjs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
const output='artifacts/verification/follow-explore';await mkdir(output,{recursive:true});
const original=await readFile('packages/player/dist/session.js','utf8');
const instrumented=original.replace("const getFollowVariant = () => 'boundary';","const getFollowVariant = () => window.__followVariant;").replace('const api = createPlaybackApi(', 'const api = window.__followApi = createPlaybackApi(').replace('return {\n        getSnapshot:', 'return window.__followSession = {\n        getSnapshot:');
if(!instrumented.includes('window.__followVariant'))throw Error('instrumentation mismatch');
await writeFile('packages/player/dist/session.js',instrumented);
let fixture,browser;
try{
 fixture=await startStorageFixture({authenticated:true,previewEntry:false,script:'dev'});
 browser=await chromium.launch();const context=await browser.newContext({locale:'zh-CN',viewport:{width:390,height:640},hasTouch:true,serviceWorkers:'block',recordVideo:{dir:output,size:{width:768,height:900}}});
 await context.route('**/playback/**',async route=>{const path='dist/client'+new URL(route.request().url()).pathname.replace(/\/playback\/[^/]+\//,'/playback/05b2951748119544426f4417a0a6da0f2c1ce370/');try{await route.fulfill({body:await readFile(path),contentType:path.endsWith('.json')?'application/json':path.endsWith('.woff2')?'font/woff2':'application/octet-stream'});}catch{await route.continue();}});
 await context.addInitScript(()=>{localStorage.setItem('reader-gesture-hint-seen','true');window.__followVariant='boundary';});
 await context.request.post(fixture.origin+'/api/auth/sign-in/email',{headers:{origin:fixture.origin},data:{email:fixture.accounts[0].email,password:fixture.accounts[0].password}});
 const bytes=Buffer.from((await readFile('/tmp/follow-explore/sample.musicxml','utf8')).replaceAll('tempo="80"','tempo="72"'));await writeFile(`${output}/sample.musicxml`,bytes);
 const id=crypto.randomUUID();const r=await context.request.post(`${fixture.origin}/api/choirs/${fixture.choirId}/scores/${fixture.scoreId}/attachments/${id}/file?name=transition.musicxml&size=${bytes.length}`,{data:bytes,headers:{'content-length':String(bytes.length)}});if(r.status()!==201)throw Error(await r.text());
 const pageCreated=Date.now(),page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`${fixture.origin}/choirs/${fixture.choirId}/scores/${fixture.scoreId}`);await expect(page.locator('canvas[data-pdf-canvas-active]').first()).toBeVisible({timeout:20000});await page.locator('.page-reader__viewport').click({position:{x:180,y:300}});await page.getByRole('button',{name:'练习谱',exact:true}).click();await page.getByRole('button',{name:'transition.musicxml',exact:true}).click();
 const bar=page.getByTestId('musicxml-player');await expect(bar.getByRole('button',{name:'播放',exact:true})).toBeEnabled({timeout:60000});await page.waitForFunction(()=>window.__followApi?.boundsLookup?.staffSystems.length>3);
 await page.evaluate(()=>{
  window.__layout=0;window.__followApi.postRenderFinished.on(()=>window.__layout++);
  window.__positions=[];window.__followApi.playerPositionChanged.on(e=>{window.__tick=e.currentTick;if(window.__record)window.__positions.push({time:performance.now(),tick:e.currentTick,measure:window.__followSession.getSnapshot().measure,isSeek:e.isSeek});});
  window.__sample=()=>{
   const a=window.__followApi,s=window.__followSession.getSnapshot(),v=document.querySelector('.practice-notation-scroll'),paper=document.querySelector('.practice-notation-paper > div');
   const m=a.tickCache.masterBars[s.measure]?.masterBar,sys=m&&a.boundsLookup.findMasterBar(m)?.staffSystemBounds;
   const area=v.getBoundingClientRect(),origin=paper.getBoundingClientRect(),scale=paper.offsetWidth?origin.width/paper.offsetWidth:1;
   const clearance=parseFloat(getComputedStyle(v).scrollPaddingTop)||16;
   const box=r=>({top:origin.top+r.y*scale,bottom:origin.top+(r.y+r.h)*scale,left:origin.left+r.x*scale,right:origin.left+(r.x+r.w)*scale});
   const current=sys&&box(sys.realBounds),last=sys?.bars.at(-1),lastBox=last&&box(last.realBounds);
   const notes=last?.bars.flatMap(b=>b.beats.at(-1)?.notes?.map(n=>box(n.noteHeadBounds))??[])??[];
   const lyrics=current&&lastBox?[...paper.querySelectorAll('.at-surface svg text')].filter(e=>e.textContent==='la').map(e=>e.getBoundingClientRect()).filter(r=>r.top>=current.top-1&&r.bottom<=current.bottom+1&&r.left>=lastBox.left-1&&r.right<=lastBox.right+1).map(r=>({top:r.top,bottom:r.bottom,left:r.left,right:r.right})):[];
   const visible=r=>r.top>=area.top+clearance-1&&r.bottom<=area.bottom-8;
   return {time:performance.now(),tick:window.__tick??0,measure:s.measure,playing:s.playing,following:s.following,scroll:v.scrollTop,system:sys&&a.boundsLookup.staffSystems.indexOf(sys),area:{top:area.top,bottom:area.bottom,clearance},current,notes,lyrics,notesVisible:notes.length?notes.every(visible):null,lyricsVisible:lyrics.length?lyrics.every(visible):null};
  };
 });
 const cases=[];for(const width of [390,768])for(const speed of [1,1.5])for(const variant of ['instant','boundary','pre'])cases.push({width,height:width===390?640:900,speed,variant});cases.push({width:390,height:640,speed:.5,variant:'pre'});
 for(const cfg of cases){
  const name=`${cfg.width}-${cfg.speed}-${cfg.variant}`;console.log('START',name);
  await page.evaluate(()=>window.__followSession.pause());await page.waitForFunction(()=>!window.__followSession.getSnapshot().playing);
  if(page.viewportSize().width!==cfg.width){const previous=await page.evaluate(()=>window.__layout);await page.setViewportSize({width:cfg.width,height:cfg.height});await page.waitForFunction(n=>window.__layout>n,previous);}
  const layout=await page.evaluate(()=>{const a=window.__followApi,v=document.querySelector('.practice-notation-scroll'),p=document.querySelector('.practice-notation-paper > div'),o=p.getBoundingClientRect(),view=v.getBoundingClientRect(),scale=o.width/p.offsetWidth;return {rows:a.boundsLookup.staffSystems.map(s=>({index:a.boundsLookup.staffSystems.indexOf(s),y:s.realBounds.y,h:s.realBounds.h,bars:s.bars.map(b=>b.index)})),view:view.toJSON(),paperOffset:o.top+v.scrollTop,scale};});
  const target=layout.rows.find(row=>layout.paperOffset+(row.y+row.h)*layout.scale>layout.view.bottom-8),targetIndex=target.bars[0],startIndex=targetIndex-1;
  if(startIndex<0)throw Error('no full previous system');
  await page.evaluate(({cfg,startIndex})=>{window.__followVariant=cfg.variant;const s=window.__followSession;s.loop(null);s.speed(cfg.speed);s.seek(startIndex);s.follow();},{cfg,startIndex});
  await page.waitForFunction(i=>window.__followSession.getSnapshot().measure===i&&Math.abs(window.__followApi.tickPosition-window.__followSession.getSnapshot().measures[i].startTick)<5,startIndex);
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  await page.evaluate(()=>{document.querySelector('.practice-notation-scroll').scrollTop=0;window.__frames=[];window.__positions=[];window.__record=true;const frame=()=>{if(!window.__record)return;window.__frames.push(window.__sample());requestAnimationFrame(frame);};requestAnimationFrame(frame);});
  const clipStart=(Date.now()-pageCreated)/1000;await bar.getByRole('button',{name:'播放',exact:true}).click();
  await page.waitForFunction(i=>window.__followSession.getSnapshot().measure===i,targetIndex,{timeout:15000});await page.screenshot({path:`${output}/${name}-entry.png`});
  await page.waitForFunction(i=>window.__followSession.getSnapshot().measure===i,targetIndex+1,{timeout:10000});
  await page.evaluate(()=>new Promise(r=>{let n=0;const frame=()=>++n===15?r():requestAnimationFrame(frame);requestAnimationFrame(frame);}));
  await page.screenshot({path:`${output}/${name}-second.png`});await page.evaluate(()=>{window.__record=false;window.__followSession.pause();});
  const result=await page.evaluate(()=>({frames:window.__frames,positions:window.__positions}));await writeFile(`${output}/${name}.json`,JSON.stringify({cfg,layout,targetIndex,startIndex,clipStart,clipEnd:(Date.now()-pageCreated)/1000,...result}));console.log('DONE',name,'target',targetIndex+1);
 }
 if(errors.length)throw Error(errors.join('\n'));const video=page.video();await context.close();await video.saveAs(`${output}/all.webm`);
}finally{await browser?.close();await fixture?.stop();await writeFile('packages/player/dist/session.js',original);}
