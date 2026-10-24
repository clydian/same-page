import { expect,it } from 'vitest';
import { assertInitialChannels, assertPrivateReleaseBucket, immutablePut, initializeReleaseChannels, preflightReleaseBucket } from './frontend-release.mjs';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { assertStorageCompatibility, storageContract, storageContractFiles } from './release-contract.mjs';
it('never overwrites a claim or seal even when a concurrent publisher has different bytes',async()=>{
 const values=new Map();
 const bucket={put:async(k,b)=>{if(values.has(k))return null;values.set(k,new TextEncoder().encode(b));return{}},get:async k=>values.has(k)?{arrayBuffer:async()=>values.get(k)}:null};
 for(const key of ['releases/A/claim.json','releases/A/sealed.json']){
  await immutablePut(bucket,key,'A');await immutablePut(bucket,key,'A');
  await expect(immutablePut(bucket,key,'different')).rejects.toThrow('collision');
 }
});

it('lets UI and compatible server changes ship against an earlier wide baseline',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'same-page-storage-contract-'));
 try {
  for(const file of [...storageContractFiles,'package-lock.json']) {
   const destination=path.join(directory,file);await mkdir(path.dirname(destination),{recursive:true});await cp(file,destination);
  }
  const before=await storageContract(directory);
  const oldWide={...before,files:{...before.files,'src/client/components/app-header.tsx':'a'.repeat(64),'migrations/0034_release_channels.sql':'b'.repeat(64)}};
  await mkdir(path.join(directory,'src/client/components'),{recursive:true});
  await mkdir(path.join(directory,'migrations'),{recursive:true});
  await writeFile(path.join(directory,'src/client/components/app-header.tsx'),'// A UI-only change.');
  await writeFile(path.join(directory,'migrations/0035_additive_index.sql'),'CREATE INDEX compatible_index ON score(file_name);');
  const candidate=await storageContract(directory);
  expect(candidate).toEqual(before);
  expect(()=>assertStorageCompatibility(oldWide,candidate)).not.toThrow();
  const database=path.join(directory,'src/client/platform/local-database.ts');
  await writeFile(database,(await readFile(database,'utf8')).replace('this.version(1)', 'this.version(99)'));
  const incompatible=await storageContract(directory);
  expect(()=>assertStorageCompatibility(oldWide,incompatible)).toThrow('storage compatibility changed');
 } finally { await rm(directory,{recursive:true,force:true}); }
});

it('rejects changed or missing persistence/protocol boundaries and dependency versions',async()=>{
 const stable=await storageContract();
 for(const file of storageContractFiles) {
  expect(()=>assertStorageCompatibility(stable,{...stable,files:{...stable.files,[file]:'0'.repeat(64)}})).toThrow('storage compatibility changed');
  const files={...stable.files};delete files[file];
  expect(()=>assertStorageCompatibility({...stable,files},stable)).toThrow('storage compatibility changed');
  expect(()=>assertStorageCompatibility(stable,{...stable,files})).toThrow('missing storage boundary');
 }
 for(const field of ['contract','dexie','zod']) {
  expect(()=>assertStorageCompatibility(stable,{...stable,[field]:'changed'})).toThrow();
 }
});

it('requires a two-engine matrix tied to these exact two sealed artifact probes',async()=>{
 const {verifyCompatibilityReport}=await import('./frontend-release.mjs');
 const expected={stable:'a'.repeat(40),candidate:'b'.repeat(40),stableProbe:'c'.repeat(64),candidateProbe:'d'.repeat(64)};
 const good={version:1,passed:true,engines:['chromium','webkit'],...expected};
 expect(()=>verifyCompatibilityReport(good,expected)).not.toThrow();
 for(const patch of [{passed:false},{stable:'other'},{candidateProbe:'other'},{engines:['chromium']}]) expect(()=>verifyCompatibilityReport({...good,...patch},expected)).toThrow();
});

