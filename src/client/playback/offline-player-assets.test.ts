import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { assetValid, parsePlaybackManifest, playbackCacheName, playbackManifestUrl, type PlaybackManifest } from '../../shared/playback-assets';
import { offlinePlayerAssetsReady, prepareOfflinePlayerAssets } from './offline-player-assets';
const build = 'development';
let stores: Map<string, Map<string, Response>>;
let manifest: PlaybackManifest;
let failWrite = false;
const bodies = new Map<string, Uint8Array<ArrayBuffer>>();
const cacheKey = (key: RequestInfo | URL) => {
 const value=typeof key === 'string' ? key : key instanceof URL ? key.href : key.url;
 const url=new URL(value,'https://test.invalid');return url.pathname+url.search;
};
beforeEach(async () => {
 stores = new Map(); bodies.clear(); failWrite = false;
 manifest = { buildId:build,entries:[] };
 for (const url of ['/assets/musicxml-player-one.js','/assets/prepare.worker-one.js','/playback/development/font/Bravura.woff2','/playback/development/soundfont/sonivox.sf2']) {
  const bytes=new TextEncoder().encode(url); bodies.set(url,bytes);
  const hash=btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))));
  manifest.entries.push({url,bytes:bytes.length,integrity:`sha256-${hash}`});
 }
 vi.stubGlobal('caches', { keys:async()=>[...stores.keys()],open:async(name:string)=>{
  if(!stores.has(name)) stores.set(name,new Map()); const rows=stores.get(name)!;
  return { match:async(key:RequestInfo)=>rows.get(cacheKey(key))?.clone(),put:async(key:RequestInfo,value:Response)=>{if (failWrite && cacheKey(key).endsWith('/sonivox.sf2')) throw new DOMException('quota', 'QuotaExceededError'); rows.set(cacheKey(key),value.clone());},keys:async()=>[...rows.keys()].map(url=>new Request(`https://test.invalid${url}`)) };
 }});
 vi.stubGlobal('MessageChannel',class { port1={onmessage:null as null|((event:{data:unknown})=>void),close:()=>{}};port2={reply:(data:unknown)=>this.port1.onmessage?.({data})}; });
 vi.stubGlobal('navigator',{serviceWorker:{getRegistration:async()=>({active:{postMessage:(_message:unknown,ports:{reply(data:unknown):void}[])=>queueMicrotask(()=>ports[0].reply({buildId:build}))}})}});
 vi.stubGlobal('fetch',vi.fn(async(input:string)=>input.endsWith('/manifest.json')?Response.json(manifest):new Response(bodies.get(input),{headers:{'Content-Type':input.endsWith('.js')?'application/javascript':'application/octet-stream',Vary:'Origin, Accept-Encoding'}})));
});
afterEach(()=>vi.unstubAllGlobals());
it('deduplicates repeated preparation, verifies every asset and detects system eviction or corruption',async()=>{
 const first=prepareOfflinePlayerAssets(); expect(prepareOfflinePlayerAssets()).toBe(first);await first;
 expect(await offlinePlayerAssetsReady()).toBe(true);
 expect(stores.get(playbackCacheName(build))!.get(manifest.entries[0].url)!.headers.get('Vary')).toBeNull();
 const cache=stores.get(playbackCacheName(build))!;
 cache.set(manifest.entries[0].url,new Response('bad'));
 expect(await offlinePlayerAssetsReady()).toBe(false);
 await prepareOfflinePlayerAssets();expect(await offlinePlayerAssetsReady()).toBe(true);
 cache.delete(playbackManifestUrl(build));expect(await offlinePlayerAssetsReady()).toBe(false);
 await prepareOfflinePlayerAssets();expect(await offlinePlayerAssetsReady()).toBe(true);
 cache.set(playbackManifestUrl(build),Response.json({...manifest,buildId:'wrong'}));expect(await offlinePlayerAssetsReady()).toBe(false);
 await prepareOfflinePlayerAssets();expect(await offlinePlayerAssetsReady()).toBe(true);
 cache.delete(manifest.entries[1].url);expect(await offlinePlayerAssetsReady()).toBe(false);
});
it('interrupted preparation and quota errors leave the old build intact; explicit retry repairs only missing resources',async()=>{
 const old=new Map([['old',new Response('retained')]]);stores.set(playbackCacheName('old'),old);
 vi.mocked(fetch).mockImplementationOnce(async()=>Response.json(manifest)).mockRejectedValueOnce(new TypeError('interrupted'));
 await expect(prepareOfflinePlayerAssets()).rejects.toThrow('interrupted');
 expect(await offlinePlayerAssetsReady()).toBe(false);expect(stores.get(playbackCacheName('old'))).toBe(old);
 failWrite = true;
 await expect(prepareOfflinePlayerAssets()).rejects.toThrow('quota');
 expect(await offlinePlayerAssetsReady()).toBe(false);
 failWrite = false;
 await prepareOfflinePlayerAssets();expect(await offlinePlayerAssetsReady()).toBe(true);
 expect(stores.get(playbackCacheName('old'))).toBe(old);
});
it('rejects a wrong build, incomplete manifest, HTML response and checksum mismatch',async()=>{
 expect(()=>parsePlaybackManifest({...manifest,buildId:'other'},build)).toThrow();
 expect(()=>parsePlaybackManifest({...manifest,entries:manifest.entries.slice(0,1)},build)).toThrow();
 expect(await assetValid(new Response(bodies.get(manifest.entries[0].url),{headers:{'Content-Type':'text/html'}}),manifest.entries[0])).toBe(false);
 expect(await assetValid(new Response('wrong'),manifest.entries[0])).toBe(false);
});

