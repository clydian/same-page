import test from 'node:test';
import assert from 'node:assert/strict';
import * as at from '@coderline/alphatab';
import {loadMusicXml,loadPreparedMusicXml,assignPlaybackChannels,preparePianoPlaybackMidi} from '../src/engine.ts';
import {prepareMusicXmlForAlphaTabBytes} from '../src/musicxml-direction-timing.ts';

function input(creators){return new TextEncoder().encode(`<score-partwise version="4.0"><work><work-title>Owned credit fixture</work-title></work><identification>${creators}</identification><part-list><score-part id="P1"><part-name>Voice</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration><type>whole</type></note></measure></part></score-partwise>`);}
function render(score){const settings=new at.Settings();settings.core.engine='svg';settings.core.enableLazyLoading=false;const renderer=new at.rendering.ScoreRenderer(settings),pieces=[];renderer.width=1000;renderer.partialRenderFinished.on(e=>{if(typeof e.renderResult==='string')pieces.push(e.renderResult)});renderer.error.on(error=>{throw error});renderer.renderScore(score,[0]);renderer.destroy();return pieces.join('');}
function midi(score){assignPlaybackChannels(score.tracks);const settings=new at.Settings(),file=new at.midi.MidiFile(),generator=new at.midi.MidiFileGenerator(score,settings,new at.midi.AlphaSynthMidiFileHandler(file));generator.applyTranspositionPitches=false;generator.generate();preparePianoPlaybackMidi(score,file,settings);return file.tracks.map(track=>track.events.map(event=>JSON.stringify(event)));}

test('typed arranger credit never appears as the author of the music in actual SVG',()=>{
 const bytes=input('<creator type="composer">Alice</creator><creator type="lyricist">Carol</creator><creator type="arranger">Bob</creator>'),before=bytes.slice();
 const score=loadMusicXml(bytes,new at.Settings());
 assert.equal(score.artist,'Music by Alice\nArranged by Bob');assert.equal(score.music,'');assert.equal(score.words,'Carol');
 const svg=render(score);assert.ok(svg.includes('Music by Alice'));assert.ok(svg.includes('Arranged by Bob'));assert.ok(!svg.includes('Music by Bob'));
 assert.deepEqual(bytes,before);
 assert.deepEqual(midi(score),midi(loadMusicXml(input('<creator type="composer">Alice</creator><creator type="lyricist">Carol</creator>'),new at.Settings())),'credit correction must not change any MIDI event');
});
test('source creator metadata survives preparation and older prepared payloads',()=>{
 const bytes=input('<creator type="composer">A &amp; B</creator><creator type="arranger">C</creator>'),prepared=prepareMusicXmlForAlphaTabBytes(bytes);
 assert.deepEqual(prepared.creatorCredits,{composers:['A & B'],arrangers:['C']});
 const legacy={...prepared};delete legacy.creatorCredits;
 assert.equal(loadPreparedMusicXml(legacy,new at.Settings()).artist,'Music by A & B\nArranged by C');
});
test('retains multiple named composers and a lyricist who is also the arranger without a false combined label',()=>{
 const score=loadMusicXml(input('<creator type="composer">Alice</creator><creator type="composer">Dora</creator><creator type="lyricist">Bob</creator><creator type="arranger">Bob</creator>'),new at.Settings());
 assert.equal(score.artist,'Music by Alice, Dora\nArranged by Bob');assert.equal(score.words,'Bob');
 const svg=render(score);assert.ok(svg.includes('Arranged by Bob'));assert.ok(!svg.includes('Words &amp; Music by Bob'));assert.ok(!svg.includes('Words & Music by Bob'));
});
test('does not invent a composer for arranger-only metadata or change credits without arrangers',()=>{
 const onlyArranger=loadMusicXml(input('<creator type="arranger">Bob</creator>'),new at.Settings());assert.equal(onlyArranger.artist,'Arranged by Bob');assert.equal(onlyArranger.music,'');
 const untyped=loadMusicXml(input('<creator>Untyped author</creator>'),new at.Settings());assert.equal(untyped.artist.replaceAll('\u00a0',' '),'Untyped author');assert.equal(untyped.music,'');
 const composer=loadMusicXml(input('<creator type="composer">Alice</creator>'),new at.Settings());assert.equal(composer.artist,'Alice');assert.equal(composer.music,'');
});
