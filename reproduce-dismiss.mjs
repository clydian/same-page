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
for(let n=1;n<=6;n++){ const p=pdf.addPage([600,840]);p.drawRectangle({x:0,y:0,width:p.getWidth(),height:p.getHeight(),color:rgb(n%3===1?.9:.7,n%3===2?.9:.7,n%3===0?.9:.7)});p.drawText(`PAGE ${n}`,{x:40,y:300,size:80,font});for(let y=80;y<280;y+=30)p.drawLine({start:{x:30,y},end:{x:p.getWidth()-30,y},thickness:2});}
const bytes=Buffer.from(await pdf.save());
const score=JSON.parse(resolveFixtureRequest({pathname:'/api/choirs/visual-choir/scores/visual-score/sync',identity:'member'}).body).score;
score.currentVersion={...score.currentVersion,sizeBytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
for(const width of [390,1194]) {
 const context=await browser.newContext({locale:'zh-CN',viewport:{width,height:width===390?844:width===1194?834:1100},hasTouch:true,serviceWorkers:'block'});
 await context.route('**/api/**',route=>route.fulfill(resolveFixtureRequest({pathname:new URL(route.request().url()).pathname,method:route.request().method(),identity:'member',scenarioId:'reader-controls-narrow',cookie:'',pdf:bytes,selectedScore:score})));

 await context.addInitScript(()=>localStorage.setItem('reader-gesture-hint-seen','true'));
 const page=await context.newPage();page.on('pageerror',e=>console.log('pageerror',e.message));
 await page.goto(`${server.origin}/choirs/visual-choir/scores/visual-score`);
 await page.locator('[data-page-number="2"] [data-pdf-canvas-active]').waitFor();await page.waitForTimeout(500);
 const cdp=await context.newCDPSession(page);let shots=[];cdp.on('Page.screencastFrame',async f=>{shots.push({data:f.data,time:f.metadata.timestamp});await cdp.send('Page.screencastFrameAck',{sessionId:f.sessionId});});
 await cdp.send('Page.startScreencast',{format:'png',everyNthFrame:1});
 const read=()=>page.locator('[data-page-turn-current] .annotated-pdf-page').evaluate(e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,center:r.x+r.width/2};});
 const send=(type,y)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'?[]:[{x:width/2,y,id:1}]});
 const rows=[];rows.push({dy:0,...await read()});
 await send('touchStart',200);
 for(const dy of [20,40,60,80,100]){await send('touchMove',200+dy);await page.waitForTimeout(30);rows.push({dy,...await read()});}
 await send('touchEnd',300);await page.waitForTimeout(220);rows.push({rebounded:true,...await read(),url:page.url()});
 await send('touchStart',200);await send('touchMove',360);await page.waitForTimeout(60);rows.push({dy:160,...await read()});await send('touchEnd',360);await page.waitForTimeout(300);rows.push({dismissed:true,url:page.url()});
 const samples={rows};
 await cdp.send('Page.stopScreencast');await writeFile(`${out}-${width}.json`,JSON.stringify(samples));
 const {mkdir}=await import('node:fs/promises');await mkdir(`${out}-${width}`,{recursive:true});for(let i=0;i<shots.length;i++)await writeFile(`${out}-${width}/${String(i).padStart(3,'0')}.png`,Buffer.from(shots[i].data,'base64'));
 await writeFile(`${out}-${width}/times.json`,JSON.stringify(shots.map(x=>x.time)));console.log(width,JSON.stringify(samples));await context.close();
}
}finally{await browser.close();await server.stop();}
