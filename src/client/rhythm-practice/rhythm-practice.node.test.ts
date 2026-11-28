import { expect, it } from 'vitest';
import { loadMelodyScore } from '../sight-singing/melody';
import { acceptsRhythmTap, lockRhythmTiming, rhythmElapsed, scoreRhythm } from './scoring';
import { buildRhythmTimeline, rhythmVoices, type RhythmTimeline } from './timeline';

const note = (step: string, duration: number, type: string, flags = '') =>
  `<note>${flags}<pitch><step>${step}</step><octave>4</octave></pitch><duration>${duration}</duration><type>${type}</type></note>`;
const tied = (tie: 'start' | 'stop', duration: number, type: string) => note('C', duration, type)
  .replace('<type>', `<tie type="${tie}"/><type>`).replace('</note>', `<notations><tied type="${tie}"/></notations></note>`);
const rest = '<note><rest/><duration>2</duration><type>eighth</type></note>';
const attrs = '<attributes><divisions>4</divisions><time><beats>2</beats><beat-type>4</beat-type></time></attributes>';
const metre = '<attributes><time><beats>3</beats><beat-type>8</beat-type></time></attributes>';
const xml = `<score-partwise version="4.0">
<part-list><score-part id="S"><part-name>Soprano</part-name></score-part><score-part id="A"><part-name>Alto</part-name></score-part></part-list>
<part id="S"><measure number="0" implicit="yes">${attrs}<direction><sound tempo="120"/></direction>${note('A', 2, 'eighth')}</measure>
<measure number="1">${rest}${note('G', 1, '16th')}${note('B', 1, '16th', '<chord/>')}${note('A', 1, '16th')}${tied('start', 4, 'quarter')}</measure>
<measure number="2">${metre}<direction><sound tempo="60"/></direction>${tied('stop', 2, 'eighth')}${note('C', 2, 'eighth')}${rest}</measure></part>
<part id="A"><measure number="0" implicit="yes">${attrs}${note('E', 2, 'eighth')}</measure>
<measure number="1">${note('E', 8, 'half')}</measure>
<measure number="2">${metre}${note('A', 6, 'quarter').replace('</type>', '</type><dot/>')}</measure></part>
</score-partwise>`;

it('uses real pickup lengths, one attack per chord, selected lanes, tempo, meter and inclusive beat cuts', () => {
  const document = loadMelodyScore(new TextEncoder().encode(xml));
  const [soprano, alto] = rhythmVoices(document);
  const full = buildRhythmTimeline(document, soprano, 0, 2) as RhythmTimeline;
  expect(full.targets.map(({ time, visit }) => [time, visit])).toEqual([
    [0, 0], [.5, 1], [.625, 1], [.75, 1], [1.75, 2],
  ]);
  expect(full.measures.map(({ end }) => end)).toEqual([.25, 1.25, 2.75]);
  expect(full.clicks.map(({ time }) => time)).toEqual([0, .25, .75, 1.25, 1.75, 2.25]);
  expect([full.countBeats, full.countBeatSeconds]).toEqual([2, .5]);
  const other = buildRhythmTimeline(document, alto, 0, 2) as RhythmTimeline;
  expect(other.targets.map(({ time }) => time)).toEqual([0, .25, 1.25]);
  const cut = buildRhythmTimeline(document, soprano, 1, 2, { firstBeat: 2, lastBeat: 1 }) as RhythmTimeline;
  expect(cut.targets.map(({ time }) => time)).toEqual([0]);
  expect(cut.duration).toBe(1);
  expect(buildRhythmTimeline(document, soprano, 2, 2, { lastBeat: 1 })).toBe('noTargets');
  const later = buildRhythmTimeline(document, soprano, 2, 2, { firstBeat: 2 }) as RhythmTimeline;
  expect([later.countBeats, later.countBeatSeconds, later.denominator, later.bpm, later.targets[0].time]).toEqual([3, .5, 8, 60, 0]);
});

it('pairs in order, favors more matched attacks, and classifies timing separately from pairing', () => {
  const timing = lockRhythmTiming(1, .5, 1);
  const result = scoreRhythm([0, .19, .38, .57], [.17, .2, .28, .95], timing);
  expect(result.targets.map(mark => mark.status)).toEqual(['late', 'onTime', 'early', 'missed']);
  expect(result.taps.map(mark => mark.status)).toEqual(['late', 'onTime', 'early', 'extra']);
  expect(result.counts).toEqual({ onTime: 1, early: 1, late: 1, missed: 1, extra: 1 });
  expect(scoreRhythm([0, .2, .4], [.15, .35, .55], timing).counts.late).toBe(3);
});

it('uses original timestamps and filters count-in taps except one eligible first attack', () => {
  const timing = lockRhythmTiming(.75, .3, 1.2);
  expect(timing).toEqual({ speed: .75, window: expect.closeTo(.18), threshold: expect.closeTo(.08),
    earlyStart: expect.closeTo(-.08), end: expect.closeTo(1.78) });
  expect(rhythmElapsed(985, 1000)).toBe(-.015);
  expect(rhythmElapsed(performance.timeOrigin + 1000, 1000)).toBeCloseTo(0, 6);
  expect(acceptsRhythmTap(-.05, .14, timing)).toBe(false);
  expect(acceptsRhythmTap(1.8, 0, timing)).toBe(false);
  const result = scoreRhythm([0, .05, .4], [-.3, -.04, -.02, .4], timing);
  expect(result.taps.map(mark => mark.time)).toEqual([-.02, .4]);
  expect(result.counts).toEqual({ onTime: 2, early: 0, late: 0, missed: 1, extra: 0 });
});
