import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import * as at from '@coderline/alphatab';
import {loadMusicXml,loadPreparedMusicXml} from '../src/engine.ts';
import {prepareMusicXmlForAlphaTabBytes} from '../src/musicxml-direction-timing.ts';
const bytes=new Uint8Array(readFileSync(new URL('./fixtures/mixed-numbered-unnumbered-ties.musicxml',import.meta.url)));
function midi(score){const events=[];class Handler extends at.midi.AlphaSynthMidiFileHandler{addNote(track,start,length,key,velocity,channel){events.push({track,start,length,key});super.addNote(track,start,length,key,velocity,channel);}}new at.midi.MidiFileGenerator(score,new at.Settings(),new Handler(new at.midi.MidiFile())).generate();return events;}
test('a completed numbered G3 tie cannot capture a later unnumbered G3 chain',()=>{
 const original=bytes.slice();
 for(const score of [loadMusicXml(bytes,new at.Settings()),loadPreparedMusicXml(structuredClone(prepareMusicXmlForAlphaTabBytes(bytes)),new at.Settings())]) {
 assert.deepEqual(midi(score),[{track:0,start:0,length:2400,key:55},{track:0,start:3840,length:5760,key:55}]);
 const bars=score.tracks[0].staves[0].bars,first=bars[0].voices[0].beats.flatMap(b=>b.notes),second=bars[1].voices[0].beats[0].notes[0],third=bars[2].voices[0].beats[0].notes[0];
 assert.equal(first[0].tieDestination,first[1]);assert.equal(first[1].tieOrigin,first[0]);assert.equal(second.tieDestination,third);assert.equal(third.tieOrigin,second);assert.deepEqual(bytes,original);
 }
});

test('an unresolved unnumbered endpoint retains native fallback instead of corrupting a preceding complete chain',()=>{
 const source=new TextDecoder().decode(bytes).replaceAll(' number="1"','').replace(/(<measure number="2">)([\s\S]*?)(<\/measure>)/,(_,open,body,close)=>open+body.replace('<tie type="start"/>','').replace('<notations><tied type="start"/></notations>','')+close);
 const input=new TextEncoder().encode(source),native=at.importer.ScoreLoader.loadScoreFromBytes(input,new at.Settings());
 assert.equal(midi(native)[0].length,2400);
 assert.deepEqual(midi(loadMusicXml(input,new at.Settings())),midi(native));
});

test('a tied grace endpoint keeps the native part path and its separate grace attack',()=>{
 const source=new TextDecoder().decode(bytes).replace(/(<tied[^>]*) number="1"/g,'$1').replace(/<measure number="2">[\s\S]*?<\/measure>/,'<measure number="2"><note><grace/><pitch><step>G</step><octave>3</octave></pitch><tie type="stop"/><voice>1</voice><type>eighth</type><notations><tied type="stop"/></notations></note><note><pitch><step>A</step><octave>3</octave></pitch><duration>8</duration><voice>1</voice><type>whole</type></note></measure>').replace(/<measure number="3">[\s\S]*?<\/measure>/,'');
 const input=new TextEncoder().encode(source),expected=[{track:0,start:0,length:2400,key:55},{track:0,start:3840,length:120,key:55},{track:0,start:3960,length:3720,key:57}];
 assert.deepEqual(midi(at.importer.ScoreLoader.loadScoreFromBytes(input,new at.Settings())),expected);
 for(const score of [loadMusicXml(input,new at.Settings()),loadPreparedMusicXml(structuredClone(prepareMusicXmlForAlphaTabBytes(input)),new at.Settings())])assert.deepEqual(midi(score),expected);
});
