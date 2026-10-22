import assert from 'node:assert/strict';
import test from 'node:test';
import * as at from '@coderline/alphatab';
import {loadMusicXml,assignPlaybackChannels,preparePianoPlaybackMidi} from '../dist/engine.js';
const rest=(v,d,type,dot='')=>`<note><rest/><duration>${d}</duration><voice>${v}</voice><type>${type}</type>${dot}</note>`;
const note=(v,type,d)=>`<note><pitch><step>F</step><octave>4</octave></pitch><duration>${d}</duration><tie type="${type}"/><voice>${v}</voice><type>${d===1?'eighth':'quarter'}</type><notations><tied type="${type}" number="7"/></notations></note>`;
// Polyphonic document order need not be musical order (MusicXML number-level).
const measure=rest(1,4,'half')+note(1,'stop',2)+rest(1,2,'quarter')+'<backup><duration>8</duration></backup>'+rest(2,3,'quarter','<dot/>')+note(2,'start',1)+rest(2,4,'half');
const bytes=new TextEncoder().encode(`<score-partwise version="4.0"><part-list><score-part id="P"><part-name>Keyboard reduction (for rehearsal only)</part-name></score-part></part-list><part id="P">${[1,2].map(n=>`<measure number="${n}">${n===1?'<attributes><divisions>2</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>':''}${measure}</measure>`).join('')}</part></score-partwise>`);
for(const workerJson of [false,true])test(`installed native plays reverse-serialized same-bar voice ties, WorkerJSON=${workerJson}`,()=>{
 const settings=new at.Settings();let score=loadMusicXml(bytes,settings);const originalLabel=score.tracks[0].name,originalBytes=bytes.slice();if(workerJson)score=at.model.JsonConverter.jsObjectToScore(at.model.JsonConverter.scoreToJsObject(score));
 assignPlaybackChannels(score.tracks);const file=new at.midi.MidiFile(),g=new at.midi.MidiFileGenerator(score,settings,new at.midi.AlphaSynthMidiFileHandler(file));g.applyTranspositionPitches=false;g.generate();preparePianoPlaybackMidi(score,file,settings);
 const events=file.tracks.flatMap(t=>t.events).filter(e=>e instanceof at.midi.NoteOnEvent||e instanceof at.midi.NoteOffEvent).map(e=>[e.constructor.name,e.tick,e.noteKey]);
 assert.deepEqual(events,[['NoteOnEvent',1440,65],['NoteOffEvent',2880,65],['NoteOnEvent',5280,65],['NoteOffEvent',6720,65]]);
 for(const b of score.tracks[0].staves[0].bars){const stop=b.voices[0].beats[1].notes[0];assert.equal(stop.tieOrigin?.beat.voice.bar,b);assert.equal(stop.tieOrigin?.beat.voice.index,1);}
 assert.equal(score.tracks[0].name,originalLabel);assert.equal(originalLabel.replace(/\u00a0/g,' '),'Keyboard reduction (for rehearsal only)');assert.deepEqual(bytes,originalBytes);
});
