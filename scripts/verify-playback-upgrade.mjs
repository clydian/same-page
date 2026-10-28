import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { chromium, expect } from '@playwright/test';
import { zipSync, strToU8 } from 'fflate';
import { createVisualFixtureSession } from '../visual-report/fixtures.mjs';
import { polyphonicMusicXmlFixture } from '../browser-tests/musicxml-fixture.mjs';

// Run with the other sequential PWA lifecycle scripts: builds own immutable
// output copies and browser storage, using synthetic API data and actual players.
const run = promisify(execFile), temporary = await mkdtemp(path.join(tmpdir(),'same-page-playback-upgrade-'));
const ids = ['a'.repeat(40),'b'.repeat(40)];
const roots = new Map(ids.map(id=>[id,path.join(temporary,id)]));
const mxl = Buffer.from(zipSync({'META-INF/container.xml':strToU8('<container><rootfiles><rootfile full-path="score.musicxml"/></rootfiles></container>'),'score.musicxml':strToU8(polyphonicMusicXmlFixture())}));
const fixtures = new Map(ids.map(buildId=>[buildId,createVisualFixtureSession({id:'reader-practice-upgrade',buildId})]));
let selected = ids[0], online = true, failPlayer = false, context, server, page;
let releaseInitial, releaseUpdate;
const initialGate=new Promise(resolve=>{releaseInitial=resolve;}), updateGate=new Promise(resolve=>{releaseUpdate=resolve;});
let holdInitial=true, holdUpdate=true;
const options = {headless:true,serviceWorkers:'allow',viewport:{width:1024,height:768},...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? {executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH} : {})};
try {
  for(const id of ids) {
    await run('npm',['run','build'],{env:{...process.env,SAME_PAGE_BUILD_ID:id,SAME_PAGE_RELEASE_CHANNELS:'1'},timeout:180000,maxBuffer:4*1024*1024});
    await cp('dist/client',roots.get(id),{recursive:true});
    console.log('Built release',id[0]);
  }
  server = createServer(async(request,response)=>{
    if(!online) { response.destroy(); return; }
    try {
      const pathname = new URL(request.url,'http://localhost').pathname;
      response.setHeader('Cache-Control','no-store');
      if(pathname.startsWith('/api/')) {
        const fixture = fixtures.get(selected).resolve({pathname,method:request.method,identity:'member',cookie:''});
        let body = fixture.body;
        if(pathname.endsWith('/practice-xml/file')) {
          body = mxl; fixture.contentType = 'application/vnd.recordare.musicxml';
        } else if(fixture.contentType?.includes('application/json') && typeof body==='string') {
          body = JSON.stringify(JSON.parse(body),(_key,value)=>value && value.id==='practice-xml' ? {...value,name:'升级离线练习.mxl',sizeBytes:mxl.length} : value);
        }
        response.writeHead(fixture.status,{'Content-Type':fixture.contentType,...fixture.headers}); response.end(body); return;
      }
      const prefix = /^\/_releases\/([a-f0-9]{40})\/(.+)$/.exec(pathname);
      const id = prefix?.[1] ?? selected;
      const file = prefix?.[2] ?? (pathname==='/' || !path.extname(pathname) ? 'index.html' : pathname.slice(1));
      if(failPlayer && id===ids[1] && /musicxml-engine-/.test(file)) { response.writeHead(503); response.end(); return; }
      const root = roots.get(id), resolved = root && path.resolve(root,file);
      if(!resolved || !resolved.startsWith(root+path.sep)) { response.writeHead(404); response.end(); return; }
      const bytes = await readFile(resolved);
      const type = {'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.webmanifest':'application/manifest+json','.png':'image/png','.webp':'image/webp','.woff2':'font/woff2','.woff':'font/woff','.otf':'font/otf'}[path.extname(file)] ?? 'application/octet-stream';
      response.writeHead(200,{'Content-Type':type});
      if (/musicxml-engine-/.test(file) && (id===ids[0] && holdInitial || id===ids[1] && holdUpdate)) {
        response.write(bytes.subarray(0,65536));
        await (id===ids[0]?initialGate:updateGate);
        response.end(bytes.subarray(65536));
      } else response.end(bytes);
    } catch { response.writeHead(404); response.end(); }
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`, reader=`${origin}/choirs/visual-choir/scores/visual-score`;
  const profile=path.join(temporary,'profile');
  context=await chromium.launchPersistentContext(profile,options);
  await context.addInitScript(()=>localStorage.setItem('reader-gesture-hint-seen','true'));
  page=await context.newPage(); page.setDefaultTimeout(30000);
  const open=async()=>{
    await page.locator('canvas[data-pdf-canvas-active]').first().waitFor();
    if(!await page.getByRole('button',{name:'练习谱',exact:true}).isVisible()) await page.locator('.page-reader__viewport').click();
    await page.getByRole('button',{name:'练习谱',exact:true}).click();
    await page.getByRole('button',{name:'升级离线练习.mxl',exact:true}).click();
    await expect(page.getByRole('button',{name:'播放',exact:true})).toBeEnabled({timeout:60000});
    await expect(page.locator('.practice-notation .at-surface svg').first()).toBeVisible();
  };
  await page.goto(origin+'/about');
  const initialBar=page.getByRole('progressbar',{name:'更新资源准备进度'});
  await expect(initialBar).toBeVisible();
  await expect.poll(async()=>Number(await initialBar.getAttribute('value'))).toBeGreaterThan(0);
  await expect(page.getByText(/已准备 .* MB \/ .* MB/)).toBeVisible();
  await mkdir('artifacts/verification/playback-upgrade',{recursive:true});
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:'artifacts/verification/playback-upgrade/initial-preparation-progress.png',fullPage:true});
  holdInitial=false; releaseInitial();
  await page.evaluate(()=>navigator.serviceWorker.ready.then(()=>undefined));
  await page.setViewportSize({width:1024,height:768});
  await page.goto(reader);
  await page.reload();
  await page.waitForFunction(()=>Boolean(navigator.serviceWorker.controller));
  await open();
  console.log('Opened MXL in A');
  await page.getByRole('button',{name:'展开播放控制',exact:true}).click();
  await page.getByRole('button',{name:'练习设置',exact:true}).click();
  await expect(page.getByText('此练习谱可离线打开与播放。',{exact:true})).toBeVisible({timeout:60000});
  await page.getByRole('button',{name:'关闭练习设置',exact:true}).click();
  await page.getByRole('button',{name:'结束练习',exact:true}).click();
  const original=await originalRecords(page);
  assert.equal(original.length,1,'A saves the MXL original');
  await page.goto(origin+'/about');
  await expect(page.getByText('检查完成，当前版本继续运行',{exact:true})).toBeVisible();
  console.log('A MXL is offline-ready');
  selected=ids[1]; failPlayer=true;
  await page.evaluate(async()=>{
    const registration=await navigator.serviceWorker.getRegistration(); window.installStates=[];
    registration.addEventListener('updatefound',()=>{const worker=registration.installing;worker.addEventListener('statechange',()=>window.installStates.push(worker.state));});
    await registration.update();
  });
  await page.waitForFunction(()=>window.installStates.includes('redundant'));
  assert.equal(await page.evaluate(()=>document.documentElement.dataset.buildId),ids[0],'an incomplete player cannot replace A');
  console.log('Incomplete B rejected; A retained');
  failPlayer=false;
  await page.getByRole('button',{name:'重试检查更新',exact:true}).click();
  const bar=page.getByRole('progressbar',{name:'更新资源准备进度'});
  await expect(bar).toBeVisible();
  await expect.poll(async()=>Number(await bar.getAttribute('value'))).toBeGreaterThan(0);
  await expect(page.getByText(/^正在下载并准备资源…/)).toBeVisible();
  await expect(page.getByText(/本机复用 (?:[1-9]\d*\.\d|0\.[1-9]) MB · 已接收下载资源 (?:[1-9]\d*\.\d|0\.[1-9]) MB/)).toBeVisible();
  assert.equal(await page.getByRole('button',{name:'准备中…',exact:true}).isDisabled(),true);
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
  await page.screenshot({path:'artifacts/verification/playback-upgrade/update-preparation-progress.png',fullPage:true});
  holdUpdate=false; releaseUpdate();
  await page.setViewportSize({width:1024,height:768});
  await page.waitForFunction(expected=>document.documentElement.dataset.buildId===expected,ids[1],{timeout:60000});
  assert.deepEqual(await originalRecords(page),original,'upgrading preserves the exact saved MXL record');
  assert.equal(await page.evaluate(async()=> (await caches.keys()).some(name=>name.startsWith('same-page-playback-v1:'))),false,'no duplicate per-player bundle');
  console.log('B installed without reopening its player');
  await context.close(); context=null;
  online=false;
  context=await chromium.launchPersistentContext(profile,options); await context.setOffline(true);
  await context.addInitScript(()=>{
    window.__audioAnalysers=[]; const connect=AudioNode.prototype.connect;
    AudioNode.prototype.connect=function(destination,...args){if(destination instanceof AudioDestinationNode){const analyser=this.context.createAnalyser();window.__audioAnalysers.push(analyser);connect.call(this,analyser);connect.call(analyser,destination);return destination;}return connect.call(this,destination,...args);};
  });
  page=await context.newPage(); page.setDefaultTimeout(30000);
  await page.goto(reader);
  assert.equal(await page.evaluate(()=>document.documentElement.dataset.buildId),ids[1]);
  await open();
  await page.getByRole('button',{name:'播放',exact:true}).click();
  await expect(page.getByRole('button',{name:'暂停',exact:true})).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>window.__audioAnalysers.some(analyser=>{const samples=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(samples);return samples.some(value=>Math.abs(value)>.0001);})),{timeout:15000}).toBe(true);
  await page.getByRole('button',{name:'暂停',exact:true}).click();
  await mkdir('artifacts/verification/playback-upgrade',{recursive:true});
  await page.screenshot({path:'artifacts/verification/playback-upgrade/chromium-offline-after-upgrade.png'});
  await page.reload(); await open();
  assert.deepEqual(await originalRecords(page),original);
  console.log('Verified: interrupted player update retains A; complete B installs, preserves MXL, cold-starts offline, renders, plays nonzero audio and reopens after refresh.');
} catch(error) {
  if(page && !page.isClosed()) {
    console.error('Upgrade evidence',await page.evaluate(async()=>{
      const registration=await navigator.serviceWorker.getRegistration();
      const receipt=await new Promise(resolve=>{const channel=new MessageChannel();const timer=setTimeout(()=>resolve('timeout'),3000);channel.port1.onmessage=event=>{clearTimeout(timer);resolve(event.data);};registration?.active?.postMessage({type:'SAME_PAGE_PLAYBACK_READY',buildId:document.documentElement.dataset.buildId},[channel.port2]);});
      const local=await new Promise((resolve,reject)=>{const request=indexedDB.open('same-page');request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result;const names=[...db.objectStoreNames];const t=db.transaction(names);const result={};for(const name of names){const r=t.objectStore(name).getAll();r.onsuccess=()=>{result[name]=r.result.map(row=>({key:row.key,active:row.active,verifiedAt:row.verifiedAt,layerCount:row.annotationSnapshot?.layers?.length,blobBytes:row.blob?.size}));};}t.oncomplete=()=>{db.close();resolve(result);};};});
      return {controller:!!navigator.serviceWorker.controller,receipt,caches:await caches.keys(),local};
    }));
    await mkdir('artifacts/verification/playback-upgrade',{recursive:true});
    await page.screenshot({path:'artifacts/verification/playback-upgrade/failure.png'});
  }
  throw error;
} finally {
  releaseInitial(); releaseUpdate();
  await context?.close();
  await new Promise(resolve=>server ? server.close(resolve) : resolve());
  await rm(temporary,{recursive:true,force:true});
}
async function originalRecords(page) {
  return page.evaluate(()=>new Promise((resolve,reject)=>{
    const request=indexedDB.open('same-page'); request.onerror=()=>reject(request.error); request.onsuccess=()=>{
      const db=request.result, read=db.transaction('system').objectStore('system').getAll();
      read.onerror=()=>{db.close();reject(read.error);};
      read.onsuccess=()=>{db.close();resolve(read.result.filter(row=>row.key.startsWith('["offline-musicxml",')).map(row=>({key:row.key,value:row.value,size:row.blob?.size})));};
    };
  }));
}
