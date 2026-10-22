import assert from 'node:assert/strict';
import test from 'node:test';
import * as at from '@coderline/alphatab';
import {loadMusicXml,assignPlaybackChannels,preparePianoPlaybackMidi} from '../dist/engine.js';
// Owned short pitch-spelling fixture with an inherited accidental, not a published score.
const source="<?xml version='1.0' encoding='UTF-8'?>\n<score-partwise version=\"4.0\"><part-list><score-part id=\"P\"><part-name>Piano</part-name></score-part></part-list><part id=\"P\"><measure number=\"1\"><attributes><divisions>2</divisions><key><fifths>1</fifths></key><time><beats>3</beats><beat-type>4</beat-type></time><clef><sign>F</sign><line>4</line></clef></attributes><note><pitch><step>E</step><alter>-1</alter><octave>2</octave></pitch><duration>1</duration><voice>1</voice><type>eighth</type><accidental>flat</accidental></note><note><pitch><step>B</step><alter>-1</alter><octave>2</octave></pitch><duration>1</duration><voice>1</voice><type>eighth</type><accidental>flat</accidental></note><note><pitch><step>G</step><octave>3</octave></pitch><duration>1</duration><voice>1</voice><type>eighth</type></note><note><pitch><step>B</step><alter>-1</alter><octave>2</octave></pitch><duration>1</duration><voice>1</voice><type>eighth</type></note><note><pitch><step>B</step><alter>-1</alter><octave>3</octave></pitch><duration>2</duration><voice>1</voice><type>quarter</type><accidental>flat</accidental></note></measure></part></score-partwise>";
function capture(xml,layout){
 const settings=new at.Settings();settings.core.engine='svg';settings.core.enableLazyLoading=false;settings.display.staveProfile=at.StaveProfile.Score;settings.display.layoutMode=layout;
 const score=loadMusicXml(new TextEncoder().encode(xml),settings);assignPlaybackChannels(score.tracks);
 const copy=at.model.JsonConverter.jsonToScore(at.model.JsonConverter.scoreToJson(score));
 const r=new at.rendering.ScoreRenderer(settings);r.width=1200;const parts=[];r.error.on(e=>{throw e});r.partialRenderFinished.on(e=>{if(typeof e.renderResult==='string')parts.push(e.renderResult)});
 try{r.renderScore(copy,[0])}finally{r.destroy()}
 const file=new at.midi.MidiFile(),g=new at.midi.MidiFileGenerator(score,settings,new at.midi.AlphaSynthMidiFileHandler(file));g.applyTranspositionPitches=false;g.generate();preparePianoPlaybackMidi(score,file,settings);
 const svg=parts.join('').replace(/&#x([0-9a-f]+);/gi,(_,h)=>String.fromCodePoint(parseInt(h,16))).replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(+n));
 return {svg,keys:copy.tracks[0].staves[0].bars[0].voices[0].beats.map(b=>b.notes[0].realValue),events:JSON.parse(JSON.stringify(file.tracks.flatMap(t=>t.events))),ticks:g.tickLookup.masterBars.map(b=>[b.start,b.end])};
}
for(const layout of[at.LayoutMode.Page,at.LayoutMode.Horizontal])test(`source inherited B flat stays B flat through engine and Worker JSON (${at.LayoutMode[layout]})`,()=>{
 const got=capture(source,layout);assert.deepEqual(got.keys,[39,46,55,46,58]);
 assert.equal((got.svg.match(/\uE262/g)||[]).length,1,'Only key signature F sharp; no invented A sharp');
 assert.equal((got.svg.match(/\uE260/g)||[]).length,3,'Carried B flat must not draw another flat');
 const control=source.replace('<duration>1</duration><voice>1</voice><type>eighth</type></note><note><pitch><step>B</step><alter>-1</alter><octave>3','<duration>1</duration><voice>1</voice><type>eighth</type><accidental>flat</accidental></note><note><pitch><step>B</step><alter>-1</alter><octave>3');
 assert.notEqual(control,source);assert.deepEqual(capture(control,layout),got);
});
function imported(xml) { return loadMusicXml(new TextEncoder().encode(xml),new at.Settings()).tracks[0].staves[0].bars[0].voices[0].beats[0].notes[0]; }
test('unsupported alterations retain the previous fallback rather than inventing microtonal spelling',()=>{
 for(const alter of ['0.5','-0.5','3','-3']) {
  const xml=source.replace('<alter>-1</alter>','<alter>'+alter+'</alter>').replace('<accidental>flat</accidental>','');
  assert.equal(imported(xml).accidentalMode,at.model.NoteAccidentalMode.Default);
 }
});
test('an explicit accidental retains its existing override of pitch-selected spelling',()=>{
 const xml=source.replace('<accidental>flat</accidental>','<accidental>double-sharp</accidental>');
 const note=imported(xml);assert.equal(note.realValue,39);assert.equal(note.accidentalMode,at.model.NoteAccidentalMode.ForceDoubleSharp);
});
for(const layout of[at.LayoutMode.Page,at.LayoutMode.Horizontal])test(`key-signature accidentals remain suppressed (${at.LayoutMode[layout]})`,()=>{
 const xml=source.replace(/<step>[BEG]<\/step>/g,'<step>F</step>').replaceAll('<alter>-1</alter>','<alter>1</alter>').replaceAll('<accidental>flat</accidental>','').replace('<step>F</step><octave>3</octave>','<step>F</step><alter>1</alter><octave>3</octave>');
 const got=capture(xml,layout);assert.equal((got.svg.match(/\uE262/g)||[]).length,1);assert.equal((got.svg.match(/\uE260/g)||[]).length,0);
});
