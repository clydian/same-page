import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyRelease } from './release-artifact.mjs';
import { assertStorageCompatibility } from './release-contract.mjs';
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
  return { probeDigest: hash(await readFile(path.join(cwd,'dist/release-storage-probe.js'))), storageDigest: hash(await readFile(path.join(cwd,'dist/release-storage.json'))), buildId:sha, contract:'same-page-storage-v15-sync-v1', files };
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
  const probe=await readFile(path.join(cwd,'dist/release-storage-probe.js'));assert.equal(hash(probe),manifest.probeDigest);
  await immutablePut(bucket,base+'storage-probe.js',probe);
  await immutablePut(bucket,base+'sealed.json',bytes);
  return hash(bytes);
}
export function verifyCompatibilityReport(report, expected) {
  assert.equal(report.version,1);assert.equal(report.passed,true);
  assert.equal(report.stable,expected.stable);assert.equal(report.candidate,expected.candidate);
  assert.equal(report.stableProbe,expected.stableProbe);assert.equal(report.candidateProbe,expected.candidateProbe);
  assert.deepEqual(report.engines,['chromium','webkit']);
}
export function assertInitialChannels(pointer, sha) {
  assert.match(sha ?? '', /^[a-f0-9]{40}$/);
  if (pointer == null) return;
  assert.ok(pointer.stable === sha && pointer.beta === sha && pointer.revision === 1,
    'Stable baseline differs from this exact first initialization');
}
export function assertPrivateReleaseBucket({ managed, custom, lifecycle }) {
  assert.equal(managed?.enabled, false, 'Release bucket r2.dev access must be disabled');
  assert.ok(Array.isArray(custom?.domains), 'Release bucket custom domain configuration is unavailable');
  assert.ok(custom.domains.every(domain => domain.enabled === false), 'Release bucket custom domain access must be disabled');
  assert.ok(lifecycle && (lifecycle.rules === undefined || Array.isArray(lifecycle.rules)), 'Release bucket lifecycle configuration is unavailable');
  // R2's default rule aborts unfinished multipart uploads; it does not expire stored releases.
  assert.ok((lifecycle.rules ?? []).every(rule => typeof rule.enabled === 'boolean' &&
    !(rule.enabled && rule.deleteObjectsTransition)), 'Release bucket object expiration must be disabled');
}
export async function preflightReleaseBucket({ account, token, bucket = 'same-page-frontend-releases', fetchImpl = fetch }) {
  const results = await Promise.all(['domains/managed', 'domains/custom', 'lifecycle'].map(async setting => {
    const response = await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${account}/r2/buckets/${bucket}/${setting}`, {
      headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30000),
    });
    assert.ok(response.ok, `Release bucket ${setting} check failed (HTTP ${response.status})`);
    const data = await response.json();
    assert.equal(data.success, true, `Release bucket ${setting} check rejected`);
    return data.result;
  }));
  assertPrivateReleaseBucket({ managed: results[0], custom: results[1], lifecycle: results[2] });
}
export async function initializeReleaseChannels({ query, sha, pointer }) {
  assertInitialChannels(pointer, sha);
  if (!pointer) await query('INSERT INTO release_channels(id,stable,beta,revision) VALUES(1,?,?,1) ON CONFLICT(id) DO NOTHING', [sha, sha]);
  const initialized = (await query('SELECT stable,beta,revision FROM release_channels WHERE id=1')).results[0];
  assert.ok(initialized, 'Stable baseline initialization did not complete');
  assertInitialChannels(initialized, sha);
  return initialized;
}
export async function stopBetaRelease({ query, expectedBeta, expectedRevision }) {
  assert.match(expectedBeta ?? '', /^[a-f0-9]{40}$/);
  assert.ok(Number.isSafeInteger(expectedRevision) && expectedRevision > 0, 'Expected channel revision is required');
  const result = await query(`UPDATE release_channels SET beta=stable,revision=revision+1
    WHERE id=1 AND beta=? AND revision=? AND beta<>stable
    AND EXISTS(SELECT 1 FROM frontend_releases WHERE build_id=release_channels.stable
      AND ready=1 AND contract='same-page-storage-v15-sync-v1')
    RETURNING stable,beta,revision`, [expectedBeta, expectedRevision]);
  assert.ok(result.results?.length === 1, 'Beta changed, already matches stable, or stable is unavailable; reread channels before retrying');
  return result.results[0];
}
async function main() {
  const [action,sha,baselineFlag]=process.argv.slice(2);
  assert.ok(['preflight','upload','admit','initialize','archive-legacy','stop-beta'].includes(action));assert.match(sha??'',/^[a-f0-9]{40}$/);
  if(action==='stop-beta') assert.match(baselineFlag??'',/^--expected-revision=[1-9]\d*$/,'Pass the observed channel revision explicitly');
  const account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN;
  assert.match(account??'',/^[a-f0-9]{32}$/);assert.ok(token);
  const config=JSON.parse(await readFile('wrangler.jsonc','utf8'));
  const db=config.d1_databases[0].database_id;
  const query=async(sql,params=[])=>{
    const response=await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${db}/query`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({sql,params}),signal:AbortSignal.timeout(30000)});
    assert.ok(response.ok,'release catalog request failed');const data=await response.json();assert.ok(data.success,'release catalog query rejected');return data.result[0];
  };
  if(action==='stop-beta') {
    const pointer=await stopBetaRelease({query,expectedBeta:sha,expectedRevision:Number(baselineFlag.split('=')[1])});
    console.log(JSON.stringify({action,previousBeta:sha,...pointer}));return;
  }
  const pointer=(await query('SELECT stable,beta,revision FROM release_channels WHERE id=1')).results[0];
  if(action==='preflight' || action==='initialize' || baselineFlag==='--initialize-stable') assertInitialChannels(pointer, sha);
  if(action==='preflight') {
    await preflightReleaseBucket({account,token});
    console.log(`Release preflight passed for ${sha}; bucket private, stored objects retained, first initialization state verified`);return;
  }
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
  let stableManifest,stableProbe;
  if(pointer) {
    const prior=await bucket.get(`releases/${pointer.stable}/storage.json`);assert.ok(prior);
    const priorBytes=await prior.arrayBuffer();
    const priorSeal=await bucket.get(`releases/${pointer.stable}/sealed.json`);assert.ok(priorSeal);
    const priorManifest=JSON.parse(new TextDecoder().decode(await priorSeal.arrayBuffer()));
    const stableCatalog=(await query('SELECT manifest_digest FROM frontend_releases WHERE build_id=? AND ready=1',[pointer.stable])).results[0];
    const trustedSeal=await bucket.get(`releases/${pointer.stable}/sealed.json`);
    assert.equal(hash(await trustedSeal.arrayBuffer()),stableCatalog?.manifest_digest,'stable seal was modified');
    stableManifest=priorManifest;const probe=await bucket.get(`releases/${pointer.stable}/storage-probe.js`);assert.ok(probe);stableProbe=new Uint8Array(await probe.arrayBuffer());
    assert.equal(hash(stableProbe),priorManifest.probeDigest);
    assert.equal(hash(priorBytes),priorManifest.storageDigest,'stable storage contract was modified');
    assertStorageCompatibility(JSON.parse(new TextDecoder().decode(priorBytes)),contract);
  }
  if(action==='upload'||action==='initialize'&&!pointer) {
    const {verifyArtifactStorage}=await import('./verify-release-storage.mjs');
    const candidateProbe=await readFile('dist/release-storage-probe.js');
    const report=await verifyArtifactStorage({stable:{id:pointer?.stable??sha,bytes:stableProbe??candidateProbe,digest:stableManifest?.probeDigest??manifest.probeDigest},candidate:{id:sha,bytes:candidateProbe,digest:manifest.probeDigest}});
    const digest=await uploadFrontend({bucket,cwd:process.cwd(),manifest,contract});
    await query('INSERT INTO frontend_releases(build_id,manifest_digest,contract,published_at,ready) VALUES(?,?,?,?,0) ON CONFLICT(build_id) DO NOTHING',[sha,digest,contract.contract,Date.now()]);
    const row=(await query('SELECT manifest_digest FROM frontend_releases WHERE build_id=?',[sha])).results[0];assert.equal(row.manifest_digest,digest);
    const reportBytes=JSON.stringify(report);
    await immutablePut(bucket,`compatibility/${sha}/${report.stable}.json`,reportBytes);
    await query('INSERT INTO release_compatibility(candidate,stable,candidate_probe,stable_probe,report_digest) VALUES(?,?,?,?,?) ON CONFLICT(candidate,stable) DO NOTHING',[sha,report.stable,report.candidateProbe,report.stableProbe,hash(reportBytes)]);
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
  const proof=(await query('SELECT * FROM release_compatibility WHERE candidate=? AND stable=?',[sha,pointer?.stable??sha])).results[0];assert.ok(proof,'artifact compatibility proof missing for current stable');
  const proofObject=await bucket.get(`compatibility/${sha}/${pointer?.stable??sha}.json`);assert.ok(proofObject);
  const proofBytes=await proofObject.arrayBuffer();assert.equal(hash(proofBytes),proof.report_digest);
  const proofReport=JSON.parse(new TextDecoder().decode(proofBytes));
  verifyCompatibilityReport(proofReport,{stable:pointer?.stable??sha,candidate:sha,stableProbe:stableManifest?.probeDigest??manifest.probeDigest,candidateProbe:manifest.probeDigest});
  assert.equal(proof.candidate_probe,manifest.probeDigest);assert.equal(proof.stable_probe,proofReport.stableProbe);
  if(action==='initialize') {
    if(!pointer) await query('UPDATE frontend_releases SET ready=1 WHERE build_id=?',[sha]);
    await initializeReleaseChannels({query,sha,pointer});
  } else {
    await query('UPDATE frontend_releases SET ready=1 WHERE build_id=?',[sha]);
    if (pointer.beta !== sha) {
      const result=await query('UPDATE release_channels SET beta=?,revision=revision+1 WHERE id=1 AND revision=? AND stable=?',[sha,pointer.revision,pointer.stable]);
      assert.ok(result.meta.changes,'Channel changed during admission; reverify against current stable');
    }
  }
  console.log(`Admitted frontend ${sha}; stable changes only during explicit initialization or backend promotion`);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
