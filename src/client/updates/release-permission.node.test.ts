import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import { ReleasePermission } from '../../../service-worker/release-permission';
import { type ReleaseTarget, releaseContract } from '../../shared/release-channels';
import { readReleaseReceipt,writeReleaseReceipt } from '../../shared/release-receipt';
import { refreshReleaseChannel, useReleaseChannel } from './release-channel';
vi.mock('../../shared/build',()=>({buildId:'b'.repeat(40)}));
vi.mock('react',()=>({useSyncExternalStore:(_subscribe: unknown,snapshot:()=>unknown)=>snapshot()}));
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

it('keeps an already permitted release usable when receipt refresh exceeds quota',async()=>{
 await writeReleaseReceipt(origin,{confirmed:beta,permitted:beta});
 const cache=await caches.open('receipt');
 const put=vi.fn(async()=>{throw new DOMException('Storage full','QuotaExceededError');});
 vi.stubGlobal('caches',{open:async()=>({...cache,put})});
 const fetcher=vi.fn(async()=>Response.json(beta));vi.stubGlobal('fetch',fetcher);
 const permission=new ReleasePermission(origin,B,true);
 await expect(permission.displayed(B)).resolves.toBeUndefined();
 expect(put).not.toHaveBeenCalled();
 fetcher.mockImplementation(async()=>Response.json({...beta,revision:2}));
 await expect(permission.displayed(B)).resolves.toBeUndefined();
 expect(put).toHaveBeenCalledOnce();
 expect((await readReleaseReceipt(origin)).permitted).toEqual(beta);
});

it('still requires a durable receipt for a first release or a different channel',async()=>{
 const cache=await caches.open('receipt');
 vi.stubGlobal('caches',{open:async()=>({...cache,put:async()=>{throw new DOMException('Storage full','QuotaExceededError');}})});
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json(beta)));
 const permission=new ReleasePermission(origin,B,true);
 await expect(permission.displayed(B)).rejects.toMatchObject({name:'QuotaExceededError'});
 vi.stubGlobal('caches',{open:async()=>cache});
 await writeReleaseReceipt(origin,{confirmed:beta,permitted:beta});
 vi.stubGlobal('caches',{open:async()=>({...cache,put:async()=>{throw new DOMException('Storage full','QuotaExceededError');}})});
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({...stable,target:B})));
 await expect(permission.displayed(B)).rejects.toMatchObject({name:'QuotaExceededError'});
});

it('updates the running channel when an already permitted build is identical in both channels',async()=>{
 await writeReleaseReceipt(origin,{confirmed:beta,permitted:beta});
 const confirmed={...stable,target:B,intent:'confirmed-stable'};
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json(confirmed)));
 await refreshReleaseChannel();
 expect((await readReleaseReceipt(origin)).permitted).toEqual(confirmed);
 expect(useReleaseChannel()).toMatchObject({target:confirmed,runningChannel:'stable',error:''});
});

it('does not grant a first display permission or relabel another running build during reconciliation',async()=>{
 for(const receipt of [{},{permitted:stable},{permitted:beta}]){
  await writeReleaseReceipt(origin,receipt);
  const target=receipt.permitted===beta?stable:{...stable,target:B};
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json(target)));
  await refreshReleaseChannel();
  expect((await readReleaseReceipt(origin)).permitted).toEqual(receipt.permitted);
 }
});

it('exposes an offline refresh error and clears it after a successful readback',async()=>{
 vi.stubGlobal('navigator',{onLine:false});
 vi.stubGlobal('fetch',vi.fn(async()=>{throw new TypeError('Failed to fetch');}));
 await expect(refreshReleaseChannel()).rejects.toThrow('Failed to fetch');
 expect(useReleaseChannel().error).toBe('当前离线，请联网后重试。');
 vi.stubGlobal('navigator',{onLine:true});
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json(stable)));
 await refreshReleaseChannel();
 expect(useReleaseChannel().error).toBe('');
});

it('starts readback before receipt storage can defer it past document navigation',async()=>{
 const cache=await caches.open('receipt');
 let finishRead!: (cache: Cache)=>void;
 const reading=new Promise<Cache>(resolve=>{finishRead=resolve;});
 vi.stubGlobal('caches',{open:()=>reading});
 const fetcher=vi.fn(async()=>Response.json(stable));vi.stubGlobal('fetch',fetcher);
 const refresh=refreshReleaseChannel();
 const startedBeforeStorageSettled=fetcher.mock.calls.length;
 finishRead(cache);await refresh;
 expect(startedBeforeStorageSettled).toBe(1);
});

it('retains offline running-channel attribution when readback fails before storage settles',async()=>{
 await writeReleaseReceipt(origin,{confirmed:beta,permitted:beta});
 const cache=await caches.open('receipt');
 let finishRead!: (cache: Cache)=>void;
 const reading=new Promise<Cache>(resolve=>{finishRead=resolve;});
 vi.stubGlobal('caches',{open:()=>reading});
 vi.stubGlobal('navigator',{onLine:false,locks:{request:async(_key: string,fn: ()=>Promise<unknown>)=>fn()}});
 vi.stubGlobal('fetch',vi.fn(async()=>{throw new TypeError('Failed to fetch');}));
 const refresh=refreshReleaseChannel();
 // Let the rejected readback settle while the independently valid receipt waits.
 await new Promise(resolve=>setTimeout(resolve,0));
 finishRead(cache);
 await expect(refresh).rejects.toThrow('Failed to fetch');
 expect(useReleaseChannel()).toMatchObject({runningChannel:'beta',error:'当前离线，请联网后重试。'});
 expect(await readReleaseReceipt(origin)).toEqual({confirmed:beta,permitted:beta});
});
