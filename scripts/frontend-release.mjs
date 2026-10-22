import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyRelease } from './release-artifact.mjs';
const hash = data => createHash('sha256').update(data instanceof ArrayBuffer ? new Uint8Array(data) : data).digest('hex');
export function contentType(file) {
  return ({'.html':'text/html; charset=utf-8','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.webmanifest':'application/manifest+json','.wasm':'application/wasm','.png':'image/png','.webp':'image/webp','.ico':'image/x-icon','.woff2':'font/woff2','.woff':'font/woff','.tgz':'application/gzip','.txt':'text/plain','.md':'text/plain'})[path.extname(file)] ?? 'application/octet-stream';
}
export async function frontendManifest(cwd, sha) {
  const sealed = await verifyRelease({ cwd, sha });
  const files = {};
  for (const [name,sha256] of Object.entries(sealed.files)) if(name.startsWith('dist/client/')) {
    const file = name.slice(12);
    if(file === '_headers' || file.endsWith('.map')) continue;
    assert.match(file, /^(?!.*(?:^|\/)\.\.?\/)[a-zA-Z0-9_./@-]+$/);
    files[file] = {sha256, bytes:(await readFile(path.join(cwd,name))).length, contentType:contentType(file)};
  }
  for(const required of ['index.html','sw.js','build.json','shell-manifest.json','manifest.webmanifest']) assert.ok(files[required],`missing ${required}`);
  return { storageDigest: hash(await readFile(path.join(cwd,'dist/release-storage.json'))), buildId:sha, contract:'same-page-storage-v15-sync-v1', files };
}
// Adapter is also used by the local R2 tests. Every key, including claim/seal, is immutable.
export async function immutablePut(bucket,key,body,metadata={}) {
  const sha256=hash(body);
  const object=await bucket.put(key,body,{onlyIf:{etagDoesNotMatch:'*'},customMetadata:{...metadata,sha256}});
  const existing=await bucket.get(key);
  assert.ok(existing, 'release write readback missing');
  assert.equal(hash(await existing.arrayBuffer()),sha256,'immutable release collision');
  return object;
}
export async function uploadFrontend({bucket,cwd,manifest,contract}) {
  const base=`releases/${manifest.buildId}/`, bytes=JSON.stringify(manifest);
  assert.equal(hash(JSON.stringify(contract)),manifest.storageDigest,'storage contract not sealed');
  await immutablePut(bucket,base+'claim.json',bytes);
  for(const [file,entry]of Object.entries(manifest.files)) {
    const body=await readFile(path.join(cwd,'dist/client',file));
    assert.equal(hash(body),entry.sha256);
    await immutablePut(bucket,base+file,body,{contentType:entry.contentType});
  }
  await immutablePut(bucket,base+'storage.json',JSON.stringify(contract));
  await immutablePut(bucket,base+'sealed.json',bytes);
  return hash(bytes);
}
async function main() {
  const [action,sha,baselineFlag]=process.argv.slice(2);
  assert.ok(['upload','admit','initialize','archive-legacy'].includes(action));assert.match(sha??'',/^[a-f0-9]{40}$/);
  const account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN;
  assert.match(account??'',/^[a-f0-9]{32}$/);assert.ok(token);
  const config=JSON.parse(await readFile('wrangler.jsonc','utf8'));
  const db=config.d1_databases[0].database_id;
  const query=async(sql,params=[])=>{
    const response=await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${db}/query`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({sql,params}),signal:AbortSignal.timeout(30000)});
    assert.ok(response.ok,'release catalog request failed');const data=await response.json();assert.ok(data.success,'release catalog query rejected');return data.result[0];
  };
  const pointer=(await query('SELECT stable,beta,revision FROM release_channels WHERE id=1')).results[0];
  if(action==='initialize') assert.equal(baselineFlag,'--initialize-stable','Explicit stable baseline confirmation is required');
  else if(action!=='archive-legacy') assert.ok(pointer||baselineFlag==='--initialize-stable','Initialize the stable bridge before ordinary releases');
  const sdk=createRequire(new URL('../android/package.json',import.meta.url))('@aws-sdk/client-s3');
  const {deriveR2Credentials}=await import('../android/publish.mjs');
  const client=new sdk.S3Client({credentials:await deriveR2Credentials(account,token),region:'auto',endpoint:`https://${account}.r2.cloudflarestorage.com`,requestChecksumCalculation:'WHEN_REQUIRED',responseChecksumValidation:'WHEN_REQUIRED'});
  const Bucket='same-page-frontend-releases';
  const bucket={
    async put(Key,Body,options){try{return await client.send(new sdk.PutObjectCommand({Bucket,Key,Body,IfNoneMatch:'*',ContentType:options.customMetadata.contentType??'application/json',Metadata:options.customMetadata}))}catch(e){if(e.$metadata?.httpStatusCode!==412)throw e;return null}},
    async get(Key){try{const r=await client.send(new sdk.GetObjectCommand({Bucket,Key}));return {arrayBuffer:()=>r.Body.transformToByteArray()}}catch(e){if(e.$metadata?.httpStatusCode!==404)throw e;return null}},
  };
  if(action==='archive-legacy') {
    assert.equal(baselineFlag,'--archive-supported-baseline');
    const artifact=await verifyRelease({cwd:process.cwd(),sha});
    await immutablePut(bucket,`legacy-claims/${sha}.json`,JSON.stringify(artifact));
    for(const file of Object.keys(artifact.files).filter(f=>f.startsWith('dist/client/'))) {
      const name=file.slice(12);
      if(!/^(?:assets|pdfjs|font|soundfont|playback|third-party)\//.test(name)||name.endsWith('.map'))continue;
      await immutablePut(bucket,'legacy/'+name,await readFile(file),{contentType:contentType(name)});
    }
    console.log(`Archived supported legacy resources ${sha}`);return;
  }
  const manifest=await frontendManifest(process.cwd(),sha),contract=JSON.parse(await readFile('dist/release-storage.json','utf8'));
  assert.equal(contract.contract,manifest.contract);
  if(pointer) {
    const prior=await bucket.get(`releases/${pointer.stable}/storage.json`);assert.ok(prior);
    const priorBytes=await prior.arrayBuffer();
    const priorSeal=await bucket.get(`releases/${pointer.stable}/sealed.json`);assert.ok(priorSeal);
    const priorManifest=JSON.parse(new TextDecoder().decode(await priorSeal.arrayBuffer()));
    assert.equal(hash(priorBytes),priorManifest.storageDigest,'stable storage contract was modified');
    assert.deepEqual(contract,JSON.parse(new TextDecoder().decode(priorBytes)),'storage compatibility changed; a reviewed bridge is required before beta');
  }
  if(action==='upload'||action==='initialize') {
    const digest=await uploadFrontend({bucket,cwd:process.cwd(),manifest,contract});
    await query('INSERT INTO frontend_releases(build_id,manifest_digest,contract,published_at,ready) VALUES(?,?,?,?,0) ON CONFLICT(build_id) DO NOTHING',[sha,digest,contract.contract,Date.now()]);
    const row=(await query('SELECT manifest_digest FROM frontend_releases WHERE build_id=?',[sha])).results[0];assert.equal(row.manifest_digest,digest);
    if(action==='upload') { console.log(`Staged immutable frontend ${sha}; channel pointers unchanged`);return; }
  }
  const record=(await query('SELECT manifest_digest FROM frontend_releases WHERE build_id=?',[sha])).results[0];
  assert.equal(record?.manifest_digest,hash(JSON.stringify(manifest)),'candidate catalog mismatch');
  // This command is only called after online verification; it verifies every fixed byte again.
  const origin=process.env.SAME_PAGE_RELEASE_ORIGIN??'https://samepage.clyapps.com';
  const health=await fetch(new URL('/api/health',origin),{signal:AbortSignal.timeout(15000)});
  assert.equal((await health.json()).buildId,sha,'backend deployment must verify before beta admission');
  for(const [file,entry]of Object.entries(manifest.files)) {
    const response=await fetch(new URL(`/_releases/${sha}/${file}`,origin),{redirect:'error',signal:AbortSignal.timeout(15000)});
    assert.equal(response.status,200,`candidate resource unavailable: ${file}`);assert.equal(hash(new Uint8Array(await response.arrayBuffer())),entry.sha256);
  }
  await query('UPDATE frontend_releases SET ready=1 WHERE build_id=?',[sha]);
  if(action==='initialize') {
    assert.ok(!pointer,'Stable baseline is already initialized');
    await query('INSERT INTO release_channels(id,stable,beta,revision) VALUES(1,?,?,1)',[sha,sha]);
  } else if (pointer.beta !== sha) {
    const result=await query('UPDATE release_channels SET beta=?,revision=revision+1 WHERE id=1 AND revision=? AND stable=?',[sha,pointer.revision,pointer.stable]);
    assert.ok(result.meta.changes,'Channel changed during admission; reverify against current stable');
  }
  console.log(`Admitted frontend ${sha}; stable changes only during explicit initialization or backend promotion`);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
