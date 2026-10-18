import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { playbackAssets } from './playback-assets.ts';
import { shellManifest } from './shell-manifest.ts';
const directories=[];
afterEach(async()=>{await Promise.all(directories.splice(0).map(dir=>rm(dir,{recursive:true,force:true})));});
it('pins public roots without changing the vendored package and fails when its resource contract changes',()=>{
 const plugin=playbackAssets('release-one');
 const original="const settings={font:'/font/',sf:'/soundfont/sonivox.sf2'}";
 const code=plugin.transform(original,'/node_modules/@clydian/chorus-player/dist/session.js');
 expect(code).toContain('/playback/release-one/font/');expect(code).toContain('/playback/release-one/soundfont/sonivox.sf2');
 expect(plugin.transform(original,'/another/session.js')).toBeUndefined();
 expect(()=>plugin.transform('changed','/node_modules/@clydian/chorus-player/dist/session.js')).toThrow('player_resource_contract_changed');
});
it('includes the static player closure and worker/font/soundfont bytes, leaving shared dependencies to the verified shell',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'same-page-playback-bundle-'));directories.push(root);
 for(const dir of ['assets','font','soundfont']) await mkdir(path.join(root,dir));
 const bundle={
  'assets/musicxml-player-one.js':{type:'chunk',imports:['assets/common-one.js'],dynamicImports:[]},
  'assets/common-one.js':{type:'chunk',imports:[],dynamicImports:['assets/admin-one.js']},
  'assets/admin-one.js':{type:'chunk',imports:[],dynamicImports:[]},
  'assets/prepare.worker-one.js':{type:'asset'},
  'assets/alphaTab.worklet-one.js':{type:'asset'},
 };
 for(const file of ['index.html',...Object.keys(bundle),'font/Bravura.woff2','soundfont/sonivox.sf2']) await writeFile(path.join(root,file),file);
 await playbackAssets('release-one').writeBundle({dir:root},bundle);
 const filename=path.join(root,'playback/release-one/manifest.json');
 let player=JSON.parse(await readFile(filename,'utf8'));
 expect(player.entries.some(entry=>entry.url.includes('admin'))).toBe(false);
 expect(player.entries.some(entry=>entry.url.includes('common'))).toBe(true);
 expect(player.entries.some(entry=>entry.url.endsWith('sonivox.sf2'))).toBe(true);
 const shell=await shellManifest([{url:'index.html'},{url:'assets/common-one.js'}],root,'release-one');
 player=JSON.parse(await readFile(filename,'utf8'));
 expect(player.entries.some(entry=>entry.url.includes('common'))).toBe(false);
 expect(shell.manifest.some(entry=>entry.url.endsWith('/manifest.json')&&entry.integrity.startsWith('sha256-'))).toBe(true);
 expect(shell.manifest.some(entry=>/font|musicxml|alphaTab/.test(entry.url))).toBe(false);
});
