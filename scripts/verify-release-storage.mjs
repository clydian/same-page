import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp,rm,readFile,writeFile,mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chromium,webkit } from '@playwright/test';
export async function verifyArtifactStorage({stable,candidate}) {
  const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
  assert.equal(digest(stable.bytes),stable.digest);assert.equal(digest(candidate.bytes),candidate.digest);
  const server=createServer((req,res)=>{
    res.setHeader('Cache-Control','no-store');
    if(req.url.startsWith('/stable.js')||req.url.startsWith('/candidate.js')){res.setHeader('Content-Type','text/javascript');res.end(req.url.startsWith('/stable.js')?stable.bytes:candidate.bytes)}
    else{res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Isolated release storage matrix</title>')}
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
  const engines=[];
  try{
    for(const [name,type]of [['chromium',chromium],['webkit',webkit]]) {
      const directory=await mkdtemp(path.join(tmpdir(),'same-page-release-matrix-'));
      let context;
      try {
        // WebKit's ephemeral context on macOS rejects native IDB Blob writes;
        // a fresh persistent profile exercises real disk storage without user data.
        context=await type.launchPersistentContext(directory,{headless:true});const page=await context.newPage();await page.goto(origin);
        for(const [index,role]of ['stable','candidate','stable','candidate'].entries()){
          const expected=role==='stable'?stable.id:candidate.id;
          const value=await page.evaluate(async({role,index})=>{const module=await import(`/${role}.js?phase=${index}`);return await module.phase(role+index,index===0)},{role,index});
          assert.equal(value.sourceBuild,expected);for(const field of ['blob','draft','sync','attemptedOp','conflict','identity'])assert.equal(value[field],true);
        }
        engines.push(name);
      }finally{await context?.close();await rm(directory,{recursive:true,force:true})}
    }
  }finally{await new Promise(r=>server.close(r))}
  return {version:1,stable:stable.id,candidate:candidate.id,stableProbe:stable.digest,candidateProbe:candidate.digest,engines,passed:true};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const [stableFile,candidateFile,stableId,candidateId]=process.argv.slice(2);
  const stableBytes=await readFile(stableFile),candidateBytes=await readFile(candidateFile);
  const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
  const report=await verifyArtifactStorage({stable:{id:stableId,bytes:stableBytes,digest:hash(stableBytes)},candidate:{id:candidateId,bytes:candidateBytes,digest:hash(candidateBytes)}});
  await mkdir('artifacts/verification',{recursive:true});await writeFile('artifacts/verification/release-storage.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}
