import assert from 'node:assert/strict';
import test from 'node:test';
import * as at from '@coderline/alphatab';
import { loadMusicXml } from '../src/engine.ts';
const note=(voice,pitch,duration,type,rest=false)=>`<note>${rest?'<rest/>':`<pitch><step>${pitch}</step><octave>4</octave></pitch>`}<duration>${duration}</duration><voice>${voice}</voice><type>${type}</type></note>`;
const direction=(type,offset,voice='')=>`<direction><direction-type><wedge type="${type}" number="1"/></direction-type><offset>${offset}</offset>${voice?`<voice>${voice}</voice>`:''}</direction>`;
const make=(stop=3,voice='')=>new TextEncoder().encode(`<score-partwise version="4.0"><part-list><score-part id="P"><part-name>Voice</part-name></score-part></part-list><part id="P"><measure number="1"><attributes><divisions>2</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>${direction('diminuendo',0,voice)}${direction('stop',stop*2)}${note(1,'C',8,'whole')}<backup><duration>8</duration></backup>${note(2,'E',8,'whole')}<backup><duration>8</duration></backup>${note(3,'G',4,'half')}${note(3,'G',1,'eighth')}${note(3,'G',1,'eighth',true)}${note(3,'G',2,'quarter',true)}</measure></part></score-partwise>`);
function render(score){const settings=new at.Settings();settings.core.engine='svg';settings.core.enableLazyLoading=false;settings.display.staveProfile=at.StaveProfile.Score;const r=new at.rendering.ScoreRenderer(settings);r.width=1000;const pieces=[];r.partialRenderFinished.on(e=>{if(typeof e.renderResult==='string')pieces.push(e.renderResult)});r.error.on(e=>{throw e});try{r.renderScore(score,[0]);return pieces.join('')}finally{r.destroy()}}
const wedges=svg=>[...svg.matchAll(/<path d="([^\"]+)"[^>]*style="fill: none"/g)].filter(m=>(m[1].match(/L/g)??[]).length===2&&!/[Cz]/.test(m[1])).length;
test('one staff direction creates one actual native wedge on an exact lane, not one per held voice',()=>{
 const bytes=make(),original=bytes.slice(),s=loadMusicXml(bytes,new at.Settings());
 assert.equal(wedges(render(s)),1,'actual SVG must contain one wedge for the one source direction');
 assert.equal(s.tracks[0].staves[0].bars[0].voices.filter(v=>v.beats.some(b=>b.crescendo!==at.model.CrescendoType.None)).length,1);
 assert.deepEqual(bytes,original);
});
import { prepareMusicXmlForAlphaTabBytes } from '../src/musicxml-direction-timing.ts';
import { applyAlphaTabPlaybackDynamics } from '../src/alphatab-playback-dynamics.ts';
import { restoreMusicXmlWedgeGlyphs } from '../src/musicxml-wedge-glyphs.ts';
import { loadPreparedMusicXml, assignPlaybackChannels } from '../src/engine.ts';
function legacy(bytes){const p=prepareMusicXmlForAlphaTabBytes(bytes),s=at.importer.ScoreLoader.loadScoreFromBytes(p.bytes,new at.Settings());applyAlphaTabPlaybackDynamics(s,p.partsWithExplicitDynamics,s.tracks.length,p.dynamicEventsByPart,p.wedgeEventsByPart,p.dynamicGlyphsCompleteByPart);return{s,p};}
const markers=s=>s.tracks.flatMap(t=>t.staves.flatMap(st=>st.bars.flatMap(b=>b.voices.flatMap(v=>v.beats.map(be=>({id:be.id,wedge:be.crescendo,notes:be.notes.map(n=>({key:n.realValue,dynamics:n.dynamics}))}))))));
function midi(s){assignPlaybackChannels(s.tracks);const f=new at.midi.MidiFile(),g=new at.midi.MidiFileGenerator(s,new at.Settings(),new at.midi.AlphaSynthMidiFileHandler(f));g.applyTranspositionPitches=false;g.generate();return{events:f.tracks.flatMap(t=>t.events).map(e=>JSON.stringify(e)),bars:g.tickLookup.masterBars.map(b=>({start:b.start,end:b.end}))};}
test('display-only projection preserves complete actual MIDI and all beat times and notes',()=>{
 const {s,p}=legacy(make()),before=midi(s),notes=s.tracks[0].staves[0].bars[0].voices.flatMap(v=>v.beats.map(b=>({tick:b.playbackStart,length:b.playbackDuration,notes:b.notes.map(n=>({key:n.realValue,dynamic:n.dynamics}))})));
 assert.equal(wedges(render(s)),3);assert.equal(restoreMusicXmlWedgeGlyphs(s.tracks[0],p.wedgeEventsByPart[0]),true);assert.equal(wedges(render(s)),1);assert.deepEqual(midi(s),before);
 assert.deepEqual(s.tracks[0].staves[0].bars[0].voices.flatMap(v=>v.beats.map(b=>({tick:b.playbackStart,length:b.playbackDuration,notes:b.notes.map(n=>({key:n.realValue,dynamic:n.dynamics}))}))),notes);
});
test('explicit source voice scope is kept when it has exact endpoints',()=>{const s=loadMusicXml(make(3,'3'),new at.Settings());assert.equal(wedges(render(s)),1);const voices=s.tracks[0].staves[0].bars[0].voices;assert(voices[2].beats.some(b=>b.crescendo!==at.model.CrescendoType.None));assert(voices.slice(0,2).every(v=>v.beats.every(b=>b.crescendo===at.model.CrescendoType.None)));});
for(const [name,change] of [
 ['offbeat endpoint with no exact lane',p=>p.wedgeEventsByPart[0][1].quarter=2.75],
 ['explicit held voice cannot express the stop',p=>p.wedgeEventsByPart[0][0].voice='2'],
 ['nonnumeric source voice',p=>p.wedgeEventsByPart[0][0].voice='upper'],
 ['nonnumeric stop voice retains unsupported previous path',p=>p.wedgeEventsByPart[0][1].voice='upper'],
 ['orphan stop',p=>p.wedgeEventsByPart[0].shift()],
 ['orphan continuation',p=>p.wedgeEventsByPart[0].unshift({...p.wedgeEventsByPart[0][0],type:'continue'})],
 ['open span',p=>p.wedgeEventsByPart[0].pop()],
 ['concurrent same-number start',p=>p.wedgeEventsByPart[0].splice(1,0,{...p.wedgeEventsByPart[0][0],quarter:1})],
 ['missing staff',p=>p.wedgeEventsByPart[0][0].staff=3],
])test(`unsupported projection preserves the whole previous track without partial clearing: ${name}`,()=>{const{s,p}=legacy(make()),before=markers(s);change(p);assert.equal(restoreMusicXmlWedgeGlyphs(s.tracks[0],p.wedgeEventsByPart[0]),false);assert.deepEqual(markers(s),before);});
test('plain source metadata survives a Worker clone and old prepared bytes keep previous markers',()=>{const bytes=make(),p=prepareMusicXmlForAlphaTabBytes(bytes),copy=structuredClone(p);assert.equal(wedges(render(loadPreparedMusicXml(structuredClone(p),new at.Settings()))),1);assert.deepEqual(p,copy);const old={...p};delete old.wedgeEventsByPart;const s=loadPreparedMusicXml(old,new at.Settings());assert(s.tracks[0].staves[0].bars[0].voices.length>0);assert.deepEqual(p,copy);});
test('a span crossing a bar boundary uses one source voice without changing the timeline',()=>{
 const text=new TextDecoder().decode(make(4)).replace(direction('stop',8),'').replace('</part></score-partwise>',`<measure number="2">${direction('stop',4)}${note(1,'C',4,'half')}${note(1,'C',4,'half',true)}<backup><duration>8</duration></backup>${note(2,'E',8,'whole')}<backup><duration>8</duration></backup>${note(3,'G',8,'whole')}</measure></part></score-partwise>`);
 const{s,p}=legacy(new TextEncoder().encode(text)),before=midi(s);assert.equal(restoreMusicXmlWedgeGlyphs(s.tracks[0],p.wedgeEventsByPart[0]),true);assert.deepEqual(midi(s),before);assert.equal(wedges(render(s)),1);
});
test('explicit adjacent repeated same-kind spans retain the prior path when native grouping cannot separate them',()=>{
 const{s,p}=legacy(make(4)),events=p.wedgeEventsByPart[0],before=markers(s);events[1].quarter=2;events.push({...events[0],quarter:2},{...events[1],quarter:4});assert.equal(restoreMusicXmlWedgeGlyphs(s.tracks[0],events),false);assert.deepEqual(markers(s),before);
});

test('a voice overrun keeps the previous path rather than projecting across ambiguous source bar time',()=>{
 const{s,p}=legacy(make()),beat=s.tracks[0].staves[0].bars[0].voices[0].beats[0];beat.playbackDuration*=2;const before=markers(s);assert.equal(restoreMusicXmlWedgeGlyphs(s.tracks[0],p.wedgeEventsByPart[0]),false);assert.deepEqual(markers(s),before);
});
