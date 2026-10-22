import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import { ReleasePermission } from '../../../service-worker/release-permission';
import { type ReleaseTarget, releaseContract } from '../../shared/release-channels';
import { readReleaseReceipt,writeReleaseReceipt } from '../../shared/release-receipt';
import { refreshReleaseChannel } from './release-channel';
const origin='https://same-page.test',A='a'.repeat(40),B='b'.repeat(40);
const stable: ReleaseTarget={channel:'stable',target:A,intent:'default',revision:1,backend:A,contract:releaseContract};
const beta: ReleaseTarget={...stable,channel:'beta',target:B,intent:'explicit-beta'};
beforeEach(()=>{
 const records=new Map();vi.stubGlobal('caches',{open:async()=>({match:async (k: string)=>records.get(k)?.clone(),put:async(k: string,r: Response)=>{records.set(k,r.clone());}})});
 vi.stubGlobal('navigator',{onLine:true,locks:{request:async(_key: string,fn: ()=>Promise<unknown>)=>fn()}});vi.stubGlobal('location',{origin});
});
afterEach(()=>vi.unstubAllGlobals());
it('rechecks the Cookie authority on new navigation and cannot restore beta after expiry',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json(beta)));
 const permission=new ReleasePermission(origin,B,true);await permission.activate();expect(await permission.permits(B)).toBe(true);
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json(stable)));
 expect(await permission.permits(B)).toBe(false);expect(await permission.permits(A)).toBe(true);
 await permission.displayed(A);vi.stubGlobal('fetch',vi.fn(async()=>{throw Error('offline')}));
 expect(await permission.permits(A)).toBe(true);expect(await permission.permits(B)).toBe(false);
});
it('recovers pending before POST, lost POST response and lost confirmation from server readback without restoring a Cookie',async()=>{
 for(const server of [stable,beta]){
  await writeReleaseReceipt(origin,{pending:{channel:'beta',intent:crypto.randomUUID()},permitted:stable});
  const fetcher=vi.fn(async (...args: [string?, RequestInit?])=>{ void args; return Response.json(server); });vi.stubGlobal('fetch',fetcher);
  await refreshReleaseChannel();const receipt=await readReleaseReceipt(origin);
  expect(receipt.pending).toBeUndefined();expect(receipt.confirmed).toEqual(server);expect(receipt.permitted).toEqual(stable);
  expect(fetcher.mock.calls.every(c=>c[1]?.method!=='POST')).toBe(true);
 }
});
