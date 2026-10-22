import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as alphaTab from '@coderline/alphatab';
import { loadMusicXml } from '../src/engine.ts';
import { normalizeMusicXmlTransposedTies } from '../src/musicxml-transposed-ties.ts';

const note = (step, types, { voice = '1', number = '', chord = false, duration = 2 } = {}) => `<note>${chord?'<chord/>':''}<pitch><step>${step}</step><octave>4</octave></pitch><duration>${duration}</duration>${types.map(type=>`<tie type="${type}"/>`).join('')}<voice>${voice}</voice><type>${duration===4?'whole':'half'}</type><notations>${types.map(type=>`<tied type="${type}"${number?` number="${number}"`:''}/>`).join('')}</notations></note>`;
const xml = (bars, transpose = -2) => `<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Clarinet</part-name></score-part></part-list><part id="P1">${bars.map((bar,index)=>`<measure number="${index+1}">${index===0?`<attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef>${transpose?`<transpose><diatonic>-1</diatonic><chromatic>${transpose}</chromatic></transpose>`:''}</attributes>`:''}${bar}</measure>`).join('')}</part></score-partwise>`;
const bytes = source => new TextEncoder().encode(source);
const load = source => loadMusicXml(bytes(source),new alphaTab.Settings());
const notes = score => score.tracks[0].staves[0].bars.map(bar=>bar.voices[0].beats.flatMap(beat=>beat.notes));
const midi = score => {
 const result=[];const handler=new Proxy({addNote:(track,start,length,key)=>result.push({start,length,key})},{get:(target,key)=>target[key]??(()=>{})});
 new alphaTab.midi.MidiFileGenerator(score,new alphaTab.Settings(),handler).generate();return result;
};

test('transposed unnumbered ties keep their adjacent origins, concert pitches and MIDI lengths',()=>{
 const input=bytes(xml([note('D',['start'])+note('D',['stop']),note('C',['start'])+note('C',['stop'])]));
 const original=input.slice();const score=loadMusicXml(input,new alphaTab.Settings());const n=notes(score);
 assert.equal(n[0][1].tieOrigin===n[0][0],true);
 assert.equal(n[1][1].tieOrigin===n[1][0],true);
 assert.deepEqual(n.map(bar=>bar.map(note=>note.realValue)),[[60,60],[58,58]]);
 assert.deepEqual(midi(score),[{start:0,length:3840,key:60},{start:3840,length:3840,key:58}]);
 assert.deepEqual(input,original);
});

test('start-before-stop notation on a continuation consumes the previous tie first',()=>{
 const score=load(xml([note('D',['start'],{duration:4}),note('D',['start','stop'],{duration:4}),note('D',['stop'],{duration:4})]));const n=notes(score);
 assert.equal(n[1][0].tieOrigin===n[0][0],true);assert.equal(n[2][0].tieOrigin===n[1][0],true);
 assert.deepEqual(midi(score),[{start:0,length:11520,key:60}]);
});

test('simultaneous chord ties receive distinct active IDs',()=>{
 const score=load(xml([note('D',['start'])+note('F',['start'],{chord:true})+note('D',['stop'])+note('F',['stop'],{chord:true})]));const n=notes(score)[0];
 assert.equal(n[2].tieOrigin===n[0],true);assert.equal(n[3].tieOrigin===n[1],true);
 assert.deepEqual(n.map(n=>n.realValue),[60,63,60,63]);
});

test('independent voices at the same written pitch keep separate tie chains',()=>{
 const score=load(xml([note('D',['start'])+note('D',['stop'])+'<backup><duration>4</duration></backup>'+note('D',['start'],{voice:'2'})+note('D',['stop'],{voice:'2'})]));
 const voices=score.tracks[0].staves[0].bars[0].voices;
 for(const voice of voices)assert.equal(voice.beats[1].notes[0].tieOrigin===voice.beats[0].notes[0],true);
});

test('safe sequential explicit and unnumbered chains may reuse an importer ID',()=>{
 const input=bytes(xml([note('D',['start'],{number:'1'})+note('D',['stop'],{number:'1'}),note('C',['start'])+note('C',['stop'])]));
 const n=notes(loadMusicXml(input,new alphaTab.Settings()));assert.equal(n[1][1].tieOrigin===n[1][0],true);
 assert.deepEqual(midi(loadMusicXml(input,new alphaTab.Settings())),[{start:0,length:3840,key:60},{start:3840,length:3840,key:58}]);
});

test('incomplete chains retain original bytes',()=>{
 for(const source of [xml([note('D',['start'])]),xml([note('D',['stop'])])]){
  const input=bytes(source);assert.equal(normalizeMusicXmlTransposedTies(input)===input,true);
 }
});

test('a later same-pitch stop across an intervening note or rest is not guessed',()=>{
 for(const middle of [note('D',[]),note('F',[]),'<note><rest/><duration>2</duration><voice>1</voice><type>half</type></note>']){
  const input=bytes(xml([note('D',['start'])+middle+note('D',['stop'])]));assert.equal(normalizeMusicXmlTransposedTies(input)===input,true);
 }
});

