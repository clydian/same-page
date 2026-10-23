import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
const { webkit } = createRequire(process.cwd() + '/package.json')(process.env.PLAYWRIGHT_PACKAGE??'playwright');
const browser = await webkit.launch();
const html = '<!doctype html><h1>probe</h1>';
const sw = `self.addEventListener('install',e=>e.waitUntil(self.skipWaiting()));self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));self.addEventListener('fetch',e=>{if(e.request.mode==='navigate')e.respondWith(Promise.resolve(new Response(${JSON.stringify(html)},{headers:{'Content-Type':'text/html'}})));});`;
const records = [];
try {
 for (let round=0; round<Number(process.env.ROUNDS??3); round++) for(const mode of ['online','reset','refused']) for(const update of [false,true]) {
  let offline=false;
  const events=[];
  const server=createServer((req,res)=>{events.push({time:Date.now(),url:req.url,offline});if(offline){res.destroy();return;}res.setHeader('Content-Type', req.url==='/sw.js'?'text/javascript':'text/html');res.end(req.url==='/sw.js'?sw:html);});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
  const context=await browser.newContext();const page=await context.newPage();page.setDefaultTimeout(10000);
  let serverClosed=false;
  try {
   await page.goto(origin);
   await page.evaluate(async()=>{await navigator.serviceWorker.register('/sw.js');await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller)await new Promise(r=>navigator.serviceWorker.addEventListener('controllerchange',r,{once:true}));});
   if(mode==='reset')offline=true;
   if(mode==='refused'){await new Promise(r=>server.close(r));serverClosed=true;}
   await page.reload();
   if(update) await page.evaluate(()=>{window.updateResult='pending';navigator.serviceWorker.getRegistration().then(reg=>reg.update()).then(()=>window.updateResult='resolved',e=>window.updateResult=String(e));});
   // Read registration before and after a pending update has had the same 22s
   // window as the original failure. Never repair/re-register after the trigger.
   const sample=()=>page.evaluate(async()=>({controller:navigator.serviceWorker.controller?.state??null,registration:!!await navigator.serviceWorker.getRegistration(),registrations:(await navigator.serviceWorker.getRegistrations()).length,heading:document.querySelector('h1')?.textContent,updateResult:window.updateResult??null}));
   const immediate=await sample();
   const delay=Number(process.env.OBSERVE_MS??0);if(delay)await new Promise(r=>setTimeout(r,delay));
   const final=await sample();const record={round,mode,update,immediate,final,events};records.push(record);console.log(JSON.stringify(record));
   assert.equal(final.heading,'probe');assert.equal(final.registration,true,'registration disappeared');assert.equal(final.registrations,1);
  } finally {await context.close();if(!serverClosed){server.closeAllConnections();await new Promise(r=>server.close(r));}}
 }
} finally {await browser.close();}
