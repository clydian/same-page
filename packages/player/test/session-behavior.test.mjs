import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { playbackMeasureLabels } from '../dist/playback-measures.js';
import { ScoreFollowSession, isPointerDrag } from '../dist/score-follow.js';
import { CURRENT_IMPORT_INPUT_VERSION, isCompatibleMusicXmlPreparation } from '../dist/musicxml-direction-timing.js';
// Exercise the shipped session against deterministic engine/Worker adapters.
const compiled = (await readFile(new URL('../dist/session.js', import.meta.url),'utf8')).replace(/^(?:import|export \{).*$/mg,'').replace('export function createPlayerSession','function createPlayerSession').replace(/new URL\([^\n]+import.meta.url\)/,'"prepare.worker.js"');
const factory = new Function('createPlaybackApi','assignPlaybackChannels','loadPreparedMusicXml','alphaTab','applyTimbreProfile','classifyTimbreRoles','ScoreFollowSession','isPointerDrag','playbackMeasureLabels','isCompatibleMusicXmlPreparation',compiled+'\nreturn createPlayerSession;');
function harness(options = {}) {
 let worker, workerCount = 0, parses = 0, ready, observer;
 const previous = globalThis.Worker, previousParser = globalThis.DOMParser, previousObserver = globalThis.MutationObserver;
 // XML parsing is an external browser adapter in these mixer/follow tests.
 globalThis.DOMParser = class { parseFromString() { parses++; return {documentElement:{children:[]}}; } };
 globalThis.Worker = class { constructor() { worker=this;workerCount++; } terminate() {this.terminated=true;} postMessage(bytes) {this.bytes=bytes;} };
 globalThis.MutationObserver = class { constructor(fn) {observer=this;this.notify=fn;} observe() {} disconnect() {this.disconnected=true;} };
 const event = () => {const listeners=[];return {on(fn){listeners.push(fn);},emit(value){listeners.forEach(fn=>fn(value));}};};
 const api = {settings:{player:{}},renderer:{partialRenderFinished:event()},isReadyForPlayback:true,score:{tracks:[{},{}]},boundsLookup:{findMasterBar:()=>({staffSystemBounds:{realBounds:{y:100}}})},tickCache:{masterBars:[{masterBar:{index:0},start:0,end:100}]},error:event(),renderStarted:event(),postRenderFinished:event(),playerReady:event(),midiLoaded:event(),soundFontLoaded:event(),playerStateChanged:event(),playerPositionChanged:event(),changeTrackVolume(){},changeTrackMute(){},changeTrackSolo(){},renderScore(){ready();},playPause(){},pause(){},destroy(){},updateSettings(){},};
 const create = factory(()=>api,()=>{},()=>({tracks:[{name:'Voice',index:0},{name:'Voice',index:1}]}),{PlayerMode:{EnabledSynthesizer:1},ScrollMode:{Off:0,OffScreen:2},synth:{PlayerState:{Playing:1}},model:{BarNumberDisplay:{Hide:1}}},()=>{},()=>[],ScoreFollowSession,isPointerDrag,playbackMeasureLabels,isCompatibleMusicXmlPreparation);
 const element={getBoundingClientRect(){return {top:-(options.scrollElement?.scrollTop ?? 0)};},addEventListener(_,fn){ready=fn;},removeEventListener(){},querySelector(){return null;}};
 const session = create(element,new Uint8Array([1]),options);
 if(worker) worker.onmessage({data:{prepared:{bytes:new Uint8Array([1])}}});
 return {session,api,element,worker,observer,get parses(){return parses;},get workerCount(){return workerCount;},dispose(){session.dispose();globalThis.Worker=previous;globalThis.DOMParser=previousParser;globalThis.MutationObserver=previousObserver;}};
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
  h.api.tickCache.masterBars[0].end=4000; await Promise.resolve(); const beat={index:3}; h.api.boundsLookup.getBeatAtPos=(x,y)=>{assert.equal(x,12);assert.equal(y,34);return beat;};
  h.api.tickCache.getBeatStart=value=>{assert.equal(value,beat);return 2400;};
  h.session.seekAt(12,34);assert.equal(h.api.tickPosition,2400);
  h.session.seekAt(NaN,34);assert.equal(h.api.tickPosition,2400);
  h.session.suspendFollow();assert.equal(h.session.getSnapshot().following,false);
 }finally{h.dispose();}
});