const baseline = 'a'.repeat(40), different = 'b'.repeat(40);
it('retries only the exact first initialization and never changes a later channel state', async () => {
 const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
 db.exec(readFileSync(new URL('../migrations/0034_release_channels.sql', import.meta.url), 'utf8'));
 const statements = [];
 const query = async (sql, params = []) => { statements.push(sql); return { results: db.prepare(sql).all(...params) }; };
 try {
  const expected = { stable: baseline, beta: baseline, revision: 1 };
  expect(await initializeReleaseChannels({ query, sha: baseline })).toEqual(expected);
  statements.length = 0;
  expect(await initializeReleaseChannels({ query, sha: baseline, pointer: expected })).toEqual(expected);
  expect(statements).toEqual(['SELECT stable,beta,revision FROM release_channels WHERE id=1']);
  for (const pointer of [
   { ...expected, stable: different }, { ...expected, beta: different },
   { ...expected, revision: 2 }, { ...expected, revision: '1' },
  ]) {
   statements.length = 0;
   await expect(initializeReleaseChannels({ query, sha: baseline, pointer })).rejects.toThrow('exact first initialization');
   expect(statements).toEqual([]);
  }
  db.prepare('UPDATE release_channels SET beta=?,revision=2').run(different);
  await expect(initializeReleaseChannels({ query, sha: baseline, pointer: expected })).rejects.toThrow('exact first initialization');
  expect(db.prepare('SELECT stable,beta,revision FROM release_channels').get()).toEqual({ stable: baseline, beta: different, revision: 2 });
  // A publisher which read an empty catalog must not overwrite a concurrent initialization.
  await expect(initializeReleaseChannels({ query, sha: different })).rejects.toThrow('exact first initialization');
  expect(db.prepare('SELECT stable,beta,revision FROM release_channels').get()).toEqual({ stable: baseline, beta: different, revision: 2 });
 } finally { db.close(); }
 expect(() => assertInitialChannels(null, baseline)).not.toThrow();
});

const privateBucket = () => ({
 managed: { enabled: false }, custom: { domains: [] },
 lifecycle: { rules: [{ enabled: true, abortMultipartUploadsTransition: { condition: { type: 'Age', maxAge: 604800 } } }] },
});
it('checks both independent public access paths and rejects stored object expiration', () => {
 expect(() => assertPrivateReleaseBucket(privateBucket())).not.toThrow();
 expect(() => assertPrivateReleaseBucket({ ...privateBucket(), lifecycle: {} })).not.toThrow();
 expect(() => assertPrivateReleaseBucket({ ...privateBucket(), custom: { domains: [{ enabled: false }] } })).not.toThrow();
 expect(() => assertPrivateReleaseBucket({ ...privateBucket(), lifecycle: { rules: [{ enabled: false, deleteObjectsTransition: {} }] } })).not.toThrow();
 for (const patch of [
  { managed: { enabled: true } }, { managed: {} },
  { custom: { domains: [{ enabled: true }] } }, { custom: {} },
  { lifecycle: { rules: [{ enabled: true, deleteObjectsTransition: { condition: { type: 'Age', maxAge: 86400 } } }] } },
  { lifecycle: { rules: [{ enabled: true, deleteObjectsTransition: { condition: { type: 'Date', date: '2030-01-01' } } }] } },
  { lifecycle: null }, { lifecycle: { rules: {} } },
 ]) expect(() => assertPrivateReleaseBucket({ ...privateBucket(), ...patch })).toThrow();
});

it('reads all release bucket settings and fails closed on API rejection', async () => {
 const settings = privateBucket(), paths = [], token = 'transient-test-token';
 const fetchImpl = async (url, options) => {
  expect(options.headers.Authorization).toBe(`Bearer ${token}`);
  paths.push(new URL(url).pathname);
  const result = url.endsWith('/managed') ? settings.managed : url.endsWith('/custom') ? settings.custom : settings.lifecycle;
  return Response.json({ success: true, result });
 };
 await preflightReleaseBucket({ account: '0'.repeat(32), token, fetchImpl });
 expect(paths.sort()).toEqual(['domains/custom', 'domains/managed', 'lifecycle'].map(setting => `/client/v4/accounts/${'0'.repeat(32)}/r2/buckets/same-page-frontend-releases/${setting}`).sort());
 for (const response of [new Response('private response body', { status: 403 }), Response.json({ success: false, errors: [{ message: 'private response body' }] })]) {
  await expect(preflightReleaseBucket({ account: '0'.repeat(32), token, fetchImpl: async () => response.clone() })).rejects.toThrow(/check failed|check rejected/);
 }
});

