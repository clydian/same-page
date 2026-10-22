import assert from 'node:assert/strict';
import {test} from 'vitest';
import * as at from '@coderline/alphatab';
import {loadMusicXml, assignPlaybackChannels, preparePianoPlaybackMidi} from '@same-page/player/engine';

// All fixtures here are short, independently authored controls, not score extracts.
const scoreXml = measures => `<score-partwise version="4.0"><part-list><score-part id="P"><part-name>Piano</part-name></score-part></part-list><part id="P">${measures}</part></score-partwise>`;
const attrs = '<attributes><divisions>1</divisions><time><beats>1</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>';
const note = (step, octave, extra = '', chord = false) => `<note>${chord ? '<chord/>' : ''}<pitch><step>${step}</step><octave>${octave}</octave></pitch><duration>1</duration><type>quarter</type>${extra}</note>`;
function capture(xml, layout = at.LayoutMode.Page) {
  const settings = new at.Settings();
  settings.core.engine = 'svg';
  settings.core.enableLazyLoading = false;
  settings.display.staveProfile = at.StaveProfile.Score;
  settings.display.layoutMode = layout;
  const imported = loadMusicXml(new TextEncoder().encode(xml), settings);
  assignPlaybackChannels(imported.tracks);
  const score = at.model.JsonConverter.jsonToScore(at.model.JsonConverter.scoreToJson(imported));
  const renderer = new at.rendering.ScoreRenderer(settings);
  renderer.width = 1200;
  const pieces = [];
  renderer.error.on(error => { throw error; });
  renderer.partialRenderFinished.on(event => {
    if (typeof event.renderResult === 'string') pieces.push(event.renderResult);
  });
  try { renderer.renderScore(score, [0]); } finally { renderer.destroy(); }
  const file = new at.midi.MidiFile();
  const generator = new at.midi.MidiFileGenerator(score, settings, new at.midi.AlphaSynthMidiFileHandler(file));
  generator.applyTranspositionPitches = false;
  generator.generate();
  preparePianoPlaybackMidi(score, file, settings);
  const events = file.tracks.flatMap(track => track.events);
  const selected = kind => events.filter(event => event.constructor.name === kind).map(event => [event.tick, event.noteKey]);
  const svg = pieces.join('').replace(/&#x([0-9a-f]+);/gi, (_, value) => String.fromCodePoint(parseInt(value, 16))).replace(/&#(\d+);/g, (_, value) => String.fromCodePoint(+value));
  return {score, svg, events:events.map(e=>JSON.parse(JSON.stringify(e))), on: selected('NoteOnEvent'), off: selected('NoteOffEvent'), bounds: generator.tickLookup.masterBars.map(bar => [bar.start, bar.end])};
}


const slur = (kind, number='1') => `<notations><slur type="${kind}" number="${number}" placement="above"/></notations>`;
function crossing(startNumber='1',stopNumber='1') {
 const first=note('C',5,`<staff>1</staff>${slur('start',startNumber)}`).replace('<type>quarter</type>','<voice>1</voice><type>quarter</type>');
 const last=note('C',3,`<staff>2</staff>${slur('stop',stopNumber)}`).replace('<type>quarter</type>','<voice>2</voice><type>quarter</type>');
 return scoreXml(`<measure number="1">${attrs.replace('<beats>1</beats>','<beats>2</beats>').replace('<clef>','<staves>2</staves><clef>').replace('</attributes>','<clef number="2"><sign>F</sign><line>4</line></clef></attributes>')}${first}${last}</measure>`);
}
function tuplets(number,bracket) {
 const notes=['C','D','E'].map((step,i)=>`<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>2</duration><type>quarter</type><time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>${i===0?`<notations><tuplet type="start" show-number="${number}" bracket="${bracket}"/></notations>`:i===2?'<notations><tuplet type="stop"/></notations>':''}</note>`).join('');
 return scoreXml(`<measure number="1">${attrs.replace('<divisions>1</divisions>','<divisions>3</divisions>').replace('<beats>1</beats>','<beats>4</beats>')}${notes}<note><rest/><duration>6</duration><type>half</type></note></measure>`);
}
const stems=svg=>svg.match(/<rect\b[^>]*width="1\.08"[^>]*>/g)??[];
const normalized=svg=>svg.replace(/>\s+</g,'><');
const withoutStems=svg=>normalized(svg.replace(/<rect\b[^>]*width="1\.08"[^>]*>/g,''));
for(const layout of [at.LayoutMode.Page,at.LayoutMode.Horizontal]) {
 test(`cross-staff phrase retains its public endpoint and one native span (${at.LayoutMode[layout]})`,()=>{
  const got=capture(crossing(),layout),notes=got.score.tracks[0].staves.flatMap(s=>s.bars.flatMap(b=>b.voices.flatMap(v=>v.beats.flatMap(be=>be.notes))));
  assert.equal(notes[0].slurDestination,notes[1]);assert.notEqual(notes[0].beat.voice.bar.staff,notes[1].beat.voice.bar.staff);
  assert.equal((got.svg.match(/<path\b/g)??[]).length,1);
 });
 test(`explicit hidden tuplet keeps all musical events (${at.LayoutMode[layout]})`,()=>{
  const hidden=capture(tuplets('none','no'),layout),visible=capture(tuplets('both','yes'),layout);
  assert.equal(hidden.score.tracks[0].staves[0].bars[0].voices[0].beats[0].sourceTupletNumber,'none');
  assert.equal(hidden.score.tracks[0].staves[0].bars[0].voices[0].beats[0].sourceTupletBracket,false);
  assert.ok(!hidden.svg.includes('\uE883'));assert.ok(visible.svg.includes('\uE883'));assert.ok(visible.svg.includes('\uE88A'));
  assert.equal((hidden.svg.match(/<path\b/g)??[]).length,0);assert.equal((visible.svg.match(/<path\b/g)??[]).length,1);
  assert.deepEqual(hidden.events,visible.events);assert.deepEqual(hidden.bounds,visible.bounds);
 });
 test(`stem none removes only the stem rectangle after JSON (${at.LayoutMode[layout]})`,()=>{
  const hidden=capture(scoreXml(`<measure number="1">${attrs}${note('E',4,'<stem>none</stem>')}</measure>`),layout),visible=capture(scoreXml(`<measure number="1">${attrs}${note('E',4,'<stem>up</stem>')}</measure>`),layout);
  assert.equal(hidden.score.tracks[0].staves[0].bars[0].voices[0].beats[0].isStemVisible,false);
  assert.equal(stems(hidden.svg).length,0);assert.equal(stems(visible.svg).length,1);
  assert.equal(normalized(hidden.svg),withoutStems(visible.svg));assert.deepEqual(hidden.events,visible.events);assert.deepEqual(hidden.bounds,visible.bounds);
 });
 test(`number-only and bracket-only declarations stay independent (${at.LayoutMode[layout]})`,()=>{
  const number=capture(tuplets('actual','no'),layout),bracket=capture(tuplets('none','yes'),layout);
  assert.ok(number.svg.includes('\uE883'));assert.equal((number.svg.match(/<path\b/g)??[]).length,0);
  assert.ok(!bracket.svg.includes('\uE883'));assert.equal((bracket.svg.match(/<path\b/g)??[]).length,1);
 });
}
test('different phrase numbers do not create a cross-staff endpoint',()=>{
 const got=capture(crossing('1','2'));
 const first=got.score.tracks[0].staves[0].bars[0].voices[0].beats[0].notes[0];assert.equal(first.slurDestination,null);
});
test('legacy JSON without the display fields keeps automatic stems and tuplets',()=>{
 const old=at.model.JsonConverter.scoreToJsObject(capture(tuplets('actual','yes')).score);
 const walk=x=>{if(!x||typeof x!=='object')return;for(const key of ['isstemvisible','sourcetupletnumber','sourcetupletbracket']){if(x instanceof Map)x.delete(key);else delete x[key];}for(const value of x instanceof Map?x.values():Object.values(x))walk(value);};walk(old);
 const score=at.model.JsonConverter.jsObjectToScore(old),beat=score.tracks[0].staves[0].bars[0].voices[0].beats[0];
 assert.equal(beat.isStemVisible,true);assert.equal(beat.sourceTupletNumber,undefined);assert.equal(beat.sourceTupletBracket,undefined);
});
test('a visible eighth flag remains when its stem is hidden',()=>{
 const make=stem=>scoreXml(`<measure number="1">${attrs.replace('<divisions>1</divisions>','<divisions>2</divisions>')}<note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><type>eighth</type><stem>${stem}</stem></note></measure>`);
 const a=capture(make('none')),b=capture(make('up'));assert.equal(normalized(a.svg),withoutStems(b.svg));assert.deepEqual(a.events,b.events);
});

// A roll is a subdivision, not a fixed repetition count per printed long note.
for (const [type, quarters, count] of [['half', 2, 8], ['whole', 4, 16]]) {
  test(`two-stroke single tremolo keeps sixteenth-note attacks on a ${type}`, () => {
    const header = attrs.replace('<beats>1</beats>', `<beats>${quarters}</beats>`);
    const xml = scoreXml(`<measure number="1">${header}<note><pitch><step>C</step><octave>4</octave></pitch><duration>${quarters}</duration><type>${type}</type><notations><ornaments><tremolo type="single">2</tremolo></ornaments></notations></note></measure>`);
    const got = capture(xml);
    assert.deepEqual(got.on, Array.from({length:count}, (_, i) => [240 * i, 60]));
    assert.equal(got.off.at(-1)[0], quarters * 960);
    assert.deepEqual(got.bounds, [[0, quarters * 960]]);
  });
}
test('the last rolled stroke sustains into a plain tied destination without new attacks', () => {
  const rolled = '<note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><tie type="start"/><type>quarter</type><notations><tied type="start"/><ornaments><tremolo type="single">2</tremolo></ornaments></notations></note>';
  const held = '<note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><tie type="stop"/><type>quarter</type><notations><tied type="stop"/></notations></note>';
  const got = capture(scoreXml(`<measure number="1">${attrs}${rolled}</measure><measure number="2">${held}</measure>`));
  assert.deepEqual(got.on, [[0,60],[240,60],[480,60],[720,60]]);
  assert.equal(got.off.at(-1)[0],1920);
  assert.deepEqual(got.bounds,[[0,960],[960,1920]]);
});
