import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { playbackMeasureLabels } from '../dist/playback-measures.js';
import { ScoreFollowSession, isPointerDrag } from '../dist/score-follow.js';
// Exercise the shipped session against deterministic engine/Worker adapters.
const compiled = (await readFile(new URL('../dist/session.js', import.meta.url),'utf8')).replace(/^import .*$/mg,'').replace('export function createPlayerSession','function createPlayerSession').replace(/new URL\([^\n]+import.meta.url\)/,'"prepare.worker.js"');
const factory = new Function('createPlaybackApi','assignPlaybackChannels','loadPreparedMusicXml','alphaTab','applyTimbreProfile','classifyTimbreRoles','ScoreFollowSession','isPointerDrag','playbackMeasureLabels',compiled+'\nreturn createPlayerSession;');
function harness(options = {}) {
 let worker, workerCount = 0, ready;
 const previous = globalThis.Worker, previousParser = globalThis.DOMParser;
 // XML parsing is an external browser adapter in these mixer/follow tests.
 globalThis.DOMParser = class { parseFromString() { return {documentElement:{children:[]}}; } };
 globalThis.Worker = class { constructor() { worker=this;workerCount++; } terminate() {} postMessage() {} };
 const event = () => ({on(){}});
 const api = {settings:{player:{}},isReadyForPlayback:true,score:{tracks:[{},{}]},boundsLookup:{findMasterBar:()=>({staffSystemBounds:{realBounds:{y:100}}})},tickCache:{masterBars:[{masterBar:{index:0},start:0,end:100}]},error:event(),renderStarted:event(),postRenderFinished:event(),playerReady:event(),playerStateChanged:event(),playerPositionChanged:event(),changeTrackVolume(){},changeTrackMute(){},changeTrackSolo(){},renderScore(){ready();},pause(){},destroy(){},updateSettings(){},};
 const create = factory(()=>api,()=>{},()=>({tracks:[{name:'Voice',index:0},{name:'Voice',index:1}]}),{PlayerMode:{EnabledSynthesizer:1},ScrollMode:{Off:0,OffScreen:2},synth:{PlayerState:{Playing:1}}},()=>{},()=>[],ScoreFollowSession,isPointerDrag,playbackMeasureLabels);
 const session = create({getBoundingClientRect(){return {top:-(options.scrollElement?.scrollTop ?? 0)};},addEventListener(_,fn){ready=fn;},removeEventListener(){}},new Uint8Array([1]),options);
 if(worker) worker.onmessage({data:{prepared:{bytes:new Uint8Array([1])}}});
 return {session,api,get workerCount(){return workerCount;},dispose(){session.dispose();globalThis.Worker=previous;globalThis.DOMParser=previousParser;}};
}
test('focus preserves independent faders and mute/solo while adjusting two volume groups',()=>{
 const h=harness();try {
  const s=h.session; s.mix(1,{volume:.6,muted:true,solo:true});s.focus(0);
  assert.deepEqual(s.getSnapshot().parts.map(p=>[p.volume,p.muted,p.solo]),[[.75,false,false],[.25,true,true]]);
  s.mix(0,{volume:.8});s.focusOther(.15);assert.equal(s.getSnapshot().focus,0);
  assert.equal(s.getSnapshot().parts[1].volume,.15);s.focus(null);
  assert.deepEqual(s.getSnapshot().parts.map(p=>p.volume),[.75,.6]);
  assert.deepEqual(s.getSnapshot().parts.map(p=>p.name),['Voice 1','Voice 2']);
 } finally {h.dispose();}
});
test('prepared input skips Worker and manual browsing suspends follow until restored',async()=>{
 const handlers=new Map();const viewport={scrollTop:0,getBoundingClientRect(){return {top:0};},addEventListener(name,fn){handlers.set(name,fn);},removeEventListener(name){handlers.delete(name);}};
 const h=harness({scrollElement:viewport,prepared:{bytes:new Uint8Array([1])}});try {
  await Promise.resolve();assert.equal(h.workerCount,0);
  handlers.get('wheel')();handlers.get('scroll')();assert.equal(h.session.getSnapshot().following,false);
  h.session.follow();assert.equal(h.session.getSnapshot().following,true);assert.equal(viewport.scrollTop,84);
  handlers.get('keydown')({key:'PageDown'});handlers.get('scroll')();assert.equal(h.session.getSnapshot().following,false);
  h.session.follow();assert.equal(h.session.getSnapshot().following,true);
 } finally {h.dispose();}assert.equal(handlers.size,0);
});


test('public source-session coordinate seek and explicit follow suspension preserve the shipped behavior',async()=>{
 const h=harness({prepared:{bytes:new Uint8Array([1])}});try{
  await Promise.resolve(); const beat={index:3}; h.api.boundsLookup.getBeatAtPos=(x,y)=>{assert.equal(x,12);assert.equal(y,34);return beat;};
  h.api.tickCache.getBeatStart=value=>{assert.equal(value,beat);return 2400;};
  h.session.seekAt(12,34);assert.equal(h.api.tickPosition,2400);
  h.session.seekAt(NaN,34);assert.equal(h.api.tickPosition,2400);
  h.session.suspendFollow();assert.equal(h.session.getSnapshot().following,false);
 }finally{h.dispose();}
});
