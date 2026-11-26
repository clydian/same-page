import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium, devices } from '@playwright/test';
import { resolveFixtureRequest } from './visual-report/fixtures.mjs';

const root=path.resolve('dist/client');
const { buildId }=JSON.parse(await readFile(path.join(root,'build.json'),'utf8'));
const manifest=JSON.parse(await readFile(path.join(root,'shell-manifest.json'),'utf8'));
const html=await readFile(path.join(root,'index.html'));
const extensionTypes={'.js':'text/javascript','.mjs':'text/javascript','.html':'text/html','.css':'text/css','.json':'application/json','.webmanifest':'application/manifest+json','.png':'image/png','.webp':'image/webp','.wasm':'application/wasm','.woff2':'font/woff2','.pdf':'application/pdf','.xml':'application/xml','.svg':'image/svg+xml'};
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const oldSource=execFileSync('git',['show','1fc85b0:service-worker/shell-runtime.ts'],{encoding:'utf8'});
const workers={};
for(const name of ['before','after']){
 const plugins=name==='before'?[{name:'baseline-shell-runtime',setup(b){b.onLoad({filter:/shell-runtime\.ts$/},()=>({contents:oldSource,loader:'ts',resolveDir:path.resolve('service-worker')}))}}]:[];
 const code=(await build({entryPoints:['service-worker/sw.ts'],bundle:true,write:false,format:'iife',platform:'browser',target:'es2022',plugins})).outputFiles[0].text;
 workers[name]=`const __SAME_PAGE_BUILD_ID__=${JSON.stringify(buildId)},__SAME_PAGE_RELEASE_CHANNELS__=true;self.__WB_MANIFEST=${JSON.stringify(manifest)};\n${code}`;
}
let variant='before', authorityDelay=25, releaseReads=0, requests=[];
const server=createServer(async(req,res)=>{
 try {
  const {pathname}=new URL(req.url,'http://localhost');
  const trace={pathname};requests.push(trace);res.on('finish',()=>trace.status=res.statusCode);
  if(pathname==='/sw.js'){res.writeHead(200,{'Content-Type':'text/javascript','Cache-Control':'no-store'});res.end(workers[variant]);return}
  if(pathname.startsWith('/api/')){
   if(pathname==='/api/client-release'){releaseReads++;await sleep(authorityDelay);}
   else await sleep(60);
   const f=resolveFixtureRequest({pathname,method:req.method,identity:'member',cookie:req.headers.cookie??'',buildId});
   res.writeHead(f.status,{'Content-Type':f.contentType,...f.headers,'Cache-Control':'no-store'});res.end(f.body);return;
  }
  const asset=decodeURIComponent(pathname).replace(new RegExp('^/_releases/'+buildId+'/'),'/');
  const file=path.join(root,asset);
  if(path.extname(asset)||asset.endsWith('/LICENSE')){
   if(!file.startsWith(root+'/')||!(await stat(file)).isFile()){res.writeHead(404);res.end();return}
   res.writeHead(200,{'Content-Type':extensionTypes[path.extname(file)]??'application/octet-stream'});res.end(await readFile(file));return;
  }
  res.writeHead(200,{'Content-Type':'text/html','Cache-Control':'no-store'});res.end(html);
 } catch(e){res.writeHead(e.code==='ENOENT'?404:500);res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
const opts={...devices['Pixel 7'], locale:'zh-CN',headless:true,channel:'chrome'};
const waitScore=async(p)=>p.locator('.file-row__open[href="/choirs/visual-choir/scores/visual-score"]').click({trial:true,timeout:12000});
const perform=async(p,mode)=>{
 const before=releaseReads;
 const doc=await p.goto(origin,{waitUntil:'domcontentloaded',timeout:15000});
 assert.equal(doc?.status(),200);
 if(mode==='offline-shell')await p.locator('#root > *').first().waitFor({timeout:8000});
 else await waitScore(p);
 const data=await p.evaluate(()=>({ttfb:Math.round(performance.getEntriesByType('navigation')[0].responseStart),
  fcp:Math.round(performance.getEntriesByName('first-contentful-paint')[0]?.startTime??0),
  ready:Math.round(performance.now()),controlled:!!navigator.serviceWorker.controller}));
 if(!data.fcp)await p.waitForFunction(()=>performance.getEntriesByName('first-contentful-paint').length>0);
 if(!data.fcp)data.fcp=Math.round(await p.evaluate(()=>performance.getEntriesByName('first-contentful-paint')[0].startTime));
 console.log(JSON.stringify({variant,mode,authorityDelay,viaWorker:doc.fromServiceWorker(),releaseReads:releaseReads-before,...data,frameToReady:data.ready-data.fcp}));
};
try{
 for(variant of ['before','after']){
  const profile=await mkdtemp('/tmp/samepage-benchmark-profile-'); let context;
  try {
   authorityDelay=25;
   context=await chromium.launchPersistentContext(profile,opts);
   await context.addInitScript(()=>{navigator.serviceWorker.addEventListener('message',e=>{if(e.data?.type==='SAME_PAGE_UPDATE_FAILURE')console.warn('bench install failure',e.data.reason);});});
   let p=context.pages()[0]??await context.newPage();
   p.on('console',msg=>{if(msg.text().includes('bench install failure'))console.error(msg.text())});
   await perform(p,'first-visit');
   await p.evaluate(()=>Promise.race([navigator.serviceWorker.ready,new Promise((_,j)=>setTimeout(()=>j(Error('SW not ready')),12000))])).catch(async e=>{
    console.error(JSON.stringify({last:requests.slice(-15),state:await p.evaluate(async()=>{const r=await navigator.serviceWorker.getRegistration();return [r?.installing?.state,r?.waiting?.state,r?.active?.state]})}));throw e;
   });
   for(let n=0;n<3;n++)await perform(p,'warm-fast');
   authorityDelay=600;
   for(let n=0;n<3;n++)await perform(p,'warm-slow');
   for(let n=0;n<3;n++){
    await context.close();
    context=await chromium.launchPersistentContext(profile,opts);
    p=context.pages()[0]??await context.newPage();
    await perform(p,'cold-process-slow');
   }
   await context.setOffline(true);
   await perform(p,'offline-shell');
  } finally {await context?.close();await rm(profile,{recursive:true,force:true});}
 }
} finally {server.closeAllConnections();await new Promise(r=>server.close(r));}
