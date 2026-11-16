import assert from 'node:assert/strict';
import test from 'node:test';
import {zipSync,strToU8} from 'fflate';
import {readMusicXmlDocument,validateMusicXmlSource} from '../dist/format.js';
import {prepareMusicXmlDocumentForPlaybackBytes} from '../dist/musicxml-preparation.js';
import {isCompatibleMusicXmlPreparation} from '../dist/preparation-format.js';

// Independently authored synthetic controls; no third-party score material.
const score = (key=0,notes='<note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>') => `<score-partwise><part-list><score-part id="P"><part-name>Voice</part-name></score-part></part-list><part id="P"><measure number="1"><attributes><divisions>1</divisions><key><fifths>${key}</fifths></key><time><beats>1</beats><beat-type>4</beat-type></time></attributes>${notes}</measure></part></score-partwise>`;
const opus = (links='<score link:href="a.musicxml"/><score link:href="b.musicxml"/>') => `<opus version="4.0" xmlns:link="http://www.w3.org/1999/xlink"><title>Original controls</title>${links}</opus>`;
const archive = (links,files={})=>zipSync({'META-INF/container.xml':strToU8('<container><rootfiles><rootfile full-path="book/opus.xml"/></rootfiles></container>'),'book/opus.xml':strToU8(opus(links)),'book/a.musicxml':strToU8(score()),'book/b.musicxml':strToU8(score(2)),...files});

test('flat local Opus keeps scores independently prepared and leaves input intact',()=>{
 const bytes=archive(),before=bytes.slice(),prepared=prepareMusicXmlDocumentForPlaybackBytes(bytes);
 validateMusicXmlSource(bytes);assert.deepEqual(bytes,before);assert.equal(prepared.kind,'opus');assert.equal(isCompatibleMusicXmlPreparation(prepared),true);
 assert.deepEqual(prepared.scores.map(score=>score.measureLabels),[['1'],['1']]);
 assert.notDeepEqual(prepared.scores[0].bytes,prepared.scores[1].bytes);
 assert.equal(prepared.bytes.length,0,'the compiled document does not retain another archive copy');
});

test('Opus references cannot escape the archive, recurse, or bypass source validation and CRC',()=>{
 for(const links of ['<score link:href="https://example.invalid/a.musicxml"/>','<score link:href="../a.musicxml"/>','<score link:href="a.musicxml#part"/>','<score link:href="missing.musicxml"/>','<opus><title>Nested</title></opus>','<opus-link link:href="opus.xml"/>','<score link:href="opus.xml"/>']) assert.throws(()=>validateMusicXmlSource(archive(links)),links);
 assert.throws(()=>validateMusicXmlSource(archive(undefined,{'book/b.musicxml':strToU8('<score-partwise><broken>')})));
 const corrupt=archive();const view=new DataView(corrupt.buffer);let cursor=0,found=false;
 while(cursor+46<corrupt.length){if(view.getUint32(cursor,true)!==0x02014b50){cursor++;continue;}const length=view.getUint16(cursor+28,true);const name=new TextDecoder().decode(corrupt.subarray(cursor+46,cursor+46+length));if(name==='book/b.musicxml'){corrupt[cursor+16]^=1;found=true;break;}cursor+=46+length+view.getUint16(cursor+30,true)+view.getUint16(cursor+32,true);}
 assert.ok(found);assert.throws(()=>validateMusicXmlSource(corrupt),/校验/);
});

test('all referenced scores share the admission note budget',()=>{
 const notes='<note><rest/><duration>1</duration></note>'.repeat(50001),files={'book/a.musicxml':strToU8(score(0,notes)),'book/b.musicxml':strToU8(score(0,notes))};
 assert.throws(()=>readMusicXmlDocument(archive(undefined,files)),/100000/);
});