async function storePreviousBundle(typeFor: (entry: PlaybackManifest['entries'][number]) => string = entry => entry.url.endsWith('.js') ? 'application/javascript' : 'application/octet-stream') {
 const oldBuild='previous',rows=new Map<string,Response>();
 const entries=manifest.entries.map(entry=>({...entry,url:entry.url.replace('/development/','/previous/').replace('-one.js','-previous.js')}));
 const previous={buildId:oldBuild,entries};
 rows.set(`/playback/${oldBuild}/manifest.json`,Response.json(previous));
 entries.forEach((entry,index)=>rows.set(entry.url,new Response(bodies.get(manifest.entries[index].url),{headers:{'Content-Type':typeFor(entry)}})));
 stores.set(playbackCacheName(oldBuild),rows);
 return {rows,previous};
}
it('reuses verified public bytes across build URLs without depending on the old bundle after copying',async()=>{
 const {rows,previous}=await storePreviousBundle();
 await prepareOfflinePlayerAssets();
 expect(vi.mocked(fetch).mock.calls.map(call=>call[0])).toEqual([playbackManifestUrl(build)]);
 expect(await offlinePlayerAssetsReady()).toBe(true);
 expect(rows.has(previous.entries[0].url)).toBe(true);
 stores.delete(playbackCacheName('previous'));
 expect(await offlinePlayerAssetsReady()).toBe(true);
});
it('rejects corrupt old bytes and inappropriate MIME, downloading only the missing targets',async()=>{
 const {rows,previous}=await storePreviousBundle(entry=>entry.url.endsWith('.js')?'text/plain':'application/octet-stream');
 rows.set(previous.entries[3].url,new Response('corrupt',{headers:{'Content-Type':'application/octet-stream'}}));
 await prepareOfflinePlayerAssets();
 const downloaded=vi.mocked(fetch).mock.calls.map(call=>call[0]).filter(url=>url!==playbackManifestUrl(build));
 expect(downloaded).toEqual([manifest.entries[0].url,manifest.entries[1].url,manifest.entries[3].url]);
 expect(await offlinePlayerAssetsReady()).toBe(true);
});
it('checks existing responses once per preparation task while later readiness still detects corruption',async()=>{
 await prepareOfflinePlayerAssets();
 const digest=vi.spyOn(crypto.subtle,'digest');
 try {
  await prepareOfflinePlayerAssets();
  expect(digest).toHaveBeenCalledTimes(manifest.entries.length);
  const cache=stores.get(playbackCacheName(build))!;
  cache.set(manifest.entries[0].url,new Response('corrupt',{headers:{'Content-Type':'application/javascript'}}));
  expect(await offlinePlayerAssetsReady()).toBe(false);
 } finally {digest.mockRestore();}
});
it('canceling one consumer leaves shared preparation available to another',async()=>{
 const original=vi.mocked(fetch).getMockImplementation()!;
 let release!:(value:Response)=>void;
 vi.mocked(fetch).mockImplementation(async (input,init)=>{
  if(input===manifest.entries[0].url) return new Promise<Response>((resolve,reject)=>{release=resolve;init?.signal?.addEventListener('abort',()=>reject(init.signal?.reason),{once:true});});
  return original(input,init);
 });
 const firstAbort=new AbortController(),secondAbort=new AbortController();
 const first=prepareOfflinePlayerAssets(firstAbort.signal),second=prepareOfflinePlayerAssets(secondAbort.signal);
 await vi.waitFor(()=>expect(release).toBeTypeOf('function'));
 firstAbort.abort();await expect(first).rejects.toMatchObject({name:'AbortError'});
 release(new Response(bodies.get(manifest.entries[0].url),{headers:{'Content-Type':'application/javascript'}}));
 await second;expect(await offlinePlayerAssetsReady()).toBe(true);
});
it('canceling the last consumer aborts the underlying fetch and permits a fresh retry',async()=>{
 const original=vi.mocked(fetch).getMockImplementation()!;
 let pendingSignal:AbortSignal|undefined;
 vi.mocked(fetch).mockImplementation(async (input,init)=>{
  if(input===manifest.entries[0].url) return new Promise<Response>((_resolve,reject)=>{pendingSignal=init?.signal??undefined;pendingSignal?.addEventListener('abort',()=>reject(pendingSignal?.reason),{once:true});});
  return original(input,init);
 });
 const abort=new AbortController(),preparation=prepareOfflinePlayerAssets(abort.signal);
 await vi.waitFor(()=>expect(pendingSignal).toBeDefined());
 abort.abort();await expect(preparation).rejects.toMatchObject({name:'AbortError'});
 expect(pendingSignal?.aborted).toBe(true);
 vi.mocked(fetch).mockImplementation(original);
 await prepareOfflinePlayerAssets();expect(await offlinePlayerAssetsReady()).toBe(true);
});
it('treats an unreadable old response body as a miss and downloads the current target',async()=>{
 const {rows,previous}=await storePreviousBundle();
 const broken=new ReadableStream<Uint8Array>({start(controller){controller.error(new TypeError('old_cache_body_unreadable'));}});
 rows.set(previous.entries[0].url,new Response(broken,{headers:{'Content-Type':'application/javascript'}}));
 await prepareOfflinePlayerAssets();
 expect(vi.mocked(fetch).mock.calls.map(call=>call[0]).filter(url=>url!==playbackManifestUrl(build))).toEqual([manifest.entries[0].url]);
 expect(await offlinePlayerAssetsReady()).toBe(true);
});
it('repairs an unreadable current response instead of repeatedly failing explicit preparation',async()=>{
 await prepareOfflinePlayerAssets();
 const broken=new ReadableStream<Uint8Array>({start(controller){controller.error(new TypeError('current_cache_body_unreadable'));}});
 stores.get(playbackCacheName(build))!.set(manifest.entries[0].url,new Response(broken,{headers:{'Content-Type':'application/javascript'}}));
 vi.mocked(fetch).mockClear();
 await prepareOfflinePlayerAssets();
 expect(vi.mocked(fetch).mock.calls.map(call=>call[0]).filter(url=>url!==playbackManifestUrl(build))).toEqual([manifest.entries[0].url]);
 expect(await offlinePlayerAssetsReady()).toBe(true);
});
it('checks a reused response MIME against the destination resource type',async()=>{
 await storePreviousBundle(entry=>entry.url.endsWith('.js')?'application/javascript':entry.url.endsWith('.sf2')?'font/woff2':'application/octet-stream');
 await prepareOfflinePlayerAssets();
 expect(vi.mocked(fetch).mock.calls.map(call=>call[0]).filter(url=>url!==playbackManifestUrl(build))).toEqual([manifest.entries[3].url]);
 expect(await offlinePlayerAssetsReady()).toBe(true);
});
