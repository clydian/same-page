import assert from 'node:assert/strict';
import { test } from 'vitest';
import * as alphaTab from '@coderline/alphatab';
import { loadMusicXml } from '@clydian/chorus-player/engine';

const note = (step: string, types: string[], { voice = '1', number = '', chord = false, duration = 2 } = {}) => `<note>${chord?'<chord/>':''}<pitch><step>${step}</step><octave>4</octave></pitch><duration>${duration}</duration>${types.map(type=>`<tie type="${type}"/>`).join('')}<voice>${voice}</voice><type>${duration===4?'whole':'half'}</type><notations>${types.map(type=>`<tied type="${type}"${number?` number="${number}"`:''}/>`).join('')}</notations></note>`;
const xml = (bars: string[], transpose = -2) => `<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Clarinet</part-name></score-part></part-list><part id="P1">${bars.map((bar,index)=>`<measure number="${index+1}">${index===0?`<attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef>${transpose?`<transpose><diatonic>-1</diatonic><chromatic>${transpose}</chromatic></transpose>`:''}</attributes>`:''}${bar}</measure>`).join('')}</part></score-partwise>`;
const bytes = (source: string) => new TextEncoder().encode(source);
const load = (source: string) => loadMusicXml(bytes(source),new alphaTab.Settings());
const notes = (score: alphaTab.model.Score) => score.tracks[0].staves[0].bars.map(bar=>bar.voices[0].beats.flatMap(beat=>beat.notes));
const midi = (score: alphaTab.model.Score) => {
 const result: {start: number; length: number; key: number}[]=[];
 class Handler extends alphaTab.midi.AlphaSynthMidiFileHandler {
  override addNote(_track: number, start: number, length: number, key: number) { result.push({start,length,key}); }
 }
 const handler=new Handler(new alphaTab.midi.MidiFile());
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

test('explicit IDs reused across XML-order-overlapping voices preserve both pitches and eight-quarter MIDI chains',()=>{
 const input=bytes(xml([note('E',['start'],{voice:'2',number:'1',duration:4}),note('F',['start'],{number:'1',duration:4})+'<backup><duration>4</duration></backup>'+note('E',['stop'],{voice:'2',number:'1',duration:4}),note('F',['stop'],{number:'1',duration:4})],0));
 const original=input.slice();const score=loadMusicXml(input,new alphaTab.Settings());
 const all=score.tracks[0].staves[0].bars.flatMap(bar=>bar.voices.flatMap(voice=>voice.beats.flatMap(beat=>beat.notes)));
 const destinations=all.filter(note=>note.tieOrigin);
 assert.deepEqual(destinations.map(note=>[note.realValue,note.tieOrigin?.realValue]),[[64,64],[65,65]]);
 assert.deepEqual(midi(score),[{start:0,length:7680,key:64},{start:3840,length:7680,key:65}]);
 assert.deepEqual(input,original);
});
