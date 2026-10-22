import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as alphaTab from '@coderline/alphatab';
import { loadMusicXml } from '../src/engine.ts';

const note = '<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>';
const attributes = '<attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>';
const part = (id, endings) => `<part id="${id}">
<measure number="1">${attributes}<barline location="left"><repeat direction="forward"/></barline>${note}</measure>
<measure number="2">${endings ? '<barline location="left"><ending number="1" type="start"/></barline>' : ''}${note}<barline location="right">${endings ? '<ending number="1" type="stop"/>' : ''}<repeat direction="backward"/></barline></measure>
<measure number="3">${endings ? '<barline location="left"><ending number="2" type="start"/></barline>' : ''}${note}${endings ? '<barline location="right"><ending number="2" type="discontinue"/></barline>' : ''}</measure></part>`;
const xml = (a, b) => `<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>S</part-name></score-part><score-part id="P2"><part-name>A</part-name></score-part></part-list>${part('P1', a)}${part('P2', b)}</score-partwise>`;
const route = score => {
  const handler = new Proxy({}, {get:()=>()=>{}});
  const generator = new alphaTab.midi.MidiFileGenerator(score, new alphaTab.Settings(), handler);
  generator.generate();
  return generator.tickLookup.masterBars.map(b=>b.masterBar.index+1);
};

for (const [name, a, b] of [['first part only',true,false],['last part only',false,true],['all parts',true,true]]) {
 test(`volta in ${name} skips first ending on second pass`,()=> {
   const bytes = new TextEncoder().encode(xml(a,b));
   const original = bytes.slice();
   const score=loadMusicXml(bytes,new alphaTab.Settings());
   assert.deepEqual(route(score),[1,2,1,3]);
   assert.deepEqual(bytes,original);
 });
}
test('ordinary repeat without alternate endings still plays both complete passes',()=> {
 assert.deepEqual(route(loadMusicXml(new TextEncoder().encode(xml(false,false)),new alphaTab.Settings())),[1,2,1,2,3]);
});

test('a first ending spanning two measures inherits its bracket on both passes',()=> {
 const makePart=(id,markers)=>`<part id="${id}">
 <measure number="1">${attributes}<barline location="left"><repeat direction="forward"/></barline>${note}</measure>
 <measure number="2">${markers?'<barline location="left"><ending number="1" type="start"/></barline>':''}${note}</measure>
 <measure number="3">${note}<barline location="right">${markers?'<ending number="1" type="stop"/>':''}<repeat direction="backward"/></barline></measure>
 <measure number="4">${markers?'<barline location="left"><ending number="2" type="start"/></barline>':''}${note}${markers?'<barline location="right"><ending number="2" type="discontinue"/></barline>':''}</measure></part>`;
 const document=xml(false,false).replace(/<part id="P1">[\s\S]*<\/part><\/score-partwise>/,makePart('P1',true)+makePart('P2',false)+'</score-partwise>');
 assert.deepEqual(route(loadMusicXml(new TextEncoder().encode(document),new alphaTab.Settings())),[1,2,3,1,4]);
});
