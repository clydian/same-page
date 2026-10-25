import test from 'node:test';
import assert from 'node:assert/strict';
import { playbackTempo } from '../dist/practice-tempo.js';
import { readMusicXmlTempoMeasures } from '../dist/musicxml-metronome.js';
test('tempo display follows expanded repeats, exact boundaries and mid-bar changes, retaining beat units',()=>{
 const bars=[{start:0,end:3840,masterBar:{index:0},tempoChanges:[{tick:0,tempo:120},{tick:1920,tempo:90}]},{start:3840,end:6720,masterBar:{index:1},tempoChanges:[{tick:3840,tempo:180}]},{start:6720,end:10560,masterBar:{index:0},tempoChanges:[{tick:6720,tempo:120},{tick:8640,tempo:90}]}];
 const units=[{events:[{quarter:0,bpm:120},{quarter:2,bpm:90}]},{events:[{quarter:0,bpm:180,unitQuarters:1.5}]}];
 assert.deepEqual(playbackTempo(bars,1919,units),{bpm:120,unit:1});assert.deepEqual(playbackTempo(bars,1920,units),{bpm:90,unit:1});
 assert.deepEqual(playbackTempo(bars,3840,units),{bpm:180,unit:1.5});assert.deepEqual(playbackTempo(bars,6720,units),{bpm:120,unit:1});
});
test('dotted quarter metronome metadata preserves displayed 120 while playback is quarter 180',()=>{
 const bytes=new TextEncoder().encode('<score-partwise><part id="P1"><measure><direction><direction-type><metronome><beat-unit>quarter</beat-unit><beat-unit-dot/><per-minute>120</per-minute></metronome></direction-type><sound tempo="180"/></direction></measure></part></score-partwise>');
 assert.deepEqual(readMusicXmlTempoMeasures(bytes)[0].events,[{quarter:0,bpm:180,visible:true,unitQuarters:1.5}]);
});
