import assert from 'node:assert/strict';
import test from 'node:test';
import * as at from '@coderline/alphatab';
import { loadMusicXml, loadPreparedMusicXml } from '../src/engine.ts';
import { prepareMusicXmlForAlphaTabBytes } from '../src/musicxml-direction-timing.ts';
const title = 'Owned duplicate title';
const xml = movement => new TextEncoder().encode(`<score-partwise version="4.0"><work><work-title>${title}</work-title></work><movement-title>${movement}</movement-title><part-list><score-part id="P"><part-name>Voice</part-name></score-part></part-list><part id="P"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note></measure></part></score-partwise>`);
function render(score) {
 const settings = new at.Settings(); settings.core.engine = 'svg'; settings.core.enableLazyLoading = false;
 const renderer = new at.rendering.ScoreRenderer(settings), pieces = []; renderer.width = 1000;
 renderer.partialRenderFinished.on(event => { if (typeof event.renderResult === 'string') pieces.push(event.renderResult); });
 renderer.error.on(error => { throw error; });
 try { renderer.renderScore(score, [0]); return pieces.join('').replaceAll('\u00a0',' ').replaceAll('&nbsp;',' '); } finally { renderer.destroy(); }
}
function variants(bytes) {return [loadMusicXml(bytes,new at.Settings()),loadPreparedMusicXml(structuredClone(prepareMusicXmlForAlphaTabBytes(bytes)),new at.Settings())];}
test('actual renderer prints an identical MusicXML work/movement title once without changing source attachment bytes',()=>{
 const bytes=xml(title), original=bytes.slice();
 for(const score of variants(bytes)) assert.equal(render(score).split(`>${title}</text>`).length-1,1);
 assert.deepEqual(bytes,original);
});
test('actual renderer retains a distinct movement title alongside the work title',()=>{
 for(const score of variants(xml('Second movement'))) {const svg=render(score);assert.equal(svg.split(`>${title}</text>`).length-1,1);assert.equal(svg.split('>Second movement</text>').length-1,1);}
});

test('duplicate title display cleanup leaves all prepared source metadata intact',()=>{
 const prepared=prepareMusicXmlForAlphaTabBytes(xml(title)), original=structuredClone(prepared);
 assert.equal(render(loadPreparedMusicXml(prepared,new at.Settings())).split(`>${title}</text>`).length-1,1);
 assert.deepEqual(prepared,original);
});
test('title-only, movement-only and distinct case-sensitive headings are retained',()=>{
 const decode=b=>new TextDecoder().decode(b),encode=s=>new TextEncoder().encode(s);
 for(const bytes of [encode(decode(xml(title)).replace(`<movement-title>${title}</movement-title>`,'')),encode(decode(xml(title)).replace(`<work><work-title>${title}</work-title></work>`,''))])for(const score of variants(bytes))assert.equal(render(score).split(`>${title}</text>`).length-1,1);
 const different='owned duplicate title';for(const score of variants(xml(different))){const svg=render(score);assert.equal(svg.split(`>${title}</text>`).length-1,1);assert.equal(svg.split(`>${different}</text>`).length-1,1);}
});
