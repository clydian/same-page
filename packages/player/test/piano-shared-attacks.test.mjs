import assert from 'node:assert/strict';
import test from 'node:test';
import * as at from '@coderline/alphatab';
import { loadMusicXml, assignPlaybackChannels } from '../src/engine.ts';
import { bindPianoMidiCorrection } from '../src/piano-shared-attacks.ts';

const note = (duration, voice, step = 'G') => `<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>${duration}</duration><voice>${voice}</voice><type>${duration===2?'quarter':'eighth'}</type><stem>${voice===1?'up':'down'}</stem></note>`;
const fixture = (name = 'Piano', program = 1, repeated = false) => `<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>${name}</part-name><score-instrument id="I1"><instrument-name>${name}</instrument-name></score-instrument><midi-instrument id="I1"><midi-channel>1</midi-channel><midi-program>${program}</midi-program></midi-instrument></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>2</divisions><time><beats>1</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>${note(2,1)}<backup><duration>2</duration></backup>${note(1,2)}${repeated?note(1,2):'<note><rest/><duration>1</duration><voice>2</voice><type>eighth</type></note>'}</measure></part></score-partwise>`;
const load = source => loadMusicXml(new TextEncoder().encode(source), new at.Settings());
function rawMidi(score) {
  const file = new at.midi.MidiFile();
  const generator = new at.midi.MidiFileGenerator(score, new at.Settings(), new at.midi.AlphaSynthMidiFileHandler(file));
  generator.applyTranspositionPitches = false; generator.generate(); return file;
}
function adapt(score, file) {
  let callback;
  bindPianoMidiCorrection({ score, settings: new at.Settings(), midiLoad: { on(fn) { callback=fn; } } });
  callback(file); return file;
}
const noteOns = file => file.tracks.flatMap(track=>track.events).filter(event=>event instanceof at.midi.NoteOnEvent).map(e=>[e.track,e.tick,e.channel,e.noteKey,e.noteVelocity]);
const noteOffs = file => file.tracks.flatMap(track=>track.events).filter(event=>event instanceof at.midi.NoteOffEvent).map(e=>[e.track,e.tick,e.channel,e.noteKey]);
const heads = score => score.tracks.flatMap(t=>t.staves.flatMap(s=>s.bars.flatMap(b=>b.voices.flatMap(v=>v.beats.flatMap(beat=>beat.notes.map(n=>[v.index,beat.playbackStart,beat.playbackDuration,n.realValue,n.isTieDestination,beat.stemDirection]))))));

for (const name of ['Keyboard reduction', '  KEYBOARD  REDUCTION  ', 'Keyboard reduction (for rehearsal only)']) test(`recognizes the bounded ${name.trim()} source label without renaming it`, () => {
  const source=fixture(name), bytes=new TextEncoder().encode(source), original=bytes.slice();
  const score=loadMusicXml(bytes,new at.Settings()), before=heads(score), label=score.tracks[0].name;
  const file=rawMidi(score); assert.equal(noteOns(file).length,2);
  adapt(score,file);
  assert.equal(noteOns(file).length,1);
  assert.deepEqual(noteOffs(file),[[0,960,0,67]]);
  assert.equal(score.tracks[0].name,label);
  assert.deepEqual(heads(score),before); assert.deepEqual(bytes,original);
});

for (const [name,program] of [['Soprano',1],['Piano + Strings',49],['Keyboard reduction',49],['Keyboard solo',1]]) test(`keeps independent keys outside the bounded alias: ${name}/${program}`, () => {
  const score=load(fixture(name,program)), file=rawMidi(score), before=file.tracks.flatMap(t=>t.events).map(e=>JSON.stringify(e));
  adapt(score,file);
  assert.deepEqual(file.tracks.flatMap(t=>t.events).map(e=>JSON.stringify(e)),before);
});

for (const bank of [1,128]) test(`does not treat Keyboard reduction bank ${bank} as an acoustic piano`, () => {
  const score=load(fixture('Keyboard reduction')); score.tracks[0].playbackInfo.bank=bank;
  const file=rawMidi(score), before=noteOns(file); adapt(score,file); assert.deepEqual(noteOns(file),before);
});

