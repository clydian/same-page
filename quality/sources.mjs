export const voices = [[1, .53, .24, .12, .08, .04], [.50, .90, .43, .29, .17, .06], [.87, .28, .45, .15, .1, .06]];
const phrase = [60, 62, 64, 65, 67, 69, 71, 72, 71, 69, 67, 65];
const bass = [48, 45, 43, 40, 38, 36, 40, 43];
function take(name, pitches, length, options = {}) {
  const { offset = 0, deviations = {}, missing = [], separation = 0, delay = {}, level = .16, noise = .004, variant = 0, hum = 0 } = options;
  const notes = pitches.map((midi, index) => ({ midi, start: index * (length + separation), end: index * (length + separation) + length, visit: 0, bar: 0 }));
  const truth = notes.map((note, index) => {
    const cents = deviations[index] ?? 0;
    const actual = { start: note.start + offset + (delay[index] ?? 0), end: note.end + offset + (delay[index] ?? 0) };
    return { status: missing.includes(index) ? 'missed' : cents >= 50 || cents <= -50 ? 'wrongNote' : cents > 25 ? 'sharp' : cents < -25 ? 'flat' : 'inTune', cents, ...actual };
  });
  return { name, notes, duration: notes.at(-1).end + .26, truth, level, noise, variant, hum };
}
export const takes = [
  take('ordinary', phrase.slice(0, 6), .5),
  take('ordinary_late_55', phrase.slice(0, 6), .5, { offset: .055, variant: 1 }),
  take('ordinary_early_45', phrase.slice(0, 6), .5, { offset: -.045, variant: 2 }),
  take('deviations', phrase.slice(0, 8), .5, { variant: 1, deviations: { 1: 36, 2: -38, 3: 100, 4: -100, 6: 44, 7: -44 } }),
  take('missed', phrase.slice(0, 8), .25, { missing: [0, 2, 6], variant: 2, noise: .012 }),
  take('silence', phrase.slice(0, 8), .25, { missing: [0, 1, 2, 3, 4, 5, 6, 7], noise: 0 }),
  take('noise', phrase.slice(0, 8), .125, { missing: [0, 1, 2, 3, 4, 5, 6, 7], noise: .027 }),
  take('bass_harmonic', bass, .25, { variant: 1, deviations: { 2: -36, 4: 39 }, noise: .008 }),
  take('short_125', phrase, .125, { variant: 1, missing: [3, 8], deviations: { 1: 38, 6: -38 } }),
  take('short_125_late_55', phrase, .125, { offset: .055, variant: 1, missing: [3, 8], deviations: { 1: 38, 6: -38 } }),
  take('short_125_early_45', phrase, .125, { offset: -.045, variant: 2, missing: [3, 8], deviations: { 1: 38, 6: -38 } }),
  take('short_62', phrase, .0625),
  take('short_62_late_35', phrase, .0625, { offset: .035, variant: 2, missing: [3, 8] }),
  take('short_62_early_30', phrase, .0625, { offset: -.03, variant: 1, missing: [3, 8] }),
  take('short_62_bass', bass, .0625, { variant: 1, level: .09, noise: .009, deviations: { 2: -40, 6: 40 } }),
];
export function samplesFor(fixture, rate, lead = 0) {
  const { notes, truth, variant, level, noise, duration } = fixture;
  let seed = 7001;
  const rand = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 4294967296 * 2 - 1; };
  const pcm = Float32Array.from({length: Math.round((duration + lead) * rate)}, () => noise * rand());
  for (let index = 0; index < notes.length; index++) {
    if (truth[index].status === 'missed') continue;
    const { start, end, cents } = truth[index];
    const begin = Math.round((start + lead) * rate), finish = Math.round((end + lead) * rate);
    let carrier = index * 1.9;
    for (let sample = begin; sample < finish; sample++) {
      const time = (sample - begin) / rate;
      const bend = -23 * Math.exp(-time * 210);
      const vibrato = 16 * Math.sin(time * Math.PI * 2 * 5.1 + index * .34);
      const pitch = 440 * 2 ** ((notes[index].midi + (cents + vibrato + bend) / 100 - 69) / 12);
      carrier += pitch * Math.PI * 2 / rate;
      if (sample < 0 || sample >= pcm.length) continue;
      const gain = Math.min(1, time / .012, (finish - sample) / rate / .016) * (.9 + .08 * Math.sin(Math.PI * 2 * 2.7 * time));
      let vocal = 0;
      for (const [i, weight] of voices[variant].entries()) vocal += weight * Math.sin(carrier * (i + 1) + i * .44);
      pcm[sample] += gain * level * vocal + .016 * Math.exp(-time / .01) * rand();
    }
  }
  return pcm;
}
