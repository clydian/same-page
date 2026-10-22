import assert from 'node:assert/strict';
import test from 'node:test';
import * as at from '@coderline/alphatab';
import {loadMusicXml} from '../src/engine.ts';
const f='<direction><direction-type><dynamics><f/></dynamics></direction-type><staff>1</staff></direction>';
const upper='<note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration><voice>1</voice><type>whole</type><staff>1</staff></note>';
const lower='<note><pitch><step>C</step><octave>3</octave></pitch><duration>4</duration><voice>2</voice><type>whole</type><staff>2</staff></note>';
export const xml=`<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>${f}${upper}<backup><duration>4</duration></backup>${lower}</measure><measure number="2">${upper}<backup><duration>4</duration></backup><note><rest/><duration>1</duration><voice>3</voice><type>quarter</type><staff>1</staff></note><note><pitch><step>E</step><octave>4</octave></pitch><duration>3</duration><voice>3</voice><type>half</type><dot/><staff>1</staff></note><backup><duration>4</duration></backup>${lower}</measure></part></score-partwise>`;
function render(score){const settings=new at.Settings();settings.core.engine='svg';settings.core.enableLazyLoading=false;settings.display.staveProfile=at.StaveProfile.Score;const renderer=new at.rendering.ScoreRenderer(settings),pieces=[];renderer.width=1000;renderer.partialRenderFinished.on(e=>{if(typeof e.renderResult==='string')pieces.push(e.renderResult)});renderer.error.on(e=>{throw e});renderer.renderScore(score,[0]);renderer.destroy();return pieces.join('\n');}
function forteCount(svg){return svg.split(`&#${at.model.MusicFontSymbol.DynamicForte};`).length-1;}
test('actual native SVG prints source forte once, not again when a secondary voice enters later',()=>{
 const bytes=new TextEncoder().encode(xml),original=bytes.slice(),score=loadMusicXml(bytes,new at.Settings());
 assert.equal(forteCount(render(score)),1,'one source direction must not become extra inherited forte glyph');assert.deepEqual(bytes,original);
});
import {loadPreparedMusicXml,assignPlaybackChannels,preparePianoPlaybackMidi} from '../src/engine.ts';
import {prepareMusicXmlForAlphaTabBytes} from '../src/musicxml-direction-timing.ts';
function pair(text){const prepared=prepareMusicXmlForAlphaTabBytes(new TextEncoder().encode(text)),legacy={...prepared};delete legacy.dynamicGlyphsCompleteByPart;return{prepared,current:loadPreparedMusicXml(prepared,new at.Settings()),legacy:loadPreparedMusicXml(legacy,new at.Settings())};}
function midi(score){assignPlaybackChannels(score.tracks);const settings=new at.Settings(),file=new at.midi.MidiFile(),g=new at.midi.MidiFileGenerator(score,settings,new at.midi.AlphaSynthMidiFileHandler(file));g.applyTranspositionPitches=false;g.generate();preparePianoPlaybackMidi(score,file,settings);return{events:file.tracks.flatMap(t=>t.events).map(e=>JSON.stringify(e)),ticks:g.tickLookup.masterBars.map(b=>[b.masterBar.index,b.start,b.end])};}
function markers(score){return score.tracks.flatMap(t=>t.staves.flatMap(s=>s.bars.flatMap(b=>b.voices.flatMap(v=>v.beats.map(n=>n.dynamics)))));}
test('source glyph cleanup preserves every actual MIDI field and tick against legacy016 marker path',()=>{
 const {current,legacy}=pair(xml);assert.deepEqual(midi(current),midi(legacy));assert.equal(forteCount(render(current)),1);assert.equal(forteCount(render(legacy)),2);
});
test('staff2 source glyph stays on staff2 while piano playback remains part-wide',()=>{
 const {current,legacy}=pair(xml.replace(f,f.replace('<staff>1</staff>','<staff>2</staff>')));
 assert.deepEqual(midi(current),midi(legacy));assert.equal(forteCount(render(current)),1);
 assert.equal(current.tracks[0].staves[0].bars[0].voices[0].beats[0].dynamics,-1);
 assert.equal(current.tracks[0].staves[1].bars[0].voices[1].beats[0].dynamics,at.model.DynamicValue.F);
});
test('source voice scope maps one explicit new glyph to its actual secondary-voice onset',()=>{
 const p='<direction><direction-type><dynamics><p/></dynamics></direction-type><offset>1</offset><voice>3</voice><staff>1</staff></direction>';
 const {current,legacy}=pair(xml.replace('<measure number="2">','<measure number="2">'+p));
 assert.deepEqual(midi(current),midi(legacy));assert.equal(forteCount(render(current)),1);
 const pianoGlyph=`&#${at.model.MusicFontSymbol.DynamicPiano};`;assert.equal(render(current).split(pianoGlyph).length-1,1);
});
for(const [name,change]of[
 ['nonnumeric source voice',v=>v.replace(f,f.replace('</direction-type>','</direction-type><voice>Upper</voice>'))],
 ['multiple symbols in one dynamics',v=>v.replace('<dynamics><f/></dynamics>','<dynamics><f/><p/></dynamics>')],
 ['multiple dynamics in one direction',v=>v.replace('<direction-type><dynamics><f/></dynamics></direction-type>','<direction-type><dynamics><f/></dynamics><dynamics><p/></dynamics></direction-type>')],
 ['same-onset conflicting source declarations',v=>v.replace(f,f+f.replace('<f/>','<p/>'))],
])test(`unsupported glyph mapping retains whole previous track marker path: ${name}`,()=>{
 const {current,legacy}=pair(change(xml));assert.deepEqual(markers(current),markers(legacy));assert.deepEqual(midi(current),midi(legacy));
});
test('native explicit notation retains repeated identical source declarations without changing MIDI',()=>{
 const {current,legacy}=pair(xml.replace('<measure number="2">','<measure number="2">'+f));
 assert.equal(forteCount(render(current)),2);
 assert.deepEqual(midi(current),midi(legacy));
 assert.equal(current.tracks[0].staves[0].bars[0].voices[0].beats[0].isDynamicsExplicit,true);
});
const restSource=`<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Voice</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><note><pitch><step>C</step><octave>5</octave></pitch><duration>1</duration><type>quarter</type></note><direction><direction-type><dynamics><pp/></dynamics></direction-type></direction><note><rest/><duration>1</duration><type>quarter</type></note><note><pitch><step>D</step><octave>5</octave></pitch><duration>2</duration><type>half</type></note></measure></part></score-partwise>`;
test('exact source rest anchor prints PP there and does not move it to a later note',()=>{
 const {current,legacy}=pair(restSource),beats=current.tracks[0].staves[0].bars[0].voices[0].beats;
 assert.equal(beats[1].isRest,true);assert.equal(beats[1].isDynamicsExplicit,true);
 assert.equal(beats[1].dynamics,at.model.DynamicValue.PP);
 assert.equal(beats[2].isDynamicsExplicit,false);assert.equal(beats[2].dynamics,-1);
 assert.equal(render(current).split(`&#${at.model.MusicFontSymbol.DynamicPP};`).length-1,1);
 assert.deepEqual(midi(current),midi(legacy));
});
test('whole-bar rest source declaration remains visible with no invented sounding notes',()=>{
 const entire=restSource.replace(/<note>[\s\S]*<\/note>/,'<direction><direction-type><dynamics><pp/></dynamics></direction-type></direction><note><rest measure="yes"/><duration>4</duration><type>whole</type></note>');
 const {current,legacy}=pair(entire),beats=current.tracks[0].staves[0].bars[0].voices[0].beats;
 assert.equal(beats.length,1);assert.equal(beats[0].notes.length,0);assert.equal(beats[0].isDynamicsExplicit,true);
 assert.equal(render(current).split(`&#${at.model.MusicFontSymbol.DynamicPP};`).length-1,1);
 assert.deepEqual(midi(current),midi(legacy));
});
test('plain completeness metadata survives structured clone; old prepared payload retains its previous markers',()=>{
 const input=new TextEncoder().encode(xml),copy=input.slice(),prepared=prepareMusicXmlForAlphaTabBytes(input);
 assert.deepEqual(prepared.dynamicGlyphsCompleteByPart,[true]);assert.deepEqual(structuredClone(prepared).dynamicGlyphsCompleteByPart,[true]);
 assert.deepEqual(input,copy);const legacy={...prepared};delete legacy.dynamicGlyphsCompleteByPart;
 assert.equal(forteCount(render(loadPreparedMusicXml(legacy,new at.Settings()))),2);
});