test('the actual pre-synth MIDI hook plays one piano key once, preserving its longer voice and both source heads',()=>{
  const source=fixture(), input=new TextEncoder().encode(source), original=input.slice();
  const score=loadMusicXml(input,new at.Settings()), before=heads(score), file=rawMidi(score);
  assert.equal(noteOns(file).length,2,'baseline must reach the duplicate native MIDI pattern');
  adapt(score,file);
  assert.equal(noteOns(file).length,1);
  assert.deepEqual(noteOffs(file),[[0,960,0,67]]);
  assert.deepEqual(heads(score),before);
  assert.equal(before.length,2);
  assert.deepEqual(input,original);
});

for(const [name,program] of [['Voice',1],['Guitar',1],['Piano',41]]) test(`does not infer a physical acoustic piano for ${name} program${program}`,()=>{
  const score=load(fixture(name,program)), file=rawMidi(score), tracks=file.tracks;
  adapt(score,file); assert.equal(noteOns(file).length,2); assert.equal(file.tracks,tracks);
});

test('a later attack of the same piano key remains a separate attack',()=>{
  const score=load(fixture('Piano',1,true)), file=adapt(score,rawMidi(score));
  assert.deepEqual(noteOns(file).map(e=>e[1]),[0,480]);
  assert.deepEqual(noteOffs(file).map(e=>e[1]),[960,960]);
});

test('MIDI end-of-track remains after the final note-off',()=>{
  const score=load(fixture()), file=adapt(score,rawMidi(score));
  assert.ok(file.tracks[0].events.at(-1) instanceof at.midi.EndOfTrackEvent);
});

test('a bank automation before the shared onset prevents acoustic-piano merging',()=>{
  const score=load(fixture());
  const automation=new at.model.Automation(); automation.type=at.model.AutomationType.Bank; automation.value=1;
  score.tracks[0].staves[0].bars[0].voices[0].beats[0].automations.push(automation);
  const file=rawMidi(score), tracks=file.tracks;
  assert.ok(file.tracks[0].events.some(e=>e instanceof at.midi.ControlChangeEvent && e.controller===at.midi.ControllerType.BankSelectFine && e.value===1));
  adapt(score,file); assert.equal(noteOns(file).length,2); assert.equal(file.tracks,tracks);
});

test('a program automation before the shared onset prevents acoustic-piano merging',()=>{
  const score=load(fixture());
  const automation=new at.model.Automation(); automation.type=at.model.AutomationType.Instrument; automation.value=40;
  score.tracks[0].staves[0].bars[0].voices[0].beats[0].automations.push(automation);
  const file=rawMidi(score), tracks=file.tracks;
  adapt(score,file); assert.equal(noteOns(file).length,2); assert.equal(file.tracks,tracks);
});

test('distinct declared piano instruments in one part retain independent unison attacks',()=>{
  let source=fixture();
  source=source.replace('</score-part>', '<score-instrument id="I2"><instrument-name>Second Piano</instrument-name></score-instrument><midi-instrument id="I2"><midi-channel>1</midi-channel><midi-program>1</midi-program></midi-instrument></score-part>');
  source=source.replace('<duration>1</duration><voice>2</voice><type>eighth</type><stem>down</stem>', '<duration>1</duration><instrument id="I2"/><voice>2</voice><type>eighth</type><stem>down</stem>');
  const score=load(source), file=rawMidi(score);
  assert.equal(noteOns(file).length,2);
  adapt(score,file); assert.equal(noteOns(file).length,2);
});

