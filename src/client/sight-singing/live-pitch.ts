import { PitchDetector } from 'pitchy';
import { createPitchReader, frequency, pitchWindowSize, sightSingingMaxMidi, type PitchFrame } from './pitch-feedback';

const pitchHop = 96;
// Post one message per worklet-aligned block, while analyzing every hop.
export const livePitchChunkSize = pitchHop * 4;

const shortWindows = [
  { size: 320, floor: 240, rank: .5, minChange: .15 },
  { size: 704, floor: 110, rank: 1, minChange: 0 },
  { size: 1088, floor: 73.4, rank: 2, minChange: 0 },
];
const halfWindow = pitchWindowSize / 2;
// Each half-window has the same phase on the hop grid. Larger windows
// can replace an earlier estimate at precisely the same sample center.
const firstTick = (pitchHop - halfWindow % pitchHop) % pitchHop;
type Candidate = { center: number; midi: number };
type RankedFrame = PitchFrame & { rank: number };

export function createLivePitch(rate: number, maxHz = frequency(sightSingingMaxMidi), origin = 0, historySeconds = Infinity) {
  const window = new Float32Array(pitchWindowSize);
  const readLong = createPitchReader(rate, maxHz);
  const lanes = shortWindows.map(tier => {
    const detector = PitchDetector.forFloat32Array(tier.size);
    detector.minVolumeDecibels = -48;
    return { ...tier, detector, samples: window.subarray(window.length - tier.size), pending: null as Candidate | null };
  });
  const frames: RankedFrame[] = [];
  const time = (center: number) => (center - origin) / rate;
  let firstCenter = firstTick;
  let newest = firstCenter - pitchHop;
  let end = 0, filled = 0;
  let stableBass: Candidate | null = null;

  function put(center: number, midi: number, rank: number) {
    const index = (center - firstCenter) / pitchHop;
    const point = frames[index];
    if (point && point.rank < rank) frames[index] = { time: point.time, rank, midi };
  }

  function analyze() {
    const center = end - shortWindows[0].size / 2;
    if (center < firstTick) return;
    newest = center;
    frames.push({ time: time(center), midi: null, rank: 0 });

    if (end >= pitchWindowSize) {
      const midi = readLong(window);
      if (midi !== null) {
        const longCenter = end - halfWindow;
        put(longCenter, midi, 3);
        stableBass = midi < 45 ? { center: longCenter, midi } : null;
      }
    }
    for (const lane of lanes) {
      if (end < lane.size) continue;
      const laneCenter = end - lane.size / 2;
      if ((frames[(laneCenter - firstCenter) / pitchHop]?.rank ?? 0) > lane.rank) {
        lane.pending = null;
        continue;
      }
      const [hz, clarity] = lane.detector.findPitch(lane.samples, rate);
      const midi = clarity >= .9 && hz >= lane.floor && hz <= maxHz ? 69 + 12 * Math.log2(hz / 440) : null;
      const bassPartial = midi !== null && stableBass && laneCenter - stableBass.center < rate * .035 &&
        Math.abs(midi - stableBass.midi - 12) < .65;
      const previous = lane.pending;
      if (midi !== null && !bassPartial && previous) {
        const change = Math.abs(previous.midi - midi);
        if (change >= lane.minChange && change < 2) {
          put(previous.center, previous.midi, lane.rank);
          put(laneCenter, midi, lane.rank);
        }
      }
      lane.pending = midi === null || bassPartial ? null : { center: laneCenter, midi };
    }

    // Prune in batches so a long-running standalone monitor keeps bounded history.
    if (center - firstCenter > (historySeconds + 1) * rate) {
      const remove = Math.floor((center - firstCenter - historySeconds * rate) / pitchHop);
      frames.splice(0, remove);
      firstCenter += remove * pitchHop;
    }
  }

  return {
    frames,
    get finalTime() { return time(end - halfWindow); },
    append(samples: Float32Array): PitchFrame {
      for (let offset = 0; offset < samples.length;) {
        if (filled === 0) window.copyWithin(0, pitchHop);
        const count = Math.min(pitchHop - filled, samples.length - offset);
        window.set(samples.subarray(offset, offset + count), pitchWindowSize - pitchHop + filled);
        offset += count;
        filled += count;
        if (filled === pitchHop) {
          end += pitchHop;
          filled = 0;
          analyze();
        }
      }
      // Stable or low notes may have no short-window candidate. Use the newest
      // actual reading within the time allowed for a long-window estimate.
      let midi: number | null = null;
      for (let i = frames.length - 1; i >= 0 && frames[i].time >= time(end - halfWindow); i--) {
        if (frames[i].midi !== null) { midi = frames[i].midi; break; }
      }
      return { time: time(Math.max(0, newest)), midi };
    },
  };
}
