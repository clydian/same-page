import assert from 'node:assert/strict';
import test from 'node:test';
import * as at from '@coderline/alphatab';
import { loadMusicXml, assignPlaybackChannels, preparePianoPlaybackMidi } from '../src/engine.ts';
import { applyTimbreProfile, classifyTimbreRoles } from '../src/timbre-profile.ts';
import { PartTimbres } from '../src/part-timbre.ts';

const xml = `<score-partwise version="4.0"><part-list>${['Piano', 'Soprano'].map((name,i)=>`<score-part id="P${i}"><part-name>${name}</part-name><midi-instrument id="I${i}"><midi-channel>1</midi-channel><midi-program>1</midi-program></midi-instrument></score-part>`).join('')}</part-list>${[0,1].map(i=>`<part id="P${i}"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves><clef><sign>G</sign><line>2</line></clef></attributes><note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration><voice>1</voice><type>whole</type><staff>1</staff></note><backup><duration>4</duration></backup><note><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration><voice>2</voice><type>whole</type><staff>2</staff></note></measure></part>`).join('')}</score-partwise>`;
const dump = file => file.tracks.flatMap(t=>t.events).map(e=>JSON.stringify(e));
function piece() {
  const bytes = new TextEncoder().encode(xml), original = bytes.slice(), settings = new at.Settings();
  const score = loadMusicXml(bytes, settings); assignPlaybackChannels(score.tracks);
  applyTimbreProfile(score.tracks, 'choir', classifyTimbreRoles(score.tracks, []));
  // A later source instrument/bank change must be suppressed only while overridden.
  for (const [type,value] of [[at.model.AutomationType.Instrument,4],[at.model.AutomationType.Bank,1]]) {
    const automation = new at.model.Automation(); automation.type=type; automation.value=value;
    score.tracks[0].staves[0].bars[0].voices[0].beats[0].automations.push(automation);
  }
  const model = JSON.stringify(at.model.JsonConverter.scoreToJsObject(score));
  const file = new at.midi.MidiFile(), generator = new at.midi.MidiFileGenerator(score,settings,new at.midi.AlphaSynthMidiFileHandler(file));
  generator.applyTranspositionPitches=false; generator.generate(); preparePianoPlaybackMidi(score,file,settings);
  return {score,file,bytes,original,model};
}

test('one part changes across its staves, another part/piece stays exact, and score restores all prepared MIDI and automation',()=>{
  const first=piece(), second=piece(), baseline=dump(first.file), otherPiece=dump(second.file);
  assert.deepEqual(first.score.tracks.map(t=>t.staves.length),[2,2]);
  const choices=new PartTimbres(first.score), otherChoices=new PartTimbres(second.score);
  assert.equal(choices.get(0),'score'); assert.equal(first.score.tracks[1].playbackInfo.program,52);
  for(const [choice,program] of [['aahs',52],['oohs',53],['piano',0]]) {
    choices.set(0,choice); choices.apply(first.file);
    const events=first.file.tracks.flatMap(t=>t.events);
    const programs=events.filter(e=>e instanceof at.midi.ProgramChangeEvent && e.channel===0);
    assert.ok(programs.length>=2); assert.ok(programs.every(e=>e.program===program));
    assert.ok(events.filter(e=>e instanceof at.midi.ControlChangeEvent && e.channel===0 && [0,32].includes(e.controller)).every(e=>e.value===0));
    assert.deepEqual(events.filter(e=>e.channel!==0).map(e=>JSON.stringify(e)),baseline.filter(e=>JSON.parse(e).channel!==0));
    assert.deepEqual(events.filter(e=>e instanceof at.midi.NoteOnEvent).map(e=>e.track),[0,0,1,1]);
    otherChoices.apply(second.file); assert.deepEqual(dump(second.file),otherPiece); assert.equal(otherChoices.get(0),'score');
  }
  choices.set(0,'score'); choices.apply(first.file); assert.deepEqual(dump(first.file),baseline);
  assert.equal(JSON.stringify(at.model.JsonConverter.scoreToJsObject(first.score)),first.model);
  assert.deepEqual(first.bytes,first.original);
});
