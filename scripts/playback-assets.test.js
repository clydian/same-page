import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CoreSettings } from '@coderline/alphatab';
import { playbackAssets } from './playback-assets.ts';
import { shellManifest } from './shell-manifest.ts';
const directories=[];
afterEach(async()=>{await Promise.all(directories.splice(0).map(dir=>rm(dir,{recursive:true,force:true})));});
it.each(['/', '/_releases/release-one/'])('pins public roots under %s for the local workspace and fails when its resource contract changes',assetBase=>{
 const plugin=playbackAssets('release-one',assetBase);
 const original="const settings={font:'/font/',sf:'/soundfont/sonivox.sf2'}";
 const code=plugin.transform(original,'/node_modules/@same-page/player/dist/session.js');
 expect(plugin.transform(original,'/repo/packages/player/dist/session.js')).toBe(code);
 expect(code).toContain(`${assetBase}playback/release-one/font/`);expect(code).toContain(`${assetBase}playback/release-one/soundfont/sonivox.sf2`);
 expect(plugin.transform(original,'/another/session.js')).toBeUndefined();
 expect(()=>plugin.transform('changed','/node_modules/@same-page/player/dist/session.js')).toThrow('player_resource_contract_changed');
});
it.each(['/', '/_releases/release-one/'])('includes the static player closure under %s and worker/font/soundfont bytes, leaving shared dependencies to the verified shell',async assetBase=>{
 const root=await mkdtemp(path.join(tmpdir(),'same-page-playback-bundle-'));directories.push(root);
 for(const dir of ['assets','font','soundfont']) await mkdir(path.join(root,dir));
 const bundle={
  'assets/musicxml-player-one.js':{type:'chunk',imports:['assets/common-one.js'],dynamicImports:[]},
  'assets/common-one.js':{type:'chunk',imports:[],dynamicImports:['assets/admin-one.js']},
  'assets/admin-one.js':{type:'chunk',imports:[],dynamicImports:[]},
  'assets/prepare.worker-one.js':{type:'asset'},
  'assets/alphaTab.worklet-one.js':{type:'asset'},
 };
 for(const file of ['index.html',...Object.keys(bundle),'font/Bravura.woff2','font/Bravura.woff','font/Bravura.otf','font/Bravura.eot','font/Bravura.svg','font/bravura_metadata.json','soundfont/sonivox.sf2']) await writeFile(path.join(root,file),file);
 await playbackAssets('release-one',assetBase).writeBundle({dir:root},bundle);
 const filename=path.join(root,'playback/release-one/manifest.json');
 let player=JSON.parse(await readFile(filename,'utf8'));
 const fonts=[...CoreSettings.buildDefaultSmuflFontSources('/font/').values()];
 expect(fonts.sort()).toEqual(['/font/Bravura.otf','/font/Bravura.woff','/font/Bravura.woff2']);
 for(const font of fonts) expect(player.entries.some(entry=>entry.url.endsWith(font))).toBe(true);
 for(const unused of ['Bravura.eot','Bravura.svg','bravura_metadata.json']) {
  expect(player.entries.some(entry=>entry.url.endsWith(unused))).toBe(false);
  expect(await readFile(path.join(root,'playback/release-one/font',unused),'utf8')).toContain(unused);
 }
 expect(player.entries.some(entry=>entry.url.includes('admin'))).toBe(false);
 expect(player.entries.some(entry=>entry.url.includes('common'))).toBe(true);
 expect(player.entries.some(entry=>entry.url.endsWith('sonivox.sf2'))).toBe(true);
 expect(player.entries.find(entry=>entry.url.endsWith('sonivox.sf2')).url).toBe(`${assetBase}playback/release-one/soundfont/sonivox.sf2`);
 expect(player.entries.find(entry=>entry.url.endsWith('musicxml-player-one.js')).url).toBe(`${assetBase}assets/musicxml-player-one.js`);
 const shell=await shellManifest([{url:'index.html'},{url:'assets/common-one.js'}],root,'release-one',assetBase);
 player=JSON.parse(await readFile(filename,'utf8'));
 expect(player.entries.some(entry=>entry.url.includes('common'))).toBe(false);
 expect(shell.manifest.some(entry=>entry.url.endsWith('/manifest.json')&&entry.integrity.startsWith('sha256-'))).toBe(true);
 expect(shell.manifest.find(entry=>entry.url.endsWith('/manifest.json')).url).toBe(`${assetBase}playback/release-one/manifest.json`);
 expect(shell.manifest.some(entry=>/font|musicxml|alphaTab/.test(entry.url))).toBe(false);
});
