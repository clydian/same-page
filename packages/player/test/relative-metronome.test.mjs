import assert from 'node:assert/strict';
import test from 'node:test';
import * as at from '@coderline/alphatab';
import {loadMusicXml} from '../src/engine.ts';
import {prepareMusicXmlForAlphaTabBytes} from '../src/musicxml-direction-timing.ts';
import {readMusicXmlTempoMeasures} from '../src/musicxml-metronome.ts';
const note='<note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>';
const relation='<direction><direction-type><metronome><beat-unit>half</beat-unit><beat-unit-dot/><beat-unit>whole</beat-unit></metronome></direction-type></direction>';
export function fixture(before='') {return `<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Voice</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>${before}${note.repeat(4)}</measure><measure number="2">${relation}${note.repeat(4)}</measure></part></score-partwise>`;}
function tempos(xml){const out=[],s=loadMusicXml(new TextEncoder().encode(xml),new at.Settings());const h=new Proxy({addTempo:(tick,bpm)=>out.push([tick,bpm])},{get:(t,k)=>t[k]??(()=>{})});new at.midi.MidiFileGenerator(s,new at.Settings(),h).generate();return out;}
test('source dotted-half equals whole changes existing default120 to160 without inventing source BPM',()=>{
 const xml=fixture();assert.deepEqual(tempos(xml),[[0,120],[3840,160]]);assert.equal(readMusicXmlTempoMeasures(new TextEncoder().encode(xml))[1].complete,true);
});
test('relative beat-unit equality scales the preceding source tempo, not fixed120',()=>{
 const xml=fixture('<direction><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>90</per-minute></metronome></direction-type></direction>');assert.deepEqual(tempos(xml),[[0,90],[3840,120]]);
});
const absolute = n => `<direction><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${n}</per-minute></metronome></direction-type></direction>`;
const equality = (left, right) => `<direction><direction-type><metronome>${left}${right}</metronome></direction-type></direction>`;
const unit = (name, dots=0) => `<beat-unit>${name}</beat-unit>${'<beat-unit-dot/>'.repeat(dots)}`;
function duplicatePart(xml, transform = value => value) {
 const part=xml.match(/<part id="P1">[\s\S]*?<\/part>/)[0];
 return xml.replace('</part-list>','<score-part id="P2"><part-name>Second</part-name></score-part></part-list>').replace('</score-partwise>',transform(part.replace('id="P1"','id="P2"'))+'</score-partwise>');
}
function appendBar(xml,content){return xml.replace('</part></score-partwise>',`<measure number="3">${content}${note.repeat(4)}</measure></part></score-partwise>`);}
test('repeated part copies apply one relative ratio globally',()=>{
 assert.deepEqual(tempos(duplicatePart(fixture(absolute(90)))),[[0,90],[3840,120]]);
});
test('source events in a later XML part establish earlier global tempo before first-part relation',()=>{
 const xml=duplicatePart(fixture(),part=>part.replace('</attributes>','</attributes>'+absolute(75)).replace(relation,''));
 assert.deepEqual(tempos(xml),[[0,75],[3840,100]]);
});
test('same-tick explicit sound in earlier part outranks later-part relative and absolute metronomes',()=>{
 const xml=duplicatePart(fixture().replace(relation,relation.replace('</direction>','<sound tempo="72"/></direction>')),part=>part.replace('<sound tempo="72"/>','').replace(relation,absolute(200)+relation));
 assert.deepEqual(tempos(xml),[[0,120],[3840,72]]);
});
test('same-direction explicit sound overrides relative equality',()=>{
 assert.deepEqual(tempos(fixture().replace(relation,relation.replace('</direction>','<sound tempo="72"/></direction>'))),[[0,120],[3840,72]]);
});
test('dotted unit on each side is parsed in its own group',()=>{
 assert.deepEqual(tempos(fixture().replace(relation,equality(unit('quarter',1),unit('quarter',2)))),[[0,120],[3840,140]]);
});
test('reverse equality slows rather than multiplying the inverse ratio',()=>{
 assert.deepEqual(tempos(fixture().replace(relation,equality(unit('whole'),unit('half',1)))),[[0,120],[3840,90]]);
});
test('relative/absolute chain resolves each onset in score time',()=>{
 const xml=appendBar(fixture(absolute(90)),absolute(60)+note+relation);
 assert.deepEqual(tempos(xml),[[0,90],[3840,120],[7680,60],[8640,80]]);
});
test('fractional divisions offset places relative change at actual MIDI onset',()=>{
 const xml=fixture(absolute(90)).replace(relation,relation.replace('</direction-type>','</direction-type><offset>0.5</offset>'));
 assert.deepEqual(tempos(xml),[[0,90],[4320,120]]);
});
test('relative numeric playback value is hidden instead of inventing printed160',()=>{
 const bytes=new TextEncoder().encode(fixture()),copy=bytes.slice();const score=loadMusicXml(bytes,new at.Settings());
 assert.equal(score.masterBars[1].tempoAutomations[0].value,160);assert.equal(score.masterBars[1].tempoAutomations[0].isVisible,false);assert.deepEqual(bytes,copy);
});
test('conflicting simultaneous ratios explicitly fall back instead of compounding or choosing a part',()=>{
 const xml=duplicatePart(fixture(),part=>part.replace(relation,equality(unit('whole'),unit('half',1))));
 assert.equal(readMusicXmlTempoMeasures(new TextEncoder().encode(xml))[1].complete,false);
});
test('unsupported intervening range leaves relative carry unknown until a new absolute tempo',()=>{
 const unsupported=absolute('ca.60');
 const xml=appendBar(fixture(unsupported),absolute(90)+note+relation);
 const measures=readMusicXmlTempoMeasures(new TextEncoder().encode(xml));
 assert.equal(measures[0].complete,false);assert.equal(measures[1].complete,false);assert.equal(measures[2].complete,true);assert.deepEqual(measures[2].events.map(e=>e.bpm),[90,120]);
});
for(const invalid of [equality('<beat-unit-dot/>'+unit('quarter'),unit('half')),equality(unit('quarter'),unit('half')+'<beat-unit-tied>'+unit('eighth')+'</beat-unit-tied>'),'<metronome><metronome-note/><metronome-relation>equals</metronome-relation><metronome-note/></metronome>'])test('unsupported relative grammar remains an explicit native fallback: '+invalid,()=>{
 const xml=fixture().replace(relation,invalid.startsWith('<metronome>')?`<direction><direction-type>${invalid}</direction-type></direction>`:invalid);
 assert.equal(readMusicXmlTempoMeasures(new TextEncoder().encode(xml))[1].complete,false);
});
test('unsupported measure retains supported native absolutes and unknown carry keeps following relation native',()=>{
 const bad='<direction><direction-type><metronome><metronome-note/><metronome-relation>equals</metronome-relation><metronome-note/></metronome></direction-type></direction>';
 const xml=fixture(absolute(90)+note+bad+absolute(100)).replace(note.repeat(4)+'</measure>',note.repeat(3)+'</measure>');
 const input=new TextEncoder().encode(xml),measures=readMusicXmlTempoMeasures(input);
 assert.equal(measures[0].complete,false);assert.equal(measures[1].complete,false);
 const prepared=prepareMusicXmlForAlphaTabBytes(input);
 const native=at.importer.ScoreLoader.loadScoreFromBytes(prepared.bytes,new at.Settings());
 const out=[],h=new Proxy({addTempo:(tick,bpm)=>out.push([tick,bpm])},{get:(t,k)=>t[k]??(()=>{})});new at.midi.MidiFileGenerator(native,new at.Settings(),h).generate();
 assert.deepEqual(tempos(xml),out,'completefalse must keep both native90/100 automations, not erase them or use default120 for nextrelative');
 assert.deepEqual(out,[[0,90],[960,100]]);
});

test('explicit sound90 never masquerades as source printedquarter56 in actual native SVG',()=>{
 const xml=fixture(absolute(56).replace('</direction>','<sound tempo="90"/></direction>')).replace(relation,'');
 const settings=new at.Settings();settings.core.engine='svg';settings.core.enableLazyLoading=false;settings.display.staveProfile=at.StaveProfile.Score;
 const score=loadMusicXml(new TextEncoder().encode(xml),settings),renderer=new at.rendering.ScoreRenderer(settings),pieces=[];
 renderer.width=1000;renderer.partialRenderFinished.on(e=>{if(typeof e.renderResult==='string')pieces.push(e.renderResult)});renderer.renderScore(score,[0]);renderer.destroy();
 assert.deepEqual(tempos(xml),[[0,90]]);assert.equal(score.masterBars[0].tempoAutomations[0].isVisible,false);
 assert.ok(pieces.length>0);assert.ok(!pieces.join('\n').includes(' = 90'),'playback90 must not be printed as source56');
 assert.ok(!pieces.join('\n').includes(' = 56'),'bounded fix hides conflicting numeric automation; independent originalmark display is explicitly unfinished');
});