test('current prepared labels, including an empty array, skip the legacy DOM parse',async()=>{
 const h=harness({prepared:{bytes:new Uint8Array([1]),measureLabels:[],importInputVersion:CURRENT_IMPORT_INPUT_VERSION}});
 try {await Promise.resolve();assert.equal(h.workerCount,0);assert.equal(h.parses,0);assert.equal(h.session.getSnapshot().status,'ready');}
 finally {h.dispose();}
 const legacy=harness({prepared:{bytes:new Uint8Array([1])}});
 try {await Promise.resolve();assert.equal(legacy.parses,1);assert.equal(legacy.workerCount,0);}
 finally {legacy.dispose();}
});

test('unknown prepared input is rebuilt from original bytes rather than rendered or surfaced as a playback failure',()=>{
 const replies=[];
 const h=harness({prepared:{bytes:new Uint8Array([99]),importInputVersion:'future-v99'},onPrepared:value=>replies.push(value)});
 try {assert.equal(h.workerCount,1);assert.deepEqual(h.worker.bytes,new Uint8Array([1]));assert.equal(replies.length,1);assert.equal(h.session.getSnapshot().status,'ready');}
 finally {h.dispose();}
});

const musicPartial = {firstMasterBarIndex:0,lastMasterBarIndex:1,renderResult:'<svg><text>whole note</text><rect width="1" height="2"/></svg>'};
const musicalBounds = () => [{bars:[{bars:[{beats:[{}]}]}]}];

test('readable-system signal accepts pathless music after its partial and bounds, while rejecting title SVG alone',async()=>{
 let reports=0;
 const h=harness({prepared:{bytes:new Uint8Array([1]),measureLabels:[]},onFirstReadableSystem:()=>reports++});
 try {
  await Promise.resolve(); h.api.boundsLookup.staffSystems=[]; h.api.postRenderFinished.emit();assert.equal(reports,0);
  h.element.querySelector=()=>({}); h.observer.notify();assert.equal(reports,0,'SVG alone cannot certify notation');
  h.api.boundsLookup.staffSystems=musicalBounds();
  h.api.renderer.partialRenderFinished.emit({firstMasterBarIndex:-1,lastMasterBarIndex:-1,renderResult:'<svg><text>Title</text></svg>'});
  h.api.postRenderFinished.emit();assert.equal(reports,0,'title SVG plus whole-score bounds is not readable music');
  h.api.renderer.partialRenderFinished.emit({...musicPartial,renderResult:null});assert.equal(reports,0,'a layout placeholder is not rendered notation');
  h.api.renderer.partialRenderFinished.emit(musicPartial);assert.equal(reports,1,'whole-note SVG does not require a path');
  h.observer.notify();h.api.postRenderFinished.emit();assert.equal(reports,1);assert.equal(h.observer.disconnected,true);
 } finally {h.dispose();}
 h.observer.notify();h.api.renderer.partialRenderFinished.emit(musicPartial);assert.equal(reports,1);
});

test('musical partial waits for both current bounds and installed SVG in either message order',async()=>{
 for(const boundsFirst of [true,false]) {
  let reports=0;const h=harness({prepared:{bytes:new Uint8Array([1]),measureLabels:[]},onFirstReadableSystem:()=>reports++});
  try {
   await Promise.resolve();h.api.boundsLookup.staffSystems=boundsFirst?musicalBounds():[];
   h.api.renderer.partialRenderFinished.emit(musicPartial);assert.equal(reports,0,'no installed SVG');
   h.element.querySelector=()=>({});h.observer.notify();assert.equal(reports,boundsFirst?1:0);
   if(!boundsFirst){h.api.boundsLookup.staffSystems=musicalBounds();h.api.postRenderFinished.emit();assert.equal(reports,1);}
  }finally{h.dispose();}
 }
});

