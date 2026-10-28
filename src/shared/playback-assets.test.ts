import { expect, it } from 'vitest';
import { assetValid, cachedPlaybackManifest, parsePlaybackManifest, playbackAssetTypeValid } from './playback-assets';

it('accepts untyped sealed binary resources while requiring executable MIME and rejecting HTML', async () => {
  const bytes = new Uint8Array([1, 2, 3]);
  const integrity = `sha256-${btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))))}`;
  for (const extension of ['sf2', 'woff2', 'woff', 'otf']) {
    const url = `/playback/abc1234/resource.${extension}`, entry = {url, bytes:bytes.length, integrity};
    const binary = new Response(bytes);
    expect(playbackAssetTypeValid(binary, url)).toBe(true);
    expect(await assetValid(binary, entry)).toBe(true);
    expect(await assetValid(new Response(new Uint8Array([3, 2, 1])), entry)).toBe(false);
    expect(playbackAssetTypeValid(new Response(bytes, {headers:{'Content-Type':'text/html'}}), url)).toBe(false);
  }
  for (const url of ['/assets/engine.js', '/assets/worklet.mjs', '/assets/player.css']) {
    expect(playbackAssetTypeValid(new Response(bytes), url)).toBe(false);
  }
});

it('validates legacy/root and release-prefixed manifests while rejecting cross-build paths', async () => {
  const build='abc1234';
  const entries=await Promise.all(['assets/musicxml-player-test.js','assets/prepare.worker-test.js',`playback/${build}/soundfont/sonivox.sf2`].map(async path=>{
    const bytes=new TextEncoder().encode(path);
    const hash=btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))));
    return {url:'/'+path,bytes:bytes.length,integrity:`sha256-${hash}`};
  }));
  const manifest={buildId:build,entries};
  expect(parsePlaybackManifest(manifest,build)).toBe(manifest);
  const prefixed={...manifest,entries:entries.map(entry=>({...entry,url:`/_releases/${build}${entry.url}`}))};
  expect(parsePlaybackManifest(prefixed,build)).toBe(prefixed);
  expect(()=>parsePlaybackManifest(prefixed,'def5678')).toThrow('invalid_playback_manifest');
  expect(()=>parsePlaybackManifest({...manifest,entries:entries.slice(0,1)},build)).toThrow('incomplete_playback_manifest');
  for (const prefix of ['',`_releases/${build}/`]) {
    const url=`https://test.invalid/${prefix}playback/${build}/manifest.json`;
    expect(await cachedPlaybackManifest({keys:async()=>[new Request(url)],match:async()=>Response.json(prefix?prefixed:manifest)},build)).toEqual(prefix?prefixed:manifest);
  }
  const entry=entries[0];
  expect(await assetValid(new Response(entry.url.slice(1),{headers:{'Content-Type':'application/javascript'}}),entry)).toBe(true);
  expect(await assetValid(new Response('corrupt',{headers:{'Content-Type':'application/javascript'}}),entry)).toBe(false);
  expect(await assetValid(new Response(entry.url.slice(1),{headers:{'Content-Type':'text/html'}}),entry)).toBe(false);
});