test('three simultaneous same-pitch starts remain ambiguous until their stop',()=>{
 const input=bytes(xml([note('D',['start'])+note('D',['start'],{chord:true})+note('D',['start'],{chord:true})+note('D',['stop'])]));
 assert.equal(normalizeMusicXmlTransposedTies(input)===input,true);
});

test('tie adjacency survives changes of divisions',()=>{
 const score=load(xml([note('D',['start'],{duration:4}),'<attributes><divisions>2</divisions></attributes>'+note('D',['stop'],{duration:4})+'<note><rest/><duration>4</duration><voice>1</voice><type>half</type></note>']));
 const n=notes(score);assert.equal(n[1][0].tieOrigin===n[0][0],true);
});

test('explicit IDs reused across XML-order-overlapping voices preserve both pitches and eight-quarter MIDI chains',()=>{
 const input=bytes(xml([note('E',['start'],{voice:'2',number:'1',duration:4}),note('F',['start'],{number:'1',duration:4})+'<backup><duration>4</duration></backup>'+note('E',['stop'],{voice:'2',number:'1',duration:4}),note('F',['stop'],{number:'1',duration:4})],0));
 const original=input.slice();const score=loadMusicXml(input,new alphaTab.Settings());
 const all=score.tracks[0].staves[0].bars.flatMap(bar=>bar.voices.flatMap(voice=>voice.beats.flatMap(beat=>beat.notes)));
 const destinations=all.filter(note=>note.tieOrigin);
 assert.deepEqual(destinations.map(note=>[note.realValue,note.tieOrigin.realValue]),[[64,64],[65,65]]);
 assert.deepEqual(midi(score),[{start:0,length:7680,key:64},{start:3840,length:7680,key:65}]);
 assert.deepEqual(input,original);
});

test('unsupported cross-voice, cross-staff, incomplete and ambiguous explicit ties retain original bytes',()=>{
 const examples=[
  xml([note('D',['start'],{number:'1',duration:4}),note('D',['stop'],{voice:'2',number:'1',duration:4})],0),
  xml([note('D',['start'],{number:'1',duration:4}).replace('<voice>','<staff>1</staff><voice>'),note('D',['stop'],{number:'1',duration:4}).replace('<voice>','<staff>2</staff><voice>')],0),
  xml([note('D',['start'],{number:'1',duration:4})],0),
  xml([note('D',['start'],{number:'1'})+note('D',['start'],{number:'1',chord:true})+note('D',['stop'],{number:'1'})],0),
  xml([note('D',['start'],{number:'1'})+note('D',['stop'],{number:'1'})+note('D',['stop'],{number:'1',chord:true})],0),
 ];
 for(const source of examples){const input=bytes(source);assert.equal(normalizeMusicXmlTransposedTies(input),input);}
});

test('unresolved explicit IDs are reserved while complete colliding chains are reassigned',()=>{
 const source=xml([note('G',['start'],{voice:'3',number:'1',duration:4})+'<backup><duration>4</duration></backup>'+note('E',['start'],{voice:'2',number:'1',duration:4}),note('F',['start'],{number:'1',duration:4})+'<backup><duration>4</duration></backup>'+note('E',['stop'],{voice:'2',number:'1',duration:4}),note('F',['stop'],{number:'1',duration:4})],0);
 const normalized=new TextDecoder().decode(normalizeMusicXmlTransposedTies(bytes(source)));
 assert.equal((normalized.match(/<tied type="start" number="1"/g)??[]).length,1);
 assert.equal((normalized.match(/number="2"/g)??[]).length>=2,true);
 assert.equal((normalized.match(/number="3"/g)??[]).length>=2,true);
});

test('number budget exhaustion leaves the entire part unchanged',()=>{
 const pending=Array.from({length:16},(_,i)=>note('G',['start'],{voice:String(i+2),number:String(i+1)})+'<backup><duration>2</duration></backup>').join('');
 const input=bytes(xml([pending+note('D',['start'],{number:'17'})+note('D',['stop'],{number:'17'})],0));
 assert.equal(normalizeMusicXmlTransposedTies(input),input);
});

test('a silent remainder in an ordinary partial bar does not imply an adjacent tie',()=>{
 const input=bytes(xml([note('F',[],{duration:4}),note('D',['start'],{number:'1'}),note('D',['stop'],{number:'1',duration:4})],0));
 assert.equal(normalizeMusicXmlTransposedTies(input),input);
});

test('polymetric time declarations retain the original input rather than assuming one staff timeline',()=>{
 const source=xml([note('D',['start'],{number:'2',duration:4}),note('D',['stop'],{number:'2',duration:4})],0).replace('<time>','<time number="1">');
 const input=bytes(source);assert.equal(normalizeMusicXmlTransposedTies(input),input);
});

test('continue markers keep their complete original chain untouched',()=>{
 const input=bytes(xml([note('D',['start'],{number:'2',duration:4}),note('D',['stop','start'],{number:'2',duration:4}).replace('<tied type="stop" number="2"/><tied type="start" number="2"/>','<tied type="continue" number="2"/>'),note('D',['stop'],{number:'2',duration:4})],0));
 assert.equal(normalizeMusicXmlTransposedTies(input),input);
});
