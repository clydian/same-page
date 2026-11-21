import {chromium} from 'playwright';
import {PDFDocument, rgb, StandardFonts} from 'pdf-lib';
import {createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {startVisualServer} from './visual-report/setup.mjs';
import {resolveFixtureRequest} from './visual-report/fixtures.mjs';
const out=process.argv[2]||'/tmp/pager-evidence/delayed-before';
const server=await startVisualServer({script:'dev'});
const browser=await chromium.launch({headless:true});
try {
const pdf=await PDFDocument.create(); const font=await pdf.embedFont(StandardFonts.HelveticaBold);
for(let n=1;n<=6;n++){ const p=pdf.addPage(process.env.MIXED && n%2===0 ? [1000,600] : [600,840]);p.drawRectangle({x:0,y:0,width:p.getWidth(),height:p.getHeight(),color:rgb(n%3===1?.9:.7,n%3===2?.9:.7,n%3===0?.9:.7)});p.drawText(`PAGE ${n}`,{x:40,y:300,size:80,font});for(let y=80;y<280;y+=30)p.drawLine({start:{x:30,y},end:{x:p.getWidth()-30,y},thickness:2});}
const bytes=Buffer.from(await pdf.save());
const score=JSON.parse(resolveFixtureRequest({pathname:'/api/choirs/visual-choir/scores/visual-score/sync',identity:'member'}).body).score;
score.currentVersion={...score.currentVersion,sizeBytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
for(const width of [1194]) {
 const context=await browser.newContext({locale:'zh-CN',viewport:{width,height:width===390?844:width===1194?834:1100},hasTouch:true,serviceWorkers:'block'});
 await context.route('**/api/**',route=>route.fulfill(resolveFixtureRequest({pathname:new URL(route.request().url()).pathname,method:route.request().method(),identity:'member',scenarioId:'reader-controls-narrow',cookie:'',pdf:bytes,selectedScore:score})));

 if(process.env.DELAY) await context.route('**/src/client/reader/pdf-page.tsx',async route=>{const response=await route.fetch();const source=await response.text();if(!source.includes('return task.promise;'))throw new Error('delay injection missing');await route.fulfill({response,body:source.replace('return task.promise;', 'return task.promise.then(() => pageNumber === 3 ? new Promise(resolve => setTimeout(resolve, 1000)) : undefined);')});});
 await context.addInitScript(()=>localStorage.setItem('reader-gesture-hint-seen','true'));
 const page=await context.newPage();page.on('pageerror',e=>console.log('pageerror',e.message));
 await page.goto(`${server.origin}/choirs/visual-choir/scores/visual-score`);
 await page.locator('[data-page-number="2"] [data-pdf-canvas-active]').waitFor();await page.waitForTimeout(500);
 const cdp=await context.newCDPSession(page);let shots=[];cdp.on('Page.screencastFrame',async f=>{shots.push({data:f.data,time:f.metadata.timestamp});await cdp.send('Page.screencastFrameAck',{sessionId:f.sessionId});});
 await cdp.send('Page.startScreencast',{format:'png',everyNthFrame:1});
 await page.evaluate(()=>{window.rows=[];window.running=true;window.captureStart=performance.now();const sample=()=>{const e=document.querySelector('.page-reader__viewport'),track=e.querySelector('.page-reader__pager-track');window.rows.push({t:performance.now()-window.captureStart,phase:track.dataset.pageTurnPhase,progress:track.dataset.pageTurnProgress,pages:[...e.querySelectorAll('.page-reader__sheet')].map(p=>{const r=p.querySelector('.annotated-pdf-page').getBoundingClientRect();return {page:p.dataset.pageNumber,current:p.hasAttribute('data-page-turn-current'),x:r.x,y:r.y,w:r.width,h:r.height,active:!!p.querySelector('[data-pdf-canvas-active]')};})});if(window.running)requestAnimationFrame(sample);};sample();});
 const frame=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));
 const metrics=()=>page.evaluate(()=>Object.fromEntries([1,2].map(n=>[n,document.querySelector(`[data-page-number="${n}"] .annotated-pdf-page`).getBoundingClientRect().x])));
 const send=(type,x)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'?[]:[{x,y:350,id:1}]});
 const takeovers=[];
 const swipe=async(takeover=false)=>{await send('touchStart',width*.8);for(let n=1;n<=6;n++){const x=width*.8-(takeover&&n===1?12:width*.07*n);let before;if(takeover&&n===1)before=await metrics();await send('touchMove',x);await frame();if(takeover&&n===1){await frame();takeovers.push({before,after:await metrics(),fingerDelta:-12});}}await send('touchEnd',width*.38);};
 await swipe();await page.waitForTimeout(55);await swipe(true);await page.waitForTimeout(1500);
 const samples=await page.evaluate(()=>{window.running=false;return {rows:window.rows};});samples.takeovers=takeovers;
 const checks={forward:await page.locator('[data-page-turn-current]').getAttribute('data-page-number')};
 const reverse=async()=>{await send('touchStart',width*.2);for(let n=1;n<=6;n++){await send('touchMove',width*(.2+.07*n));await frame();}await send('touchEnd',width*.62);};
 await reverse();await page.waitForTimeout(55);await reverse();await page.waitForTimeout(1500);checks.reverse=await page.locator('[data-page-turn-current]').getAttribute('data-page-number');
 await page.mouse.dblclick(width/2,350,{delay:80});await page.waitForTimeout(250);checks.doubleTapZoom=await page.locator('.page-reader__viewport').getAttribute('data-zoom');
 await page.mouse.dblclick(width/2,350,{delay:80});await page.waitForTimeout(250);checks.restoreZoom=await page.locator('.page-reader__viewport').getAttribute('data-zoom');
 samples.checks=checks;console.log('checks',checks);
 await cdp.send('Page.stopScreencast');await writeFile(`${out}-${width}.json`,JSON.stringify(samples));
 const {mkdir}=await import('node:fs/promises');await mkdir(`${out}-${width}`,{recursive:true});for(let i=0;i<shots.length;i++)await writeFile(`${out}-${width}/${String(i).padStart(3,'0')}.png`,Buffer.from(shots[i].data,'base64'));
 await writeFile(`${out}-${width}/times.json`,JSON.stringify(shots.map(x=>x.time)));console.log(width,samples.takeovers,samples.rows.length,'frames',shots.length,'last',samples.rows.at(-1));await context.close();
}
}finally{await browser.close();await server.stop();}