test('new layout cannot combine an old rendered partial with a title-only SVG',async()=>{
 let reports=0;const h=harness({prepared:{bytes:new Uint8Array([1]),measureLabels:[]},onFirstReadableSystem:()=>reports++});
 try {
  await Promise.resolve();h.api.boundsLookup.staffSystems=[];h.api.renderer.partialRenderFinished.emit(musicPartial);
  h.api.renderStarted.emit();h.element.querySelector=()=>({});h.api.boundsLookup.staffSystems=musicalBounds();
  h.api.postRenderFinished.emit();assert.equal(reports,0);
  h.api.renderer.partialRenderFinished.emit(musicPartial);assert.equal(reports,1);
 }finally{h.dispose();}
});

test('disposal fences late Worker preparation and readiness callbacks',()=>{
 const replies=[];const h=harness({onPrepared:value=>replies.push(value)});h.dispose();
 h.worker.onmessage({data:{prepared:{bytes:new Uint8Array([9])}}});
 assert.equal(replies.length,1);assert.equal(h.worker.terminated,true);
});

test('loading stages use actual engine events once, repeat playback starts, and isolate timing sink exceptions',async()=>{
 const stages=[];
 const h=harness({prepared:{bytes:new Uint8Array([1]),measureLabels:[]},onLoadingStage:stage=>{stages.push(stage);if(stage==='model-ready')throw new Error('failed timing sink');}});
 try {
  await Promise.resolve();assert.deepEqual(stages,['source-prepared','model-ready','ready']);assert.equal(h.session.getSnapshot().status,'ready');
  h.api.midiLoaded.emit();h.api.midiLoaded.emit();h.api.soundFontLoaded.emit();h.api.soundFontLoaded.emit();
  assert.deepEqual(stages.slice(3),['midi-ready','soundfont-ready']);
  h.session.playPause();h.api.playerStateChanged.emit({state:1});h.session.playPause();h.api.playerStateChanged.emit({state:0});h.session.playPause();h.api.playerStateChanged.emit({state:1});
  assert.deepEqual(stages.slice(5),['play-request','playing','play-request','playing']);
  h.api.boundsLookup.staffSystems=musicalBounds();h.element.querySelector=()=>({});h.api.renderer.partialRenderFinished.emit(musicPartial);h.observer.notify();h.api.postRenderFinished.emit();
  assert.equal(stages.filter(stage=>stage==='first-system').length,1);
 } finally {h.dispose();}
 const previous=stages.length;h.api.midiLoaded.emit();h.api.playerStateChanged.emit({state:1});assert.equal(stages.length,previous);
});

test('all seek entry points retain the loop and resolve to the same nearest boundary',async()=>{
 const viewport={scrollTop:0,getBoundingClientRect:()=>({top:0}),addEventListener(){},removeEventListener(){}};
 const h=harness({scrollElement:viewport,prepared:{bytes:new Uint8Array([1])}});
 try {
  h.api.tickCache.masterBars=Array.from({length:8},(_,index)=>({masterBar:{index},start:index*100,end:(index+1)*100}));
  await Promise.resolve();h.session.loop(2,4);
  h.session.seek(7);assert.equal(h.api.tickPosition,400);assert.equal(h.session.getSnapshot().measure,4);
  h.session.seek(0);assert.equal(h.api.tickPosition,200);assert.equal(h.session.getSnapshot().measure,2);
  h.api.boundsLookup.getBeatAtPos=()=>({});h.api.tickCache.getBeatStart=()=>750;
  h.session.seekAt(12,34);assert.equal(h.api.tickPosition,400);
  h.api.tickCache.getBeatStart=()=>350;h.session.seekAt(12,34);assert.equal(h.api.tickPosition,350);
  assert.deepEqual(h.api.playbackRange,{startTick:200,endTick:500});
  h.session.loop(3,3);h.session.seek(7);assert.equal(h.api.tickPosition,300);
  h.session.loop(null);h.session.seek(7);assert.equal(h.api.tickPosition,700);
 }finally{h.dispose();}
});

