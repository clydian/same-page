import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import * as alphaTab from '@coderline/alphatab';
const require = createRequire(import.meta.url);
const event = () => {
 const listeners = new Set();
 return { on(fn) { listeners.add(fn); return () => listeners.delete(fn); }, trigger(value) { for (const fn of listeners) fn(value); } };
};
class MemoryOutput {
 sampleRate = 44100; chunks = []; ready = event(); samplesPlayed = event(); sampleRequest = event();
 open() { this.ready.trigger(); }
 play() {} pause() {} destroy() {} activate() {} resetSamples() {}
 addSamples(samples) { this.chunks.push(samples.slice()); this.samplesPlayed.trigger(samples.length / 2); }
}
test('shipped SONiVOX renders distinct audible downbeats and weak beats, including with music muted', () => {
 const output = new MemoryOutput(), synth = new alphaTab.synth.AlphaSynth(output, 100);
 const file = new alphaTab.midi.MidiFile(), handler = new alphaTab.midi.AlphaSynthMidiFileHandler(file);
 handler.addTimeSignature(0,4,4);handler.addTempo(0,120);handler.finishTrack(0,3840);
 const native = path.dirname(path.dirname(require.resolve('@coderline/alphatab')));
 synth.loadSoundFont(new Uint8Array(readFileSync(path.join(native,'dist/soundfont/sonivox.sf2'))),false);
 synth.loadMidiFile(file);synth.setChannelMute(0,true);synth.metronomeVolume = .5;
 assert.equal(synth.hasSamplesForPercussion(76),true);assert.equal(synth.hasSamplesForPercussion(77),true);
 let finished = false;synth.finished.on(()=>{finished=true;});synth.play();
 for(let pulls=0;!finished && pulls<500;pulls++) output.sampleRequest.trigger();
 assert.equal(finished,true);
 const pcm = Float32Array.from(output.chunks.flatMap(chunk=>Array.from(chunk)));
 const energy = seconds => { const start=Math.round(seconds*44100)*2;let sum=0;for(let i=start;i<start+4410;i++)sum+=(pcm[i]??0)**2;return sum/4410; };
 assert.ok(energy(0)>1e-8,'downbeat is audible');assert.ok(energy(.5)>1e-8,'weak beat is audible');
 assert.ok(Math.abs(energy(0)-energy(.5))>1e-8,'accents are audibly distinct');
 synth.destroy();
});
