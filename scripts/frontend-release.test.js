import { expect,it } from 'vitest';
import { immutablePut } from './frontend-release.mjs';
it('never overwrites a claim or seal even when a concurrent publisher has different bytes',async()=>{
 const values=new Map();
 const bucket={put:async(k,b)=>{if(values.has(k))return null;values.set(k,new TextEncoder().encode(b));return{}},get:async k=>values.has(k)?{arrayBuffer:async()=>values.get(k)}:null};
 for(const key of ['releases/A/claim.json','releases/A/sealed.json']){
  await immutablePut(bucket,key,'A');await immutablePut(bucket,key,'A');
  await expect(immutablePut(bucket,key,'different')).rejects.toThrow('collision');
 }
});

it('fingerprints reverse storage consumers and all of their relative dependencies',async()=>{
 const {storageContract}=await import('./release-contract.mjs');
 const contract=await storageContract();
 for(const file of ['src/client/platform/musicxml-files.ts','src/client/offline/local-files.ts','src/client/score-library/membership-directory.ts','src/client/score-library/attachments/attachment-directory.ts']) expect(contract.files[file],file).toMatch(/^[a-f0-9]{64}$/);
});

it('requires a two-engine matrix tied to these exact two sealed artifact probes',async()=>{
 const {verifyCompatibilityReport}=await import('./frontend-release.mjs');
 const expected={stable:'a'.repeat(40),candidate:'b'.repeat(40),stableProbe:'c'.repeat(64),candidateProbe:'d'.repeat(64)};
 const good={version:1,passed:true,engines:['chromium','webkit'],...expected};
 expect(()=>verifyCompatibilityReport(good,expected)).not.toThrow();
 for(const patch of [{passed:false},{stable:'other'},{candidateProbe:'other'},{engines:['chromium']}]) expect(()=>verifyCompatibilityReport({...good,...patch},expected)).toThrow();
});
