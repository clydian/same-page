import assert from 'node:assert/strict';
import { test } from 'vitest';
import * as alphaTab from '@coderline/alphatab';
import { loadMusicXml, assignPlaybackChannels, preparePianoPlaybackMidi } from '@clydian/chorus-player/engine';

const source = "<?xml version='1.0' encoding='UTF-8'?>\n<score-partwise version=\"4.0\"><part-list><score-part id=\"P1\"><part-name>Piano</part-name><score-instrument id=\"I1\"><instrument-name>Piano</instrument-name></score-instrument><midi-instrument id=\"I1\"><midi-channel>1</midi-channel><midi-program>1</midi-program></midi-instrument></score-part></part-list><part id=\"P1\"><measure number=\"1\"><attributes><divisions>24</divisions><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves><clef number=\"1\"><sign>G</sign><line>2</line></clef><clef number=\"2\"><sign>F</sign><line>4</line></clef></attributes><direction><direction-type><dynamics><mp/></dynamics></direction-type><offset>0</offset><staff>1</staff></direction><direction><direction-type><wedge type=\"diminuendo\" number=\"1\"/></direction-type><offset>24</offset><staff>1</staff></direction><direction><direction-type><wedge type=\"stop\" number=\"1\"/></direction-type><offset>60</offset><staff>1</staff></direction><note><pitch><step>C</step><octave>5</octave></pitch><duration>24</duration><voice>1</voice><type>quarter</type><staff>1</staff></note><note><pitch><step>C</step><octave>5</octave></pitch><duration>24</duration><voice>1</voice><type>quarter</type><staff>1</staff></note><note><pitch><step>C</step><octave>5</octave></pitch><duration>24</duration><voice>1</voice><type>quarter</type><staff>1</staff></note><note><pitch><step>C</step><octave>5</octave></pitch><duration>24</duration><voice>1</voice><type>quarter</type><staff>1</staff></note><backup><duration>96</duration></backup><note><pitch><step>E</step><octave>3</octave></pitch><duration>24</duration><voice>2</voice><type>quarter</type><staff>2</staff></note><note><pitch><step>E</step><octave>3</octave></pitch><duration>24</duration><voice>2</voice><type>quarter</type><staff>2</staff></note><note><pitch><step>E</step><octave>3</octave></pitch><duration>24</duration><voice>2</voice><type>quarter</type><staff>2</staff></note><note><pitch><step>E</step><octave>3</octave></pitch><duration>24</duration><voice>2</voice><type>quarter</type><staff>2</staff></note></measure><measure number=\"2\"><direction><direction-type><dynamics><mf/></dynamics></direction-type><offset>0</offset><staff>1</staff></direction><note><pitch><step>C</step><octave>5</octave></pitch><duration>24</duration><voice>1</voice><type>quarter</type><staff>1</staff></note><note><pitch><step>C</step><octave>5</octave></pitch><duration>24</duration><voice>1</voice><type>quarter</type><staff>1</staff></note><note><pitch><step>C</step><octave>5</octave></pitch><duration>24</duration><voice>1</voice><type>quarter</type><staff>1</staff></note><note><pitch><step>C</step><octave>5</octave></pitch><duration>24</duration><voice>1</voice><type>quarter</type><staff>1</staff></note><backup><duration>96</duration></backup><note><pitch><step>E</step><octave>3</octave></pitch><duration>24</duration><voice>2</voice><type>quarter</type><staff>2</staff></note><note><pitch><step>E</step><octave>3</octave></pitch><duration>24</duration><voice>2</voice><type>quarter</type><staff>2</staff></note><note><pitch><step>E</step><octave>3</octave></pitch><duration>24</duration><voice>2</voice><type>quarter</type><staff>2</staff></note><note><pitch><step>E</step><octave>3</octave></pitch><duration>24</duration><voice>2</voice><type>quarter</type><staff>2</staff></note></measure></part></score-partwise>";

test('installed package closes a two-staff offbeat wedge before following explicit MF', () => {
 const input = new TextEncoder().encode(source), original=input.slice();
 const settings=new alphaTab.Settings(), score=loadMusicXml(input, settings);
 assert.deepEqual(input,original);
 assignPlaybackChannels(score.tracks);
 const file=new alphaTab.midi.MidiFile(), generator=new alphaTab.midi.MidiFileGenerator(score,settings,new alphaTab.midi.AlphaSynthMidiFileHandler(file));
 generator.applyTranspositionPitches=false;
 generator.generate();
 preparePianoPlaybackMidi(score,file,settings);
 const attacks=file.tracks.flatMap(track=>track.events).filter(event=>event instanceof alphaTab.midi.NoteOnEvent);
 assert.ok(attacks.some(event=>event.tick===1920 && event.noteVelocity<63),'real diminuendo must still affect inside-span attack');
 const afterStop=attacks.filter(event=>event.tick===2880);
 assert.ok(afterStop.length>0);
 assert.ok(afterStop.every(event=>event.noteVelocity===63),'exact stop2.5, not next note3 or next-barMF');
 const afterMF=attacks.filter(event=>event.tick>=3840);
 assert.equal(afterMF.length,8);
 assert.ok(afterMF.every(event=>event.noteVelocity===79),'all attacks after explicitMF must retainMF');
});
