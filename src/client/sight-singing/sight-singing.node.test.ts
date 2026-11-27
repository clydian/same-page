import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { midi, model } from '@coderline/alphatab';
import { TONE_PROFILES } from '@same-page/player/timbre-profile';
import { zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { renderPracticeClicks } from '../playback/practice-metronome';
import { exportPracticeAudio } from '../playback/practice-soundfont';
import { createChoirBacking } from './choir-backing';
import { buildMelody, loadMelodyScore, melodyAtSpeed, type Melody } from './melody';
import { notationScore } from './notation-score';
import { assessNotes, createPitchReader, createScoringPitch, formatCents, frequency, pitchWindowSize, takeScore } from './pitch-feedback';
import { createLivePitch, livePitchChunkSize } from './live-pitch';
import { octaveGuides, pitchFramesConnect } from './pitch-trace';
import { calibrationTimes, calibrationTone, estimateRecordingLatency, recordingOffsetFrames } from './recording-latency';
import { keyPitchClasses, staffPitchY } from './staff-pitch';

const bytes = (text: string) => new TextEncoder().encode(text);
const pitch = (step: string, octave = 4) => `<pitch><step>${step}</step><octave>${octave}</octave></pitch>`;
const note = (step: string, tie?: 'start' | 'stop') => `<note>${pitch(step)}<duration>1</duration>${tie ? `<tie type="${tie}"/>` : ''}<type>quarter</type>${tie ? `<notations><tied type="${tie}"/></notations>` : ''}</note>`;
const xml = `<?xml version="1.0"?><score-partwise version="4.0">
<part-list><score-part id="P1"><part-name>Soprano</part-name></score-part><score-part id="P2"><part-name>Alto</part-name></score-part></part-list>
<part id="P1"><measure number="0" implicit="yes"><attributes><divisions>1</divisions><time><beats>2</beats><beat-type>4</beat-type></time></attributes><direction><sound tempo="120"/></direction>${note('A')}</measure>
<measure number="1"><barline location="left"><repeat direction="forward"/></barline>${note('C', 'start')}<direction><sound tempo="60"/></direction>${note('C', 'stop')}</measure>
<measure number="2"><note><rest/><duration>1</duration><type>quarter</type></note>${note('G')}<barline location="right"><repeat direction="backward"/></barline></measure></part>
<part id="P2"><measure number="0" implicit="yes"><attributes><divisions>1</divisions><time><beats>2</beats><beat-type>4</beat-type></time></attributes>${note('G')}</measure>
<measure number="1">${note('F')}<note><chord/>${pitch('A')}<duration>1</duration><type>quarter</type></note>${note('E')}</measure>
<measure number="2">${note('F')}${note('D')}</measure></part></score-partwise>`;

function melodyOf(input: string | Uint8Array = xml, first = 0, last = 4) {
  const document = loadMelodyScore(typeof input === 'string' ? bytes(input) : input);
  const melody = buildMelody(document, document.voices[0], first, last);
  if (typeof melody === 'string') throw new Error(melody);
  return { document, melody };
}

it('keeps the pickup, rests, tie, tempo changes and repeat visits on one score timeline', () => {
  const { document, melody } = melodyOf();
  expect(document.visits).toEqual([
    { number: '0' }, { number: '1', visit: 1 }, { number: '2', visit: 1 }, { number: '1', visit: 2 }, { number: '2', visit: 2 },
  ]);
  expect(document.voices.map(voice => voice.name)).toEqual(['Soprano', 'Alto']);
  expect(melody.notes.slice(0, 3)).toEqual([
    { midi: 69, start: 0, end: .5, visit: 0, bar: 0, beatIndex: 0 },
    { midi: 60, start: .5, end: 2, visit: 1, bar: 1, beatIndex: 0 },
    { midi: 67, start: 3, end: 4, visit: 2, bar: 2, beatIndex: 1 },
  ]);
  expect(melody.staffBeats.slice(0, 5).map(beat => [beat.start, beat.end, beat.bar, beat.pitches])).toEqual([
    [0, .5, 0, [69]], [.5, 1, 1, [60]], [1, 2, 1, [60]], [2, 3, 2, []], [3, 4, 2, [67]],
  ]);
  const secondPass = buildMelody(document, document.voices[0], 3, 4) as Melody;
  expect(secondPass.notes[0]).toMatchObject({ start: 0, visit: 3 });
  expect(secondPass.notes[1].start).toBe(secondPass.measures[1].start + 1);
  expect(melody.clicks.slice(0, 5)).toEqual([
    { time: 0, accent: 2 }, { time: .5, accent: 2 }, { time: 1, accent: 0 }, { time: 2, accent: 2 }, { time: 3, accent: 0 },
  ]);
  const slower = melodyAtSpeed(melody, .5);
  expect([slower.duration, slower.notes[1].end, slower.beatSeconds, slower.measures[1].start]).toEqual([16, 4, 1, 1]);
  expect(slower.clicks[3]).toEqual({ time: 4, accent: 2 });
  const alto = buildMelody(document, document.voices[1], 1, 1) as Melody;
  expect(alto.notes[0].chord).toEqual([65, 69]);
  for (const [midi, target, status] of [[65.12, 65, 'inTune'], [65.36, 65, 'sharp'], [68.62, 69, 'flat'], [67.6, 69, 'wrongNote']] as const) {
    expect(assessNotes(alto.notes, [{ time: .25, midi }])[0]).toMatchObject({ target, status });
  }
});

it('focuses a voice on a shared staff without changing the challenge timeline', () => {
  const secondVoice = `<backup><duration>2</duration></backup>` + ['E', 'F'].map(step =>
    `<note>${pitch(step)}<duration>1</duration><voice>2</voice><type>quarter</type>` +
    `<lyric><text>${step === 'E' ? 'Sing' : 'on'}</text></lyric></note>`).join('');
  const document = loadMelodyScore(bytes(xml.replace(`${note('C', 'stop')}</measure>`, `${note('C', 'stop')}${secondVoice}</measure>`)));
  const part = document.voices.find(voice => voice.track === 0 && voice.voice === 1)!;
  const source = document.score.tracks[0].staves[0].bars[1];
  const full = notationScore(document.score, part, true, 1, 2);
  const context = full.score.tracks[0].staves[0].bars[1].voices[0].beats[0];
  expect(context.style?.colors.get(model.BeatSubElement.StandardNotationBeams)?.a).toBe(133);
  expect(context.style?.colors.get(model.BeatSubElement.StandardNotationFlags)?.a).toBe(133);
  expect(full.score.tracks[0].staves[0].bars[1].voices[1].beats[0].style).toBeUndefined();

  const before = buildMelody(document, part, 1, 2);
  const focused = notationScore(document.score, part, false, 1, 2);
  expect(focused.tracks).toEqual([0]);
  const staff = focused.score.tracks[0].staves[0];
  expect(staff.bars.every(bar => bar.voices.length === 1)).toBe(true);
  expect(staff.bars[1].voices[0].beats.map(beat => [beat.index, beat.notes[0].realValue, beat.lyrics?.[0]])).toEqual([
    [0, 64, 'Sing'], [1, 65, 'on'],
  ]);
  expect(source.voices).toHaveLength(2);
  expect(source.voices[0].beats[0].style).toBeUndefined();
  expect(buildMelody(document, part, 1, 2)).toEqual(before);
});

it('renders the XML choir preset and sustains overlapping unisons on the score clock', () => {
  const font = readFileSync(new URL('./soundfont/sonivox.sf2', import.meta.resolve('@coderline/alphatab')));
  const sampleRate = 48000;
  const note = { midi: 69, bar: 0, visit: 0 };
  const voices = [[{ ...note, start: .25, end: .6 }], [{ ...note, start: .5, end: 1 }]];
  const backing = createChoirBacking(voices, 1.1, font, sampleRate);
  const reference = new midi.MidiFile();
  reference.division = 1000;
  const handler = new midi.AlphaSynthMidiFileHandler(reference);
  handler.addTempo(0, 60);
  handler.addControlChange(0, 0, 0, midi.ControllerType.BankSelectCoarse, TONE_PROFILES.choir.bank);
  handler.addProgramChange(0, 0, 0, TONE_PROFILES.choir.program);
  handler.addNote(0, 250, 750, 69, 80, 0);
  handler.finishTrack(0, 1100);
  const choir = exportPracticeAudio(reference, font, sampleRate, .75 / Math.sqrt(2));
  for (let part = 0; part < 2; part++) {
    const actual = backing.render(500)!.samples;
    expect(Buffer.from(actual.buffer, actual.byteOffset, actual.byteLength)).toEqual(
      Buffer.from(choir.render(500)!.samples.buffer),
    );
    if (part === 0) expect(actual.subarray(0, sampleRate / 3).every(sample => sample === 0)).toBe(true);
    expect(actual.some(sample => Math.abs(sample) > .005)).toBe(true);
  }
});

it('projects sung pitches through diatonic staff steps anchored to the written notehead', () => {
  const c = { y: 100, stepSize: 5, step: 28, writtenMidi: 60, signature: 0 };
  const e = { ...c, step: 30, writtenMidi: 64 };
  expect(staffPitchY(c, 0)).toBe(100);
  expect(staffPitchY(c, 1)).toBe(97.5); // C to D spans two semitones.
  expect(staffPitchY(e, 1)).toBe(95); // E to F spans one semitone.
  expect(staffPitchY(c, -1)).toBe(105); // C to B spans the octave boundary.
  const cSharp = { ...c, writtenMidi: 61, signature: 2 };
  expect(staffPitchY(cSharp, 0)).toBe(100);
  expect(staffPitchY(cSharp, .4)).toBe(98);
  expect(staffPitchY(cSharp, -.4)).toBe(101);
});

it('keeps the written key changes on the selected playback and speed timeline', () => {
  const changing = xml
    .replace('<divisions>1</divisions><time>', '<divisions>1</divisions><key><fifths>1</fifths></key><time>')
    .replace(note('C', 'stop'), `<attributes><key><fifths>-1</fifths></key></attributes>${note('C', 'stop')}`);
  const { melody } = melodyOf(changing);
  expect(melody.keyChanges).toEqual([
    { start: 0, signature: 1 }, { start: 1, signature: -1 },
    { start: 4, signature: 1 }, { start: 5, signature: -1 },
  ]);
  expect(melodyAtSpeed(melody, .5).keyChanges.map(key => key.start)).toEqual([0, 2, 8, 10]);
  const [g, f] = melody.keyChanges.map(key => keyPitchClasses(key.signature));
  expect([g.has(6), g.has(5), g.has(10), f.has(6), f.has(5), f.has(10)]).toEqual([true, false, false, false, true, true]);
});

it('breaks pitch lines at missing readings or note jumps and keeps the written octave guide separate', () => {
  expect(pitchFramesConnect({ time: 0, midi: 55 }, { time: .002, midi: null })).toBe(false);
  expect(pitchFramesConnect({ time: 0, midi: 55 }, { time: .002, midi: 67 })).toBe(false);
  expect(pitchFramesConnect({ time: 0, midi: 55 }, { time: .002, midi: 55.1 })).toBe(true);
  expect(octaveGuides([79], 33, 91)).toEqual([43, 55, 67, 91]); // G2–G6, excluding written G5.
  expect(octaveGuides([67, 79], 43, 81)).toEqual([43, 55]);
});

it('publishes fast short-window readings, then revises the same center as more audio arrives', () => {
  const rate = 48000;
  const track = createLivePitch(rate, 5000);
  const futureSilence = createLivePitch(rate, 5000);
  const prefix = 8736;
  let phase = 0;
  const pcm = Float32Array.from({ length: 9600 }, (_, i) => {
    const midi = 55 + 19 * Math.max(0, Math.min(1, (i / rate - .1) / .08));
    phase += 2 * Math.PI * frequency(midi) / rate;
    return .17 * (Math.sin(phase) + .5 * Math.sin(phase * 2 + .4) + .2 * Math.sin(phase * 3 + .8));
  });
  for (let i = 0; i < prefix; i += 192) {
    const next = pcm.subarray(i, Math.min(prefix, i + 192));
    expect(futureSilence.append(next)).toEqual(track.append(next));
  }
  const center = 8576 / rate;
  const point = () => track.frames.find(frame => frame.time === center);
  expect(point()).toMatchObject({ rank: .5 });
  expect(point()?.midi).toBeCloseTo(73.66, 1);
  expect(futureSilence.frames).toEqual(track.frames);
  const initial = point();

  track.append(pcm.subarray(prefix));
  futureSilence.append(new Float32Array(pcm.length - prefix));
  expect(point()).toMatchObject({ time: center, rank: 2 });
  expect(futureSilence.frames.find(frame => frame.time === center)).toEqual(initial);
  expect(track.frames.filter(frame => frame.time === center)).toHaveLength(1);
});

it.each([44100, 48000])('stays sample-aligned and keeps an absent reading explicit at %i Hz', rate => {
  const track = createLivePitch(rate, 5000, 960);
  const input = new Float32Array(3072);
  for (let i = 0; i < input.length; i += 211) track.append(input.subarray(i, i + 211));
  expect(track.frames[0]).toMatchObject({ time: (32 - 960) / rate, midi: null });
  expect(track.frames.every(frame => frame.midi === null)).toBe(true);
  expect(track.frames[1].time - track.frames[0].time).toBeCloseTo(96 / rate, 10);
  expect(track.finalTime).toBe((3072 - 1024 - 960) / rate);
});

it('preserves the original scoring windows across live-audio chunks and a partial tail', () => {
  const rate = 48000, origin = 256, half = pitchWindowSize / 2;
  const input = Float32Array.from({ length: half * 4 + 137 }, (_, i) =>
    .2 * Math.sin(2 * Math.PI * frequency(i < half * 2 ? 60 : 65) * i / rate));
  const scoring = createScoringPitch(rate, origin);
  for (let start = 0; start < input.length; start += livePitchChunkSize) {
    const end = Math.min(input.length, start + livePitchChunkSize);
    scoring.append(input.subarray(start, end), end === input.length);
  }
  const reader = createPitchReader(rate);
  const expected = [];
  for (let center = half; center < input.length; center += half) {
    const window = new Float32Array(pitchWindowSize);
    window.set(input.subarray(center - half, center + half));
    expected.push({ time: (center - origin) / rate, midi: reader(window) });
  }
  expect(scoring.frames).toEqual(expected);
});

it('accepts a compressed MusicXML attachment using the existing importer', () => {
  const compressed = zipSync({
    'META-INF/container.xml': bytes('<container><rootfiles><rootfile full-path="music.xml" media-type="application/vnd.recordare.musicxml+xml"/></rootfiles></container>'),
    'music.xml': bytes(xml),
  });
  expect(melodyOf(compressed).melody).toEqual(melodyOf(xml).melody);
});

describe('pitch and feedback', () => {
  const sampleRate = 48000;
  const tone = (midi: number) => Float32Array.from({ length: pitchWindowSize }, (_, i) => .25 * Math.sin(2 * Math.PI * i * frequency(midi) / sampleRate));
  const read = createPitchReader(sampleRate);
  const notes = melodyOf().melody.notes;
  it('detects pitch locally and leaves silence unvoiced', () => {
    expect(read(tone(69))).toBeCloseTo(69, 2);
    expect(read(tone(57.38))).toBeCloseTo(57.38, 2);
    const silence = read(new Float32Array(pitchWindowSize));
    expect(silence).toBeNull();
    const frames = notes.map(note => ({ time: (note.start + note.end) / 2, midi: silence }));
    expect(assessNotes(notes, frames).map(row => row.status)).toEqual(notes.map(() => 'missed'));
  });
  it('includes C8 and its sharp tolerance, with a wider monitor range', () => {
    const readWide = createPitchReader(sampleRate, 5000);
    expect(read(tone(91))).toBeCloseTo(91, 1);
    expect(read(tone(108))).toBeCloseTo(108, 1);
    expect(read(tone(108.4))).toBeCloseTo(108.4, 1);
    expect(read(tone(109))).toBeNull();
    expect(readWide(tone(108))).toBeCloseTo(108, 1);
    expect(readWide(tone(111))).toBeCloseTo(111, 1);
    expect(readWide(tone(112))).toBeNull();
  });
  it('counts detuned notes as correct and averages their partial credit with misses', () => {
    const targets = Array.from({ length: 7 }, (_, index) => ({ midi: 60, start: index, end: index + 1, bar: 0, visit: 0 }));
    const frames = [60.15, 59.65, 60.499, 59.5, 60.51, null].map((midi, index) => ({ midi, time: index + .5 }));
    const review = assessNotes(targets, frames);
    expect(review.map(row => row.status)).toEqual(['inTune', 'flat', 'sharp', 'flat', 'wrongNote', 'missed', 'insufficientData']);
    expect(review.map(row => takeScore([row]).percent)).toEqual([100, 71.43, 50.14, 50, 0, 0, null]);
    expect(takeScore(review)).toEqual({ total: 6, matched: 4, perfect: false, writtenOctave: false, percent: 45.26 });
    expect(takeScore(review.slice(0, 2))).toEqual({ total: 2, matched: 2, perfect: true, writtenOctave: true, percent: 85.71 });
    expect(takeScore([review[0], review[6]])).toMatchObject({ matched: 1, perfect: false, writtenOctave: false });
    const octaveTakes = [[60, 48], [72, 72], [48, 48]];
    for (const pitches of octaveTakes) {
      const notes = assessNotes(targets.slice(0, 2), pitches.map((midi, index) => ({ midi, time: index + .5 })));
      expect(takeScore(notes)).toMatchObject({ matched: 2, perfect: true, writtenOctave: false, percent: 100 });
    }
    const writtenChordTone = assessNotes([{ ...targets[0], chord: [60, 72] }], [{ midi: 72, time: .5 }]);
    expect(takeScore(writtenChordTone)).toMatchObject({ perfect: true, writtenOctave: true });
    expect([15.4, -35.5, -.1].map(formatCents)).toEqual(['+15', '-36', '0']);
    const nearBoundary = assessNotes(targets.slice(0, 2), [{ midi: 60.48, time: .5 }, { midi: 59.51, time: 1.5 }]);
    expect(nearBoundary.map(row => takeScore([row]).percent)).toEqual([52.86, 51.43]);
    const boundary = assessNotes(targets.slice(0, 4), [60.5, 59.5, 60.325, 59.499].map((midi, index) => ({ midi, time: index + .5 })));
    expect(boundary.map(row => takeScore([row]).percent)).toEqual([50, 50, 75, 0]);
    expect(takeScore(boundary.slice(0, 2))).toMatchObject({ percent: 50, matched: 2, perfect: true });
  });
  it('distinguishes missing frames from sampled silence in consecutive thirty-second notes', () => {
    const pitches = [60, 62, 64, 65, 67, 69, 71, 72, 71, 69, 67, 65];
    const secondsPerNote = 60 / 120 / 8;
    const shortNotes = pitches.map((midi, index) => ({
      midi, start: index * secondsPerNote, end: (index + 1) * secondsPerNote, bar: 0, visit: 0,
    }));
    const hop = 2048; // Keep the former sparse cadence as an explicit control.
    for (const [rate, unscored] of [[48000, [7, 9]], [44100, [9, 12]]] as const) {
      const frames = [];
      for (let sample = hop; sample < 2 * rate; sample += hop) {
        const time = sample / rate;
        frames.push({ time, midi: pitches[Math.floor(time / secondsPerNote)] ?? null });
      }
      const review = assessNotes(shortNotes, frames);
      expect(review.map(row => row.status)).toEqual(pitches.map((_, index) =>
        unscored.some(number => number === index + 1) ? 'insufficientData' : 'inTune'));
      for (const number of unscored) {
        expect(review[number - 1]).toMatchObject({ sung: null, cents: null });
      }
      const sampledSilence = [{ ...frames[0], midi: null }, ...frames.slice(1)];
      expect(assessNotes(shortNotes, sampledSilence)[0].status).toBe('missed');
      const denseFrames = Array.from({ length: Math.floor(2 * rate / (pitchWindowSize / 2)) }, (_, index) => {
        const time = (index + 1) * (pitchWindowSize / 2) / rate;
        return { time, midi: pitches[Math.floor(time / secondsPerNote)] ?? null };
      });
      expect(assessNotes(shortNotes, denseFrames).map(row => row.status)).toEqual(pitches.map(() => 'inTune'));
    }
  });
  it('distinguishes a sharp note, a wrong note and a missed note', () => {
    const result = assessNotes(notes, [
      { time: .2, midi: 69.35 }, { time: .3, midi: 69.35 },
      { time: 1, midi: 61 }, { time: 1.5, midi: 61 },
      { time: 3.4, midi: null }, { time: 4.5, midi: 60 },
    ]);
    expect(result.slice(0, 3).map(({ status, cents }) => ({ status, cents }))).toEqual([
      { status: 'sharp', cents: 35 }, { status: 'wrongNote', cents: 100 }, { status: 'missed', cents: null },
    ]);
  });
  it('matches chord tones across octaves while retaining cents and the sung register', () => {
    const chord = [{ midi: 60, chord: [60, 64], start: 0, end: 1, bar: 0, visit: 0 }];
    for (const [midi, target, octave, cents, status] of [
      [52, 64, -1, 0, 'inTune'], [76.32, 64, 1, 32, 'sharp'], [51.58, 64, -1, -42, 'flat'], [55, 64, -1, 300, 'wrongNote'],
      [40, 64, -2, 0, 'inTune'],
    ]) {
      expect(assessNotes(chord, [{ time: .5, midi: Number(midi) }])[0]).toMatchObject({ sung: midi, target, octave, cents, status });
    }
    const review = assessNotes(notes.slice(0, 2), [{ time: .25, midi: 57 }, { time: 1, midi: 72 }]);
    expect(review.map(row => row.status)).toEqual(['inTune', 'inTune']);
  });
});

it('renders distinct native XML metronome samples for primary, secondary and weak beats', () => {
  const soundfont = new URL('./soundfont/sonivox.sf2', import.meta.resolve('@coderline/alphatab'));
  const [weak, secondary, strong] = renderPracticeClicks(readFileSync(soundfont));
  const peak = (samples: Float32Array) => samples.reduce((value, sample) => Math.max(value, Math.abs(sample)), 0);
  expect([weak, secondary, strong].every(samples => samples.every(Number.isFinite))).toBe(true);
  expect(peak(weak)).toBeGreaterThan(.01);
  expect(peak(secondary)).toBeGreaterThan(peak(weak));
  expect(peak(strong)).toBeGreaterThan(peak(secondary));
});

it('counts on input samples and captures exactly the selected duration without count-in samples', () => {
  type Packet = { count?: number; samples?: Float32Array; done?: boolean };
  const messages: Packet[] = [];
  let create: new (options: { processorOptions: { beatFrames: number; beats: number; durationFrames: number; chunkFrames: number; startFrame?: number } }) => { process(inputs: Float32Array[][]): boolean };
  runInNewContext(readFileSync(new URL('./capture-processor.js', import.meta.url), 'utf8'), {
    currentFrame: 80,
    AudioWorkletProcessor: class { port = { postMessage: (message: Packet) => messages.push(message) }; },
    registerProcessor: (_name: string, implementation: typeof create) => { create = implementation; },
  });
  const processor = new create!({ processorOptions: { beatFrames: 100, beats: 2, durationFrames: 2051, chunkFrames: pitchWindowSize / 2 } });
  expect(processor.process([])).toBe(true);
  expect(processor.process([[new Float32Array(2255).map((_, i) => i)]])).toBe(false);
  expect(messages.slice(0, 2)).toEqual([{ count: 2 }, { count: 1 }]);
  expect(messages[2].samples?.length).toBe(1024);
  expect(messages[2].samples?.[0]).toBe(200);
  expect(messages[3].samples?.[0]).toBe(1224);
  expect(Array.from(messages[4].samples ?? [])).toEqual([2248, 2249, 2250]);
  expect(messages[4].done).toBe(true);
  messages.length = 0;
  const accompanied = new create!({ processorOptions: { beatFrames: 4, beats: 1, durationFrames: 3, chunkFrames: 8, startFrame: 84 } });
  expect(accompanied.process([[Float32Array.from({ length: 12 }, (_, i) => i)]])).toBe(false);
  expect(messages[0]).toEqual({ count: 1 });
  expect(Array.from(messages[1].samples ?? [])).toEqual([8, 9, 10]);
});

it('crops inclusive beats on each expanded visit and never attacks a tie carried in from before the crop', () => {
  const { document, melody } = melodyOf();
  const { voices } = document;
  expect(buildMelody(document, voices[0], 0, 4, { firstBeat: null, lastBeat: null })).toEqual(melody);
  expect(buildMelody(document, voices[0], 0, 0, { firstBeat: 2 })).toBe('noMelody');
  expect(buildMelody(document, voices[0], 1, 1, { firstBeat: 2, lastBeat: 1 })).toBe('noMelody');

  const throughFirstBeat = buildMelody(document, voices[0], 3, 3, { lastBeat: 1 }) as Melody;
  expect(throughFirstBeat.notes).toEqual([{ midi: 60, start: 0, end: throughFirstBeat.duration, visit: 3, bar: 1, beatIndex: 0 }]);
  expect(throughFirstBeat.clicks).toEqual([{ time: 0, accent: 2 }]);
  expect(throughFirstBeat.measures[0].clip).toEqual({ from: 0, until: 960, duration: 1920 });
  const carryIn = buildMelody(document, voices[0], 1, 2, { firstBeat: 2 }) as Melody;
  expect(carryIn.leadIn).toBe(.5);
  expect(carryIn.notes).toEqual([
    { midi: 60, start: 0, end: 1.5, visit: 1, bar: 1, beatIndex: 0 },
    { midi: 67, start: 2.5, end: 3.5, visit: 2, bar: 2, beatIndex: 1 },
  ]);
  expect(carryIn.clicks.slice(0, 2)).toEqual([{ time: 0, accent: 2 }, { time: .5, accent: 0 }]);
  expect(carryIn.tempoMarks).toEqual([{ start: 0, bpm: 120 }, { start: .5, bpm: 60 }]);
  const alto = buildMelody(document, voices[1], 1, 2, { firstBeat: 2 }) as Melody;
  expect(alto).toMatchObject({ duration: 3.5, leadIn: .5, notes: [
    { midi: 65, start: 0, end: .5 }, { midi: 64, start: .5, end: 1.5 },
    { midi: 65, start: 1.5, end: 2.5 }, { midi: 62, start: 2.5, end: 3.5 },
  ] });
  expect(melodyAtSpeed(carryIn, .5)).toMatchObject({ duration: 7, leadIn: 1, notes: [{ start: 0, end: 3 }, { start: 5, end: 7 }] });

  const sixteenth = (step: string) => `<note>${pitch(step)}<duration>1</duration><type>16th</type></note>`;
  const compound = loadMelodyScore(bytes(`<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Soprano</part-name></score-part></part-list>
    <part id="P1"><measure number="1"><attributes><divisions>4</divisions><time><beats>6</beats><beat-type>8</beat-type></time></attributes>
    <direction><sound tempo="120"/></direction>${'CDEFGACDEFGC'.split('').map(sixteenth).join('')}</measure></part></score-partwise>`));
  const firstEighthBeat = buildMelody(compound, compound.voices[0], 0, 0, { lastBeat: 1 }) as Melody;
  expect(firstEighthBeat.notes.map(({ midi, start, end }) => [midi, start, end])).toEqual([[60, 0, .125], [62, .125, .25]]);
  expect(firstEighthBeat.duration).toBe(.25);
});

it('estimates a repeatable acoustic delay but does not replace compensation with silence or inconsistent pulses', () => {
  const rate = 48000;
  const tone = calibrationTone(rate);
  const samples = new Float32Array(3.1 * rate);
  expect(estimateRecordingLatency(samples, tone, rate)).toBeNull();
  for (const time of calibrationTimes) samples.set(tone, Math.round((time + .187) * rate));
  expect(estimateRecordingLatency(samples, tone, rate)).toBe(187);
  expect(recordingOffsetFrames(rate, 187)).toBe(42576);
  samples.fill(0, 2 * rate);
  samples.set(tone, Math.round((calibrationTimes[2] + .104) * rate));
  expect(estimateRecordingLatency(samples, tone, rate)).toBeNull();
});