test('hidden source dynamics hint keeps the entire legacy glyph path instead of restoring a visible source sign',()=>{
 const {prepared,current,legacy}=pair(xml.replace('<dynamics>','<dynamics print-object="no">'));
 assert.deepEqual(prepared.dynamicGlyphsCompleteByPart,[false]);
 assert.deepEqual(markers(current),markers(legacy));assert.deepEqual(midi(current),midi(legacy));
 assert.equal(forteCount(render(current)),forteCount(render(legacy)));
});

// The source piano starts its cross-staff voice on the lower staff. alphaTab
// retains an empty upper-staff beat at precisely that source direction time.
test('explicit direction uses an existing empty cross-staff anchor without adding beats',()=>{
 const input=xml.replace(upper,'<note><pitch><step>C</step><octave>3</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><staff>2</staff></note><note><pitch><step>D</step><octave>4</octave></pitch><duration>3</duration><voice>1</voice><type>half</type><dot/><staff>1</staff></note>');
 const {current,legacy}=pair(input),beat=current.tracks[0].staves[0].bars[0].voices[0].beats[0];
 assert.equal(beat.playbackStart,0);assert.equal(beat.isEmpty,true);assert.equal(beat.isDynamicsExplicit,true);
 assert.equal(forteCount(render(current)),1);assert.deepEqual(midi(current),midi(legacy));
});