it('runs preflight from the original artifact directory without dependencies or production writes', async () => {
 const directory = await mkdtemp(path.join(tmpdir(), 'same-page-release-preflight-'));
 try {
  await cp(new URL('../wrangler.jsonc', import.meta.url), path.join(directory, 'wrangler.jsonc'));
  const preload = path.join(directory, 'api-fixture.mjs');
  await writeFile(preload, `import assert from 'node:assert/strict';
globalThis.fetch = async (url, options) => {
 assert.equal(options.headers.Authorization, 'Bearer transient-preflight-fixture');
 if (url.endsWith('/query')) {
  assert.equal(options.method, 'POST');
  assert.equal(JSON.parse(options.body).sql, 'SELECT stable,beta,revision FROM release_channels WHERE id=1');
  return Response.json({success:true,result:[{results:JSON.parse(process.env.PREFLIGHT_POINTER ?? '[]')}]});
 }
 assert.equal(options.method, undefined);
 const result = url.endsWith('/domains/managed') ? {enabled:false} : url.endsWith('/domains/custom') ? {domains:[]} : url.endsWith('/lifecycle') ? {rules:[]} : null;
 assert.ok(result, 'unexpected production request');
 return Response.json({success:true,result});
};`);
  const run = (action, pointer) => promisify(execFile)(process.execPath, ['--import', preload, fileURLToPath(new URL('./frontend-release.mjs', import.meta.url)), action, baseline, '--initialize-stable'], {
   cwd: directory, env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: '0'.repeat(32), CLOUDFLARE_API_TOKEN: 'transient-preflight-fixture', PREFLIGHT_POINTER: JSON.stringify(pointer ? [pointer] : []) },
  });
  for (const pointer of [undefined, { stable: baseline, beta: baseline, revision: 1 }]) {
   const { stdout, stderr } = await run('preflight', pointer);
   expect(stdout).toContain(`Release preflight passed for ${baseline}`);
   expect(stdout + stderr).not.toContain('transient-preflight-fixture');
  }
  for (const action of ['preflight', 'initialize']) {
   // initialize must reject before loading SDKs or attempting any artifact/catalog writes.
   await expect(run(action, { stable: baseline, beta: different, revision: 2 })).rejects.toThrow('exact first initialization');
  }
 } finally { await rm(directory, { recursive: true, force: true }); }
});

it('rechecks backend identity and every sealed resource after a transient download failure', async () => {
 const {verifyOnlineFrontend} = await import('./frontend-release.mjs');
 const {createHash} = await import('node:crypto');
 const sha = 'a'.repeat(40), calls = [];
 const bytes = 'sealed candidate bytes';
 const files = {'assets/example.js': {sha256:createHash('sha256').update(bytes).digest('hex')}};
 await verifyOnlineFrontend({origin:'https://example.test',sha,files,fetchImpl:async url => {
  calls.push(url.pathname);
  if (url.pathname === '/api/health') return Response.json({buildId:sha});
  if (calls.length === 2) throw new DOMException('private response', 'TimeoutError');
  return new Response(bytes);
 }});
 expect(calls).toEqual(['/api/health',`/_releases/${sha}/assets/example.js`,`/_releases/${sha}/assets/example.js`]);
 let downloads = 0;
 await expect(verifyOnlineFrontend({origin:'https://example.test',sha,files,fetchImpl:async url => {
  if (url.pathname === '/api/health') return Response.json({buildId:sha});
  downloads++; return new Response('wrong bytes');
 }})).rejects.toThrow('candidate resource hash mismatch: assets/example.js');
 expect(downloads).toBe(1);
 await expect(verifyOnlineFrontend({origin:'https://example.test',sha,files,fetchImpl:async () => Response.json({buildId:'other'})})).rejects.toThrow('backend deployment must verify');
});
