import assert from 'node:assert/strict';
import test from 'node:test';
import * as at from '@coderline/alphatab';
import {loadMusicXml, loadPreparedMusicXml, prepareMusicXmlForPlaybackBytes} from '../dist/engine.js';

const note = n => `<note><pitch><step>C</step><octave>4</octave></pitch><duration>${n}</duration><type>${({1:'quarter',2:'half',3:'half',4:'whole'})[n]}</type>${n===3?'<dot/>':''}</note>`;
const rest = n => `<note><rest/><duration>${n}</duration><type>${n===3?'half':'whole'}</type>${n===3?'<dot/>':''}</note>`;
function xml(parts, implicit = false) {
  return new TextEncoder().encode(`<score-partwise version="4.0"><part-list>${parts.map((_,i)=>`<score-part id="P${i}"><part-name>Owned voice ${i}</part-name></score-part>`).join('')}</part-list>${parts.map((measures,i)=>`<part id="P${i}">${measures.map((body,j)=>`<measure number="${j}"${implicit&&j===0?' implicit="yes"':''}>${j===0?'<attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>':''}${body}</measure>`).join('')}</part>`).join('')}</score-partwise>`);
}
function timeline(score) {
  const restored = at.model.JsonConverter.jsonToScore(at.model.JsonConverter.scoreToJson(score));
  const file = new at.midi.MidiFile(), generator = new at.midi.MidiFileGenerator(restored, new at.Settings(), new at.midi.AlphaSynthMidiFileHandler(file));
  generator.generate();
  return generator.tickLookup.masterBars.map(bar=>[bar.start/960,bar.end/960]);
}

test('equal source spans shorten pickup and interior fragments through prepared/legacy imports and native MIDI',()=>{
  const bytes=xml([[note(1),note(3),note(1),note(4)],[note(1),note(3),note(1),note(4)]]), original=bytes.slice();
  const prepared=prepareMusicXmlForPlaybackBytes(bytes), legacy=structuredClone(prepared);delete legacy.measureDurations;
  for(const score of [loadMusicXml(bytes,new at.Settings()),loadPreparedMusicXml(prepared,new at.Settings()),loadPreparedMusicXml(legacy,new at.Settings())]) {
    assert.deepEqual(score.masterBars.map(bar=>bar.start/960),[0,1,4,5]);
    assert.deepEqual(timeline(score),[[0,1],[1,4],[4,5],[5,9]]);
    assert.equal(score.masterBars.length,4); // Duration inference does not merge fragments.
    assert.notEqual(score.tracks[0].staves[0].bars[1].barNumberDisplay,at.model.BarNumberDisplay.Hide);
  }
  assert.deepEqual(bytes,original);
});

test('explicit rests and trailing forwards retain intentional silent time',()=>{
  for(const body of [note(1)+rest(3),note(1)+'<forward><duration>3</duration></forward>',note(1)+'<direction><direction-type><words>Owned late instruction</words></direction-type><offset>2</offset></direction>']) {
    const score=loadMusicXml(xml([[body,note(4)],[body,note(4)]]),new at.Settings());
    assert.deepEqual(timeline(score),[[0,4],[4,8]]);
  }
});

test('unequal source voices keep meter fallback; explicit short bars still use the longest voice',()=>{
  for(const implicit of [false,true]) {
    const score=loadMusicXml(xml([[note(1),note(4)],[note(2),note(4)]],implicit),new at.Settings());
    assert.deepEqual(timeline(score),implicit?[[0,2],[2,6]]:[[0,4],[4,8]]);
  }
  const twoVoices=note(1).replace('</note>','<voice>1</voice></note>')+'<backup><duration>1</duration></backup>'+note(2).replace('</note>','<voice>2</voice></note>');
  assert.equal(loadMusicXml(xml([[twoVoices]]),new at.Settings()).masterBars[0].calculateDuration(),3840);
});

test('full bars and missing part content are not inferred as short bars',()=>{
  for(const parts of [[[note(4)],[note(4)]],[[note(1)],['']]]) {
    assert.deepEqual(timeline(loadMusicXml(xml(parts),new at.Settings())),[[0,4]]);
  }
});

test('short fragments retain their repeat boundary and playback visits',()=>{
  const repeat='<barline location="right"><repeat direction="backward" times="2"/></barline>';
  const score=loadMusicXml(xml([[note(1),note(3)+repeat],[note(1),note(3)+repeat]]),new at.Settings());
  assert.deepEqual(timeline(score),[[0,1],[1,4],[4,5],[5,8]]);
  assert.equal(score.masterBars.length,2);
  assert.equal(score.masterBars[1].isRepeatEnd,true);
});

test('late sound offsets stay inside their measure and nested sound timing overrides direction timing',()=>{
  const nested='<direction><direction-type><words>Owned instruction</words></direction-type><offset sound="yes">0</offset><sound tempo="90"><offset>2</offset></sound></direction>';
  for(const marker of ['<sound tempo="90"><offset>2</offset></sound>',nested]) {
    const score=loadMusicXml(xml([[note(1)+marker,note(4)],[note(1),note(4)]]),new at.Settings());
    assert.deepEqual(timeline(score),[[0,4],[4,8]]);
    const tempos=[];const handler=new Proxy({addTempo:(tick,bpm)=>tempos.push([tick/960,bpm])},{get:(target,key)=>target[key]??(()=>{})});
    new at.midi.MidiFileGenerator(score,new at.Settings(),handler).generate();
    assert.ok(tempos.some(([quarter,bpm])=>quarter===3&&bpm===90));
    assert.ok(!tempos.some(([quarter,bpm])=>quarter===1&&bpm===90));
  }
});

test('a voice known elsewhere in the part cannot silently disappear from a short-bar inference',()=>{
  const voices=note(4).replace('</note>','<voice>1</voice></note>')+'<backup><duration>4</duration></backup>'+note(4).replace('</note>','<voice>2</voice></note>');
  assert.deepEqual(timeline(loadMusicXml(xml([[voices,note(1)]]),new at.Settings())),[[0,4],[4,8]]);
});

test('a tie across an inferred short bar stays one continuous MIDI note',()=>{
  const start=note(1).replace('</note>','<tie type="start"/><notations><tied type="start"/></notations></note>');
  const stop=note(4).replace('</note>','<tie type="stop"/><notations><tied type="stop"/></notations></note>');
  const score=loadMusicXml(xml([[start,stop]]),new at.Settings());
  const file=new at.midi.MidiFile();new at.midi.MidiFileGenerator(score,new at.Settings(),new at.midi.AlphaSynthMidiFileHandler(file)).generate();
  const events=file.tracks.flatMap(track=>track.events);
  assert.deepEqual(events.filter(e=>e.constructor.name==='NoteOnEvent').map(e=>e.tick/960),[0]);
  assert.deepEqual(events.filter(e=>e.constructor.name==='NoteOffEvent').map(e=>e.tick/960),[5]);
});

test('a measure-level D.C. keeps its return after duration inference',()=>{
  const score=loadMusicXml(xml([[note(1),note(1),note(1)+'<sound dacapo="yes"/>']]),new at.Settings());
  assert.deepEqual(timeline(score),[[0,1],[1,2],[2,3],[3,4],[4,5],[5,6]]);
});