test('source direction inside held notes uses independent staff time, without changing musical beats or MIDI',()=>{
 const {current,legacy}=pair(xml.replace(f,f.replace('</direction-type>','</direction-type><offset>0.5</offset>')));
 const bar=current.tracks[0].staves[0].bars[0];
 assert.equal(bar.voices.flatMap(v=>v.beats).some(b=>b.playbackStart===480),false);
 assert.equal(forteCount(render(current)),1);
 assert.deepEqual(bar.sourceDynamics.map(d=>({displayStart:d.displayStart,value:d.value})),[{displayStart:480,value:at.model.DynamicValue.F}]);
 assert.deepEqual(midi(current),midi(legacy));
 const copy=at.model.JsonConverter.jsObjectToScore(at.model.JsonConverter.scoreToJsObject(current));
 assert.equal(forteCount(render(copy)),1);
});

test('cross-staff move leaves a timed RH sign on RH with all declarations in that bar',()=>{
 const head=`<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>2</divisions><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>`;
 const note=(step,octave,duration,voice,type,staff)=>`<note><pitch><step>${step}</step><octave>${octave}</octave></pitch><duration>${duration}</duration><voice>${voice}</voice><type>${type}</type>${duration===6?'<dot/>':''}<staff>${staff}</staff></note>`;
 const pp='<direction><direction-type><dynamics><pp/></dynamics></direction-type><offset>6</offset><staff>1</staff></direction>';
 const mp=pp.replace('<pp/>','<mp/>').replace('<offset>6</offset>','<offset>7</offset>');
 const text=head+pp+mp+note('C',5,8,1,'whole',1)+'<backup><duration>8</duration></backup>'+note('C',4,6,3,'half',1)+'<note><rest/><duration>1</duration><voice>3</voice><type>eighth</type><staff>1</staff></note>'+note('D',3,1,3,'eighth',2)+'</measure></part></score-partwise>';
 const {current,legacy}=pair(text),[rh,lh]=current.tracks[0].staves.map(s=>s.bars[0]);
 assert.equal(rh.voices.flatMap(v=>v.beats).some(b=>b.playbackStart===3360),false);
 assert.equal(lh.voices.flatMap(v=>v.beats).some(b=>b.playbackStart===3360),true);
 assert.deepEqual(rh.sourceDynamics.map(d=>[d.displayStart,d.value]),[[2880,at.model.DynamicValue.PP],[3360,at.model.DynamicValue.MP]]);
 assert.equal(lh.sourceDynamics,null);
 const svg=render(current);
 for(const symbol of ['DynamicPP','DynamicMP'])assert.equal(svg.split(`&#${at.model.MusicFontSymbol[symbol]};`).length-1,1);
 assert.deepEqual(midi(current),midi(legacy));
});
