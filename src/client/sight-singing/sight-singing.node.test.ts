import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { renderPracticeClicks } from '../playback/practice-metronome';
import { buildMelody, loadMelodyScore, melodyAtSpeed, type Melody } from './melody';
import { assessNotes, createPitchReader, frequency, pitchWindowSize } from './pitch-feedback';

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
  for (const [midi, target, status] of [[65.18, 65, 'inTune'], [65.36, 65, 'sharp'], [68.62, 69, 'flat'], [67.6, 69, 'wrongNote']] as const) {
    expect(assessNotes(alto.notes, [{ time: .25, midi }])[0]).toMatchObject({ target, status });
  }
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
        expect(review[number - 1]).toMatchObject({ sung: null, cents: null, interval: null });
        if (number < review.length) expect(review[number].interval).toBeNull();
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
  it('reports pitch and interval independently and breaks interval feedback across a missed note', () => {
    const result = assessNotes(notes, [
      { time: .2, midi: 69.35 }, { time: .3, midi: 69.35 },
      { time: 1, midi: 61 }, { time: 1.5, midi: 61 },
      { time: 3.4, midi: null }, { time: 4.5, midi: 60 },
    ]);
    expect(result.slice(0, 3).map(({ status, cents, interval }) => ({ status, cents, interval }))).toEqual([
      { status: 'sharp', cents: 35, interval: null }, { status: 'wrongNote', cents: 100, interval: 65 }, { status: 'missed', cents: null, interval: null },
    ]);
    expect(result[3].interval).toBe(null);
  });
  it('matches chord tones across octaves while retaining cents, sung pitches and real interval jumps', () => {
    const chord = [{ midi: 60, chord: [60, 64], start: 0, end: 1, bar: 0, visit: 0 }];
    for (const [midi, target, octave, cents, status] of [
      [52, 64, -1, 0, 'inTune'], [76.32, 64, 1, 32, 'sharp'], [51.58, 64, -1, -42, 'flat'], [55, 64, -1, 300, 'wrongNote'],
      [40, 64, -2, 0, 'inTune'],
    ]) {
      expect(assessNotes(chord, [{ time: .5, midi: Number(midi) }])[0]).toMatchObject({ sung: midi, target, octave, cents, status });
    }
    const review = assessNotes(notes.slice(0, 2), [{ time: .25, midi: 57 }, { time: 1, midi: 72 }]);
    expect(review.map(row => row.status)).toEqual(['inTune', 'inTune']);
    expect(review[1].interval).toBe(2400);
  });
});

it('renders distinct native XML metronome samples for primary, secondary and weak beats', () => {
  const [weak, secondary, strong] = renderPracticeClicks(readFileSync(new URL('../../../public/soundfont/sonivox.sf2', import.meta.url)));
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
