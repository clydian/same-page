import * as at from '@coderline/alphatab';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const event={on(){},off(){}};
const output={sampleRate:44100,ready:event,sampleRequest:event,samplesPlayed:event,open(){},activate(){},pause(){},destroy(){},resetSamples(){}};
const synth=new at.synth.AlphaSynth(output,100);
const sf=new Uint8Array(await readFile('node_modules/@coderline/alphatab/dist/soundfont/sonivox.sf2'));
const results=[];
for (const [name,program] of [['piano',0],['aahs',52],['oohs',53]]) {
 const file=new at.midi.MidiFile();
 file.addEvent(new at.midi.ProgramChangeEvent(0,0,0,program));file.addEvent(new at.midi.NoteOnEvent(0,0,0,60,80));file.addEvent(new at.midi.NoteOffEvent(0,1920,0,60,0));file.addEvent(new at.midi.EndOfTrackEvent(0,2400));
 const options=new at.synth.AudioExportOptions();options.soundFonts=[sf];
 const exporter=synth.exportAudio(options,file,[],new Map());
 const chunks=[];let chunk;
 while((chunk=exporter.render(1000)))chunks.push(chunk.samples);
 const floats=new Float32Array(chunks.reduce((n,c)=>n+c.length,0));let offset=0;for(const c of chunks){floats.set(c,offset);offset+=c.length;}
 const wav=Buffer.alloc(44+floats.length*2);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(2,22);wav.writeUInt32LE(44100,24);wav.writeUInt32LE(44100*4,28);wav.writeUInt16LE(4,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(floats.length*2,40);
 let energy=0,peak=0;for(let i=0;i<floats.length;i++){energy+=floats[i]**2;peak=Math.max(peak,Math.abs(floats[i]));wav.writeInt16LE(Math.round(Math.min(1,Math.max(-1,floats[i]))*32767),44+i*2);}
 await writeFile(`artifacts/verification/timbre/${name}.wav`,wav);
 results.push({name,program,samples:floats.length,rms:Math.sqrt(energy/floats.length),peak,sha256:createHash('sha256').update(wav).digest('hex')});
}
await writeFile('artifacts/verification/timbre/sounds.json',JSON.stringify({soundfontSha256:createHash('sha256').update(sf).digest('hex'),results},null,2));console.log(results);
