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