test('independent piano tracks keep independent attacks even at the same key and tick',()=>{
  let source=fixture();
  const part=source.match(/<part id="P1">[\s\S]*?<\/part>/)[0].replaceAll('P1','P2');
  source=source.replace('</part-list>','<score-part id="P2"><part-name>Piano 2</part-name><score-instrument id="I2"><instrument-name>Piano</instrument-name></score-instrument><midi-instrument id="I2"><midi-channel>2</midi-channel><midi-program>1</midi-program></midi-instrument></score-part></part-list>').replace('</score-partwise>',part+'</score-partwise>');
  const score=load(source); assignPlaybackChannels(score.tracks);
  const file=adapt(score,rawMidi(score));
  assert.deepEqual(noteOns(file).map(e=>[e[0],e[1],e[2],e[3]]),[[0,0,0,67],[1,0,1,67]]);
});

test('different channels in the same piano track are not merged',()=>{
  const score=load(fixture());score.tracks[0].playbackInfo.secondaryChannel=1;
  score.tracks[0].staves[0].bars[0].voices[1].beats[0].vibrato=at.model.VibratoType.Slight;
  const file=rawMidi(score), before=noteOns(file);
  assert.deepEqual(before.map(e=>e[2]),[0,1]);
  adapt(score,file); assert.deepEqual(noteOns(file),before);
});

test('control, tempo, bends, rest and end events retain their native order and values',()=>{
  const score=load(fixture()), file=rawMidi(score);
  const controls=f=>f.tracks.flatMap(t=>t.events).filter(e=>!(e instanceof at.midi.NoteOnEvent || e instanceof at.midi.NoteOffEvent)).map(e=>JSON.stringify(e));
  const before=controls(file); adapt(score,file); assert.deepEqual(controls(file),before);
});

test('a shared key uses the stronger source attack and longer source hold',()=>{
  const score=load(fixture()), voices=score.tracks[0].staves[0].bars[0].voices;
  voices[0].beats[0].notes[0].dynamics=at.model.DynamicValue.P;
  voices[1].beats[0].notes[0].dynamics=at.model.DynamicValue.F;
  const file=rawMidi(score), strongest=Math.max(...noteOns(file).map(e=>e[4]));
  adapt(score,file); assert.equal(noteOns(file)[0][4],strongest); assert.deepEqual(noteOffs(file).map(e=>e[1]),[960]);
});

test('an initial grace note and native tick shift survive shared-key correction',()=>{
  const grace='<note><grace slash="yes"/><pitch><step>D</step><octave>4</octave></pitch><voice>1</voice><type>16th</type></note>';
  const source=fixture().replace(note(2,1),grace+note(2,1));
  const score=load(source), file=rawMidi(score), shift=file.tickShift;
  const graceBefore=noteOns(file).find(e=>e[3]===62);
  adapt(score,file); assert.equal(file.tickShift,shift); assert.deepEqual(noteOns(file).find(e=>e[3]===62),graceBefore); assert.equal(noteOns(file).filter(e=>e[3]===67).length,1);
});

test('a piano repair leaves every event of a concurrent vocal track, including pitch controls, unchanged',()=>{
  let source=fixture();
  const part=source.match(/<part id="P1">[\s\S]*?<\/part>/)[0].replaceAll('P1','P2');
  source=source.replace('</part-list>','<score-part id="P2"><part-name>Soprano</part-name><score-instrument id="I2"><instrument-name>Voice</instrument-name></score-instrument><midi-instrument id="I2"><midi-channel>2</midi-channel><midi-program>53</midi-program></midi-instrument></score-part></part-list>').replace('</score-partwise>',part+'</score-partwise>');
  const score=load(source); assignPlaybackChannels(score.tracks);
  score.tracks[1].staves[0].bars[0].voices[0].beats[0].notes[0].vibrato=at.model.VibratoType.Slight;
  const file=rawMidi(score), target=f=>f.tracks.flatMap(t=>t.events).filter(e=>e.track===1).map(e=>JSON.stringify(e));
  assert.ok(file.tracks[0].events.some(e=>e.track===1 && e.type===at.midi.MidiEventType.PerNotePitchBend));
  const before=target(file); adapt(score,file); assert.deepEqual(target(file),before);
  assert.equal(noteOns(file).filter(e=>e[0]===0).length,1); assert.equal(noteOns(file).filter(e=>e[0]===1).length,2);
});
