import { expect, it } from 'vitest';
import type { PitchFrame } from './pitch-feedback';
import { createPitchViewport } from './pitch-viewport';

function simulate(observe: (time: number) => number | null, { span = 24, reducedMotion = false, start = 60 } = {}) {
  const viewport = createPitchViewport();
  const frames: PitchFrame[] = [];
  let center = start;
  return Array.from({ length: 129 }, (_, index) => {
    const through = index * .008;
    frames.push({ time: through, midi: observe(through) });
    center = viewport.step({ frames, center, span, through, now: index * 8, reducedMotion });
    return center;
  });
}

it('holds a natural edge margin and ignores an isolated jump in either direction', () => {
  for (const side of [-1, 1]) {
    for (const reducedMotion of [false, true]) {
      const positions = simulate(time => time >= .16 && time < .2 ? 60 + side * 24 : 60 + side * 6, { reducedMotion });
      expect(positions.every(center => center === 60)).toBe(true);
    }
  }
});

it.each([60, null])('drops the aim from a just-confirmed jump when the pitch becomes %s', after => {
  for (const side of [-1, 1]) {
    const positions = simulate(time => time < .16 ? 60 : time < .272 ? 60 + side * 24 : after);
    expect((positions[33] - 60) * side).toBeGreaterThan(0);
    // A returning note cancels on its first reading. Silence allows the
    // same short gap as the detector's trailing analysis windows.
    const stop = after === null ? 36 : 33;
    expect(positions.slice(stop).every(center => center === positions[stop])).toBe(true);
  }
});

it.each([-1, 1])('moves progressively after a sustained leap and keeps up with a glide in direction %i', side => {
  for (const span of [6, 24]) {
    const positions = simulate(time => time < .16 ? 60 : 60 + side * 24, { span });
    expect(positions.slice(0, 30).every(center => center === 60)).toBe(true);
    expect((positions[35] - 60) * side).toBeGreaterThan(0);
    expect((positions[35] - 60) * side).toBeLessThan(10);
    expect((positions.at(-1)! - 60) * side).toBeCloseTo(24 - span * .22, 0);
    const glide = simulate(time => 60 + side * time * 12, { span });
    const finalPitch = 60 + side * (glide.length - 1) * .008 * 12;
    expect(Math.abs(glide.at(-1)! - finalPitch)).toBeLessThan(span / 2);
  }
});

it('honors reduced motion after confirmation and resets an old aim on a seek', () => {
  const positions = simulate(time => time < .16 ? 60 : 84, { reducedMotion: true });
  expect(positions[30]).toBe(60);
  expect(positions[33]).toBeCloseTo(84 - 24 * .22);
  const viewport = createPitchViewport();
  const frames = Array.from({ length: 25 }, (_, index) => ({ time: index * .008, midi: 84 }));
  const center = viewport.step({ center: 60, span: 24, frames, through: .192, now: 192 });
  expect(center).toBeGreaterThan(60);
  expect(viewport.step({ center, span: 24, frames, through: 0, now: 208 })).toBe(center);
});