test('range preview can leave the loop without seeking and cancel restores browsing and playback',async()=>{
 const viewport={scrollTop:40,getBoundingClientRect:()=>({top:0}),addEventListener(){},removeEventListener(){}};
 const h=harness({scrollElement:viewport,prepared:{bytes:new Uint8Array([1])}});
 try {
  h.api.tickCache.masterBars=Array.from({length:8},(_,index)=>({masterBar:{index},start:index*100,end:(index+1)*100}));
  h.api.score.tracks[0].staves=[{bars:Array.from({length:8},(_,index)=>({voices:[{beats:[{index}]}]}))}];
  const highlights=[];let pauses=0,resumes=0;
  h.api.highlightPlaybackRange=(a,b)=>highlights.push([a.index,b.index]);h.api.clearPlaybackRangeHighlight=()=>{};
  h.api.pause=()=>pauses++;h.api.play=()=>resumes++;
  await Promise.resolve();h.session.loop(2,4);h.session.suspendFollow();viewport.scrollTop=40;
  h.api.playerStateChanged.emit({state:1});
  h.session.previewMeasure(7);assert.equal(pauses,1);assert.equal(h.api.tickPosition,200);
  assert.deepEqual(highlights.at(-1),[2,4]);assert.notEqual(viewport.scrollTop,40);
  h.session.previewMeasure(6);h.session.seek(3);assert.equal(pauses,1);assert.equal(h.api.tickPosition,200);
  h.session.previewMeasure(null);assert.equal(viewport.scrollTop,40);assert.equal(resumes,1);assert.equal(h.session.getSnapshot().following,false);
  assert.deepEqual(h.api.playbackRange,{startTick:200,endTick:500});
  h.session.previewMeasure(7);h.session.loop(5,7);assert.equal(h.api.tickPosition,500);assert.equal(resumes,2);
  assert.deepEqual(h.api.playbackRange,{startTick:500,endTick:800});
 }finally{h.dispose();}
});

test('score taps resolve the repeated occurrence inside the active loop, preserving beat offset',async()=>{
 const h=harness({prepared:{bytes:new Uint8Array([1])}});
 try {
  h.api.tickCache.masterBars=Array.from({length:8},(_,index)=>({masterBar:{index:index%4},start:index*100,end:(index+1)*100}));
  await Promise.resolve();h.session.loop(4,7);
  const beat={voice:{bar:{masterBar:{index:2}}}};
  h.api.boundsLookup.getBeatAtPos=()=>beat;h.api.tickCache.getBeatStart=()=>220;
  h.api.tickCache.getRelativeBeatPlaybackRange=()=>({startTick:20,endTick:80});
  h.session.seekAt(12,34);assert.equal(h.api.tickPosition,620);assert.equal(h.session.getSnapshot().measure,6);
  h.session.loop(null);h.session.seekAt(12,34);assert.equal(h.api.tickPosition,620,'unrestricted taps retain the closest repeat visit');
 }finally{h.dispose();}
});

test('preview marker refreshes after reflow even when a manual browsing anchor wins',async()=>{
 const previousDocument=globalThis.document,markers=[];
 globalThis.document={createElement:()=>({style:{},setAttribute(){},remove(){}})};
 const viewport={scrollTop:0,clientHeight:600,getBoundingClientRect:()=>({top:0}),addEventListener(){},removeEventListener(){}};
 const h=harness({scrollElement:viewport,prepared:{bytes:new Uint8Array([1])}});
 try {
  await Promise.resolve();h.element.append=marker=>markers.push(marker);
  let width=100;const bounds=()=>({realBounds:{x:10,y:400,w:width,h:80},staffSystemBounds:{realBounds:{y:100}}});
  h.api.boundsLookup.findMasterBar=bounds;h.api.boundsLookup.findMasterBarByIndex=bounds;
  h.api.boundsLookup.staffSystems=[{realBounds:{y:100,h:100},bars:[{index:0}]}];
  h.session.suspendFollow();h.api.renderStarted.emit();h.session.previewMeasure(0);assert.equal(markers.at(-1).style.width,'100px');assert.equal(viewport.scrollTop,292,'preview scrolls to actual measure bounds rather than stale system bounds');
  width=150;h.api.postRenderFinished.emit();assert.equal(markers.at(-1).style.width,'150px');assert.equal(viewport.scrollTop,292,'pending browse anchors cannot override endpoint preview');
 }finally{h.dispose();globalThis.document=previousDocument;}
});
