import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium, webkit } from '@playwright/test';
const code=(await build({entryPoints:['service-worker/sw.ts'],bundle:true,write:false,format:'iife',platform:'browser',target:'es2022'})).outputFiles[0].text;
const ids=['a','b','c'].map(c=>c.repeat(40)),[A,B,C]=ids;
const integrity=s=>'sha256-'+createHash('sha256').update(s).digest('base64');
let stable=A,beta=B;
const data=new Map();
for(const id of ids){
 const html=`<!doctype html><meta name="same-page-build-id" content="${id}"><h1>${id}</h1><script>
 window.fixtureBuild=${JSON.stringify(id)};window.safe=true;
 navigator.serviceWorker.addEventListener('message',e=>{if(e.data.type==='SAME_PAGE_SHELL_PROBE')e.ports[0]?.postMessage({buildId:window.fixtureBuild,cacheName:''});if(e.data.type==='SAME_PAGE_UPDATE_PROBE')e.ports[0]?.postMessage(window.safe)});
 navigator.serviceWorker.register('/sw.js',{scope:'/',updateViaCache:'none'});
 </script>`;
 data.set(id,{html,js:`window.chunk=${JSON.stringify(id)}`});
}
const server=createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost'),match=/same-page-channel=(stable|beta)/.exec(req.headers.cookie??'');
 const channel=match?.[1]??'stable',target=channel==='beta'?beta:stable;
 res.setHeader('Cache-Control','private, no-store');
 if(url.pathname==='/api/client-release'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({channel,target,intent:'fixture',revision:1,contract:'same-page-storage-v15-sync-v1'}));return}
 if(url.pathname==='/api/select'){res.setHeader('Set-Cookie',`same-page-channel=${url.searchParams.get('channel')}; Path=/; Max-Age=31536000; SameSite=Lax`);res.end('ok');return}
 if(url.pathname==='/sw.js'){
  const d=data.get(target),entries=[{url:'/',networkUrl:`/_releases/${target}/index.html`,revision:null,integrity:integrity(d.html),bytes:Buffer.byteLength(d.html)},{url:`/_releases/${target}/app.js`,revision:null,integrity:integrity(d.js),bytes:Buffer.byteLength(d.js)}];
  res.setHeader('Content-Type','text/javascript');res.end(`const __SAME_PAGE_BUILD_ID__=${JSON.stringify(target)},__SAME_PAGE_RELEASE_CHANNELS__=true;self.__WB_MANIFEST=${JSON.stringify(entries)};\n${code}`);return;
 }
 const fixed=/^\/_releases\/([a-f0-9]{40})\/(index.html|app.js)$/.exec(url.pathname);
 if(fixed&&data.has(fixed[1])){res.setHeader('Content-Type',fixed[2]==='app.js'?'text/javascript':'text/html');res.end(data.get(fixed[1])[fixed[2]==='app.js'?'js':'html']);return}
 if(url.pathname.startsWith('/_releases/')||url.pathname.startsWith('/api/')){res.statusCode=404;res.end('missing');return}
 res.setHeader('Content-Type','text/html');res.end(data.get(target).html);
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
const results=[];
try{
 for(const [name,type]of [['chromium',chromium],['webkit',webkit]]){
  beta=B; const browser=await type.launch({headless:true});
  try{
   const context=await browser.newContext(),page=await context.newPage();
   await page.goto(origin+'/drives');await page.evaluate(()=>navigator.serviceWorker.ready);await page.reload();
   await page.waitForFunction(()=>navigator.serviceWorker.controller&&window.fixtureBuild==='a'.repeat(40));
   const stage=async channel=>page.evaluate(async channel=>{
     await fetch('/api/select?channel='+channel);await(await navigator.serviceWorker.getRegistration()).update();
     const until=Date.now()+15000;
     while(Date.now()<until){
       const expected=await(await fetch('/api/client-release')).json();const w=(await navigator.serviceWorker.getRegistration()).waiting;
       if(w&&w.state==='installed'){
         const identity=await new Promise(resolve=>{const m=new MessageChannel();const t=setTimeout(()=>resolve(null),1000);m.port1.onmessage=e=>{clearTimeout(t);resolve(e.data)};w.postMessage({type:'SAME_PAGE_SHELL_IDENTITY'},[m.port2])});
         if(identity?.buildId===expected.target){window.waitingWorker=w;return}
       }
       await new Promise(resolve=>setTimeout(resolve,50));
     }throw Error('candidate did not become ready');
   },channel);
   const apply=()=>page.evaluate(async()=>{const waiting=window.waitingWorker;return await new Promise(resolve=>{const m=new MessageChannel();m.port1.onmessage=e=>resolve(e.data);waiting.postMessage({type:'SAME_PAGE_SAFE_UPDATE',requested:true},[m.port2])})});
   const active=async id=>{await page.waitForFunction(async id=>{const c=navigator.serviceWorker.controller;if(!c)return false;return await new Promise(resolve=>{const m=new MessageChannel();m.port1.onmessage=e=>resolve(e.data?.buildId===id);c.postMessage({type:'SAME_PAGE_SHELL_IDENTITY'},[m.port2])})},id);await page.reload();await page.waitForFunction(id=>window.fixtureBuild===id,id)};
   await stage('beta');assert.equal(await page.evaluate(()=>window.fixtureBuild),A);
   const other=await context.newPage();await other.goto(origin+'/drives');await other.evaluate(()=>window.safe=false);
   assert.equal((await apply()).safe,false);await other.close();
   assert.equal((await apply()).safe,true);await active(B);
   await stage('stable');assert.equal((await apply()).safe,true);await active(A);
   await stage('beta');await page.evaluate(()=>fetch('/api/select?channel=stable'));assert.equal((await apply()).safe,false);
   // Force automatic activation of the now-stale beta by removing all clients.
   await page.close();const recovered=await context.newPage();await recovered.goto(origin+'/drives');
   await recovered.waitForFunction(()=>window.fixtureBuild==='a'.repeat(40));
   beta=C;const cold=await browser.newContext(),p=await cold.newPage();await p.goto(origin+'/choirs/new');await p.waitForFunction(()=>window.fixtureBuild==='a'.repeat(40));
   await cold.close();await context.close();results.push({browser:name,version:browser.version(),coldStable:true,roundtrip:true,busyWindowVeto:true,staleCandidateRejected:true,staleAutomaticActivationCannotDisplayBeta:true});
  }finally{await browser.close()}
 }
 await mkdir('artifacts/verification',{recursive:true});await writeFile('artifacts/verification/release-channels.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results));
}finally{await new Promise(r=>server.close(r))}
