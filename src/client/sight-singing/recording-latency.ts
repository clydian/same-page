export const recordingMarginMs = 700;
export const latencyStepMs = 10;

export function recordingLatency(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(-recordingMarginMs, Math.min(recordingMarginMs, Math.round(value)));
}

// A short swept tone is easier to distinguish from room noise or a steady hum.
export const calibrationTimes = [.25, 1.25, 2.25];
export const calibrationDuration = 3.05;

export function calibrationTone(sampleRate: number) {
  const length = Math.round(sampleRate * .032);
  return Float32Array.from({ length }, (_, index) => {
    const time = index / sampleRate;
    return .25 * Math.sin(2 * Math.PI * (600 * time + 1450 * time * time / .032)) *
      Math.sin(Math.PI * index / length) ** 2;
  });
}

export function estimateRecordingLatency(input: Float32Array, tone: Float32Array, sampleRate: number) {
  // First locate candidates at reduced resolution, then check that all three
  // pulses give the same delay. Missing or ambiguous signals leave settings alone.
  const stride = Math.max(1, Math.floor(sampleRate / 12000));
  let toneEnergy = 0;
  for (let index = 0; index < tone.length; index += stride) toneEnergy += tone[index] ** 2;
  const maxLag = Math.floor(recordingMarginMs * sampleRate / 1000);
  const ambiguity = Math.round(sampleRate * .012);
  const hits = calibrationTimes.map(time => {
    const start = Math.round(time * sampleRate);
    const peaks = new Float32Array(Math.floor(maxLag / stride) + 1);
    let best = 0;
    for (let slot = 0; slot < peaks.length; slot++) {
      let dot = 0, energy = 0;
      const from = start + slot * stride;
      if (from + tone.length > input.length) break;
      for (let index = 0; index < tone.length; index += stride) {
        const sample = input[from + index];
        dot += sample * tone[index];
        energy += sample ** 2;
      }
      if (energy > .000004 * tone.length / stride) peaks[slot] = Math.abs(dot) / Math.sqrt(energy * toneEnergy);
      if (peaks[slot] > peaks[best]) best = slot;
    }
    const competing = peaks.some((peak, index) => Math.abs(index - best) * stride > ambiguity && peak > peaks[best] * .88);
    return peaks[best] >= .32 && !competing ? best * stride : null;
  });
  const consistent = hits.filter((hit): hit is number => hit !== null).sort((a, b) => a - b);
  if (consistent.length < 2 || consistent[consistent.length - 1] - consistent[0] > sampleRate * .008) return null;
  return Math.round(1000 * (consistent[0] + consistent[consistent.length - 1]) / (2 * sampleRate));
}

export function recordingOffsetFrames(sampleRate: number, latencyMs: number) {
  return Math.round(sampleRate * recordingMarginMs / 1000) + Math.round(sampleRate * latencyMs / 1000);
}
