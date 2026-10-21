import assert from 'node:assert/strict';
import test from 'node:test';
import {prepareMusicXmlForAlphaTabBytes} from '../src/musicxml-direction-timing.ts';
const wrap=direction=>`<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>2</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>${direction}<note><pitch><step>C</step><octave>5</octave></pitch><duration>8</duration><type>whole</type></note></measure></part></score-partwise>`;
const direction=(placement='',inner='')=>`<direction${placement}><direction-type><dynamics${inner}><pp/></dynamics></direction-type><offset>6</offset><staff>1</staff></direction>`;
const events=x=>prepareMusicXmlForAlphaTabBytes(new TextEncoder().encode(x)).dynamicEventsByPart[0];
test('source direction placement survives prepared and Worker metadata with exact independent time',()=>{
 for(const placement of ['above','below']){const e=events(wrap(direction(` placement="${placement}"`)));assert.equal(e[0].placement,placement);assert.equal(e[0].quarter,3);assert.equal(structuredClone(e)[0].placement,placement);}
});
test('omitted direction placement retains the legacy metadata shape and below default',()=>{
 assert.equal(Object.hasOwn(events(wrap(direction()))[0],'placement'),false);
});
test('direction placement wins over dynamics placement reserved for note-associated dynamics',()=>{
 assert.equal(events(wrap(direction(' placement="above"',' placement="below"')))[0].placement,'above');
 assert.equal(Object.hasOwn(events(wrap(direction('',' placement="above"')))[0],'placement'),false);
});
import * as at from '@coderline/alphatab';
import {loadMusicXml,loadPreparedMusicXml,assignPlaybackChannels,preparePianoPlaybackMidi} from '../src/engine.ts';
const piano=`<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>2</divisions><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>${direction(' placement="above"')}${direction(' placement="below"').replace('<pp/>','<mp/>').replace('<offset>6</offset>','<offset>7</offset>')}<note><pitch><step>C</step><octave>5</octave></pitch><duration>8</duration><voice>1</voice><type>whole</type><staff>1</staff></note><backup><duration>8</duration></backup><note><pitch><step>C</step><octave>3</octave></pitch><duration>6</duration><voice>2</voice><type>half</type><dot/><staff>2</staff></note><note><pitch><step>D</step><octave>3</octave></pitch><duration>1</duration><voice>2</voice><type>eighth</type><staff>2</staff></note><note><pitch><step>E</step><octave>3</octave></pitch><duration>1</duration><voice>2</voice><type>eighth</type><staff>2</staff></note></measure></part></score-partwise>`;
function render(score){const settings=new at.Settings();settings.core.engine='svg';settings.core.enableLazyLoading=false;settings.display.staveProfile=at.StaveProfile.Score;const renderer=new at.rendering.ScoreRenderer(settings),svg=[];renderer.width=1000;renderer.error.on(error=>{throw error});renderer.partialRenderFinished.on(event=>{if(typeof event.renderResult==='string')svg.push(event.renderResult)});renderer.renderScore(score,[0]);renderer.destroy();return svg.join('');}
function midi(score){assignPlaybackChannels(score.tracks);const settings=new at.Settings(),file=new at.midi.MidiFile(),g=new at.midi.MidiFileGenerator(score,settings,new at.midi.AlphaSynthMidiFileHandler(file));g.applyTranspositionPitches=false;g.generate();preparePianoPlaybackMidi(score,file,settings);return{events:file.tracks.flatMap(t=>t.events).map(e=>JSON.parse(JSON.stringify(e))),ticks:g.tickLookup.masterBars.map(b=>[b.start,b.end])};}
const load=xml=>loadMusicXml(new TextEncoder().encode(xml),new at.Settings());
test('actual native source PP is above RH and MP below RH at independent times; Worker and MIDI remain exact',()=>{
 const score=load(piano),rh=score.tracks[0].staves[0].bars[0];
 assert.deepEqual(rh.sourceDynamics.map(d=>[d.displayStart,d.value,d.placement]),[[2880,at.model.DynamicValue.PP,at.model.SourceDynamicPlacement.Above],[3360,at.model.DynamicValue.MP,at.model.SourceDynamicPlacement.Below]]);
 assert.equal(rh.voices.flatMap(v=>v.beats).some(b=>b.playbackStart===3360),false);
 const copy=at.model.JsonConverter.jsObjectToScore(at.model.JsonConverter.scoreToJsObject(score));assert.deepEqual(copy.tracks[0].staves[0].bars[0].sourceDynamics,rh.sourceDynamics);
 const svg=render(score),lines=[...new Set([...svg.matchAll(/<rect x="[^"]+" y="([^"]+)" width="([^"]+)" height="([^"]+)"/g)].filter(m=>+m[2]>50&&+m[3]>1&&+m[3]<2).map(m=>+m[1]))].sort((a,b)=>a-b);
 const y=symbol=>{const found=[...svg.matchAll(new RegExp(`<g transform="translate\\([^ ]+ ([^)]+)\\)"[^>]*><text[^>]*>&#${symbol};<\\/text>`,'g'))];assert.equal(found.length,1);return +found[0][1]};
 assert.equal(lines.length,10);assert.ok(y(at.model.MusicFontSymbol.DynamicPP)<lines[0]);assert.ok(y(at.model.MusicFontSymbol.DynamicMP)>lines[4]);assert.ok(y(at.model.MusicFontSymbol.DynamicMP)<lines[5]);
 assert.deepEqual(midi(score),midi(load(piano.replace('placement="above"','placement="below"'))));
});
test('old prepared metadata without placement retains below glyph output',()=>{
 const bytes=new TextEncoder().encode(piano.replace('placement="above"','placement="below"')),prepared=prepareMusicXmlForAlphaTabBytes(bytes),old=structuredClone(prepared);
 for(const part of old.dynamicEventsByPart)for(const event of part)delete event.placement;
 assert.equal(render(loadPreparedMusicXml(old,new at.Settings())),render(loadPreparedMusicXml(prepared,new at.Settings())));
});
