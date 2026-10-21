import assert from 'node:assert/strict';
import { test } from 'node:test';
import { zipSync, strToU8 } from 'fflate';
import * as alphaTab from '@coderline/alphatab';
import { prepareMusicXmlSource, validateMusicXmlSource, MAX_MUSICXML_BYTES } from '@same-page/player/format';
import { loadMusicXml } from '@same-page/player/engine';
const xml = '<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Alto</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note></measure></part></score-partwise>';
const bytes = strToU8(xml);
const container = strToU8('<container><rootfiles><rootfile full-path="scores/main.musicxml"/></rootfiles></container>');
const archive = (extra={}) => zipSync({'META-INF/container.xml':container,'scores/main.musicxml':bytes,...extra});
test('XML/MXL follow one normalized path and produce equal score timing', () => {
 const mxl=archive({'ignored.xml':strToU8('<wrong/>')}); const original=mxl.slice();
 assert.deepEqual(prepareMusicXmlSource(mxl),bytes);assert.deepEqual(mxl,original);
 const summary = b => { const score=loadMusicXml(b,new alphaTab.Settings());return score.tracks.map(t=>t.staves.map(s=>s.bars.map(b=>b.voices.map(v=>v.beats.map(x=>[x.duration,x.notes.map(n=>n.realValue)]))))); };
 assert.deepEqual(summary(mxl),summary(bytes));
});
test('UTF16 becomes UTF8 without rewriting source', () => {
 const value=xml.replace('UTF-8','UTF-16'); const buffer=Buffer.concat([Buffer.from([255,254]),Buffer.from(value,'utf16le')]);
 assert.equal(new TextDecoder().decode(prepareMusicXmlSource(buffer)),xml);
});
test('rejects unsupported roots, entities, corrupt XML and incomplete ZIP', () => {
 for(const value of ['<score-timewise/>','<opus/>','<score-partwise><broken>','<!DOCTYPE score-partwise [<!ENTITY a "xxx">]>'+xml]) assert.throws(()=>prepareMusicXmlSource(strToU8(value)));
 assert.throws(()=>prepareMusicXmlSource(archive().slice(0,-22)));
 assert.throws(()=>prepareMusicXmlSource(archive({'../outside':bytes})));
});
test('enforces decoded size, selected entry size, file count and CRC', () => {
 assert.throws(()=>prepareMusicXmlSource(new Uint8Array(MAX_MUSICXML_BYTES+1)));
 assert.throws(()=>prepareMusicXmlSource(zipSync({'META-INF/container.xml':container,'scores/main.musicxml':new Uint8Array(MAX_MUSICXML_BYTES+1)})));
 const corrupt=archive(); const directory=corrupt.findIndex((_,i)=>corrupt[i]===0x50&&corrupt[i+1]===0x4b&&corrupt[i+2]===1&&corrupt[i+3]===2);corrupt[directory+16]^=1;
 assert.throws(()=>prepareMusicXmlSource(corrupt));
 assert.throws(()=>prepareMusicXmlSource(archive(Object.fromEntries(Array.from({length:257},(_,i)=>['extra'+i,new Uint8Array()])))));
});

test('server and player both reject UTF16 that expands beyond the normalized limit', () => {
 const value = xml.replace('UTF-8', 'UTF-16').replace('<part-list>', '<work><work-title>' + '谱'.repeat(7 * 1024 * 1024) + '</work-title></work><part-list>');
 const bytes = Buffer.concat([Buffer.from([255,254]), Buffer.from(value, 'utf16le')]);
 assert.ok(bytes.length < MAX_MUSICXML_BYTES);
 for (const validate of [validateMusicXmlSource, prepareMusicXmlSource]) assert.throws(() => validate(bytes), /20 MiB/);
});
