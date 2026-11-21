import { chromium, webkit, expect } from '@playwright/test';
import { startStorageFixture } from '../browser-tests/storage-fixture.mjs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
const engine=process.env.ENGINE||'chromium',fast=process.env.FAST==='1';const output=`artifacts/verification/system-follow-final/${engine}${fast?'-fast':''}`;await mkdir(output,{recursive:true});
const assetBuild=JSON.parse(await readFile('dist/client/build.json','utf8')).buildId;
const original=await readFile('packages/player/dist/session.js','utf8');
const instrumented=original.replace('const api = createPlaybackApi(', 'const api = window.__followApi = createPlaybackApi(').replace('return {\n        getSnapshot:', 'return window.__followSession = {\n        getSnapshot:');

await writeFile('packages/player/dist/session.js',instrumented);
let fixture,browser;
try{
 fixture=await startStorageFixture({authenticated:true,previewEntry:false,script:'dev'});
 browser=await ({chromium,webkit})[engine].launch();const context=await browser.newContext({locale:'zh-CN',viewport:{width:390,height:640},hasTouch:true,serviceWorkers:'block',recordVideo:{dir:output,size:{width:768,height:900}}});
 await context.route('**/playback/**',async route=>{const path='dist/client'+new URL(route.request().url()).pathname.replace(/\/playback\/[^/]+\//,`/playback/${assetBuild}/`);try{await route.fulfill({body:await readFile(path),contentType:path.endsWith('.json')?'application/json':path.endsWith('.woff2')?'font/woff2':'application/octet-stream'});}catch{await route.continue();}});
 await context.addInitScript(()=>{localStorage.setItem('reader-gesture-hint-seen','true');});
 await context.request.post(fixture.origin+'/api/auth/sign-in/email',{headers:{origin:fixture.origin},data:{email:fixture.accounts[0].email,password:fixture.accounts[0].password}});
 let xml=(await readFile(process.env.SCORE_XML||'artifacts/verification/system-follow-final/sample.musicxml','utf8')).replace(/tempo="(?:72|80)"/g,`tempo="${fast?180:72}"`);
 if(fast)xml=xml.replace(/<measure\b[^>]*>[\s\S]*?<\/measure>/g,bar=>bar.replace(/<note>(?:(?!<note>)[\s\S])*?<\/note>(?=<\/measure>)/,note=>note.includes('<type>quarter</type>')?note.replace('<duration>8</duration>','<duration>4</duration>').replace('<type>quarter</type>','<type>eighth</type>').repeat(2):note));
 if(fast)xml=xml.replace(/<note>(?:(?!<note>)[\s\S])*?<type>whole<\/type>(?:(?!<note>)[\s\S])*?<\/note>/g,n=>n.replace('<duration>32</duration>','<duration>8</duration>').replace('<type>whole</type>','<type>quarter</type>').repeat(3)+n.replace('<duration>32</duration>','<duration>4</duration>').replace('<type>whole</type>','<type>eighth</type>').repeat(2));
 const bytes=Buffer.from(xml);await writeFile(`${output}/sample.musicxml`,bytes);
 const id=crypto.randomUUID();const r=await context.request.post(`${fixture.origin}/api/choirs/${fixture.choirId}/scores/${fixture.scoreId}/attachments/${id}/file?name=transition.musicxml&size=${bytes.length}`,{data:bytes,headers:{'content-length':String(bytes.length)}});if(r.status()!==201)throw Error(await r.text());
 const pageCreated=Date.now(),page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`${fixture.origin}/choirs/${fixture.choirId}/scores/${fixture.scoreId}`);await expect(page.locator('canvas[data-pdf-canvas-active]').first()).toBeVisible({timeout:20000});await page.locator('.page-reader__viewport').click({position:{x:180,y:300}});await page.getByRole('button',{name:'练习谱',exact:true}).click();await page.getByRole('button',{name:'transition.musicxml',exact:true}).click();
 const bar=page.getByTestId('musicxml-player');await expect(bar.getByRole('button',{name:'播放',exact:true})).toBeEnabled({timeout:60000});await page.waitForFunction(()=>window.__followApi?.boundsLookup?.staffSystems.length>3);
 await page.evaluate(()=>{
  window.__moves=[];window.__layout=0;window.__followApi.postRenderFinished.on(()=>window.__layout++);
  window.__positions=[];window.__followApi.playerPositionChanged.on(e=>{window.__tick=e.currentTick;if(window.__record)window.__positions.push({time:performance.now(),tick:e.currentTick,measure:window.__followSession.getSnapshot().measure,isSeek:e.isSeek,currentTime:e.currentTime,scroll:document.querySelector('.practice-notation-scroll').scrollTop});});
  window.__sample=()=>{
   const sampleBegan=performance.now();const a=window.__followApi,s=window.__followSession.getSnapshot(),v=document.querySelector('.practice-notation-scroll'),paper=document.querySelector('.practice-notation-paper > div');
   const m=a.tickCache.masterBars[s.measure]?.masterBar,sys=m&&a.boundsLookup.findMasterBar(m)?.staffSystemBounds;
   const area=v.getBoundingClientRect(),origin=paper.getBoundingClientRect(),scale=paper.offsetWidth?origin.width/paper.offsetWidth:1;
   const clearance=parseFloat(getComputedStyle(v).scrollPaddingTop)||16;
   const box=r=>({top:origin.top+r.y*scale,bottom:origin.top+(r.y+r.h)*scale,left:origin.left+r.x*scale,right:origin.left+(r.x+r.w)*scale});
   const current=sys&&box(sys.realBounds),last=m&&a.boundsLookup.findMasterBar(m);
   const notes=last?.bars.flatMap(b=>b.beats.at(-1)?.notes?.map(n=>box(n.noteHeadBounds))??[])??[];
   const visible=r=>r.top>=area.top+clearance-1&&r.bottom<=area.bottom-8;
   return {sampleMs:performance.now()-sampleBegan,time:performance.now(),tick:window.__tick??0,measure:s.measure,playing:s.playing,following:s.following,scroll:v.scrollTop,system:sys&&a.boundsLookup.staffSystems.indexOf(sys),area:{top:area.top,bottom:area.bottom,clearance},current,notes,notesVisible:notes.length?notes.every(visible):null};
  };
 });
 await page.evaluate(async()=>{const {ScoreFollowScroll}=await import('/packages/player/dist/score-follow.js');const move=ScoreFollowScroll.prototype.move;ScoreFollowScroll.prototype.move=function(target,deadline){if(window.__record)window.__moves.push({time:performance.now(),tick:window.__tick,target,deadline,from:document.querySelector('.practice-notation-scroll').scrollTop});return move.call(this,target,deadline);};});
 const cases=[];for(const width of [390,768])for(const speed of fast?[2]:[1,1.5])cases.push({width,height:width===390?640:900,speed,bpm:fast?180:72});
 if(process.env.CHECKS==='1')for(const check of ['manual','seek','loop','visible','reduce','reflow','resize'])cases.push({width:check==='visible'?768:390,height:check==='visible'?900:640,speed:1,bpm:72,check});
 for(const cfg of cases){
  const name=`${cfg.width}-${cfg.speed}${cfg.check?`-${cfg.check}`:''}`;console.log('START',name);
  await page.emulateMedia({reducedMotion:cfg.check==='reduce'?'reduce':'no-preference'});
  await page.evaluate(()=>window.__followSession.pause());await page.waitForFunction(()=>!window.__followSession.getSnapshot().playing);
  if(page.viewportSize().width!==cfg.width){const previous=await page.evaluate(()=>window.__layout);await page.setViewportSize({width:cfg.width,height:cfg.height});await page.waitForFunction(n=>window.__layout>n,previous);}
  const layout=await page.evaluate(()=>{const a=window.__followApi,v=document.querySelector('.practice-notation-scroll'),p=document.querySelector('.practice-notation-paper > div'),o=p.getBoundingClientRect(),view=v.getBoundingClientRect(),scale=o.width/p.offsetWidth;return {rows:a.boundsLookup.staffSystems.map(s=>({index:a.boundsLookup.staffSystems.indexOf(s),y:s.realBounds.y,h:s.realBounds.h,bars:s.bars.map(b=>b.index)})),view:view.toJSON(),paperOffset:o.top+v.scrollTop,scale};});
  const target=cfg.check==='visible'?layout.rows[1]:layout.rows.find(row=>layout.paperOffset+(row.y+row.h)*layout.scale>layout.view.bottom-8),targetIndex=target.bars[0],startIndex=targetIndex-1;
  if(startIndex<0)throw Error('no full previous system');
  await page.evaluate(({cfg,startIndex})=>{const s=window.__followSession;s.loop(null);s.speed(cfg.speed);s.seek(startIndex);s.follow();},{cfg,startIndex});
  await page.waitForFunction(i=>window.__followSession.getSnapshot().measure===i&&Math.abs(window.__followApi.tickPosition-window.__followSession.getSnapshot().measures[i].startTick)<5,startIndex);
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  if(cfg.check==='loop')await page.evaluate(({startIndex,targetIndex})=>window.__followSession.loop(startIndex,targetIndex),{startIndex,targetIndex});
  const initialScroll=0;
  await page.evaluate(initialScroll=>{document.querySelector('.practice-notation-scroll').scrollTop=initialScroll;window.__frames=[];window.__positions=[];window.__moves=[];window.__record=true;const frame=()=>{if(!window.__record)return;window.__frames.push(window.__sample());requestAnimationFrame(frame);};requestAnimationFrame(frame);},initialScroll);
  const clipStart=(Date.now()-pageCreated)/1000;await bar.getByRole('button',{name:'播放',exact:true}).click();
  let action;
  if(['manual','seek','reflow','resize'].includes(cfg.check)){
   if(cfg.check==='manual')await page.mouse.move(380,300);
   await page.waitForFunction(()=>window.__moves.some(m=>m.deadline!==undefined),null,{polling:'raf',timeout:10000});action=await page.evaluate(()=>window.__sample());
   if(cfg.check==='manual'){await page.mouse.wheel(0,-80);await page.waitForFunction(()=>window.__followSession.getSnapshot().following===false);}else if(cfg.check==='reflow'){const layout=await page.evaluate(()=>window.__layout);await page.evaluate(()=>{window.__followSession.notationScale(.7);window.__followSession.lyricSize(17);});await page.waitForFunction(n=>window.__layout>n,layout);}else if(cfg.check==='resize'){await page.setViewportSize({width:390,height:700});}else{await page.evaluate(i=>window.__followSession.seek(i),targetIndex+2);await page.waitForFunction(i=>window.__followSession.getSnapshot().measure===i,targetIndex+2);}
  }else{
  await page.waitForFunction(i=>window.__followSession.getSnapshot().measure===i,targetIndex,{timeout:15000});await page.screenshot({path:`${output}/${name}-entry.png`});
  await page.waitForFunction(i=>window.__followSession.getSnapshot().measure===i,cfg.check==='loop'?startIndex:targetIndex+1,{timeout:10000});
  }
  await page.evaluate(()=>new Promise(r=>{let n=0;const frame=()=>++n===25?r():requestAnimationFrame(frame);requestAnimationFrame(frame);}));
  await page.screenshot({path:`${output}/${name}-second.png`});await page.evaluate(()=>{window.__record=false;window.__followSession.pause();});
  const result=await page.evaluate(()=>({frames:window.__frames,positions:window.__positions,moves:window.__moves}));await writeFile(`${output}/${name}.json`,JSON.stringify({cfg,layout,targetIndex,startIndex,initialScroll,action,clipStart,clipEnd:(Date.now()-pageCreated)/1000,...result}));console.log('DONE',name,'target',targetIndex+1);
 }
 if(errors.length)throw Error(errors.join('\n'));const video=page.video();await context.close();await video.saveAs(`${output}/all.webm`);
}finally{await browser?.close();await fixture?.stop();await writeFile('packages/player/dist/session.js',original);}
