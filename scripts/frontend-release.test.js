import { expect,it } from 'vitest';
import { immutablePut } from './frontend-release.mjs';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
