import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { assetValid, parsePlaybackManifest, playbackCacheName, type PlaybackManifest } from '../../shared/playback-assets';
import { offlinePlayerAssetsReady, prepareOfflinePlayerAssets } from './offline-player-assets';
const build = 'development';
let stores: Map<string, Map<string, Response>>;
let manifest: PlaybackManifest;
let failWrite = false;
const bodies = new Map<string, Uint8Array<ArrayBuffer>>();
const cacheKey = (key: RequestInfo | URL) => typeof key === 'string' ? key : key instanceof URL ? key.href : key.url;
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
