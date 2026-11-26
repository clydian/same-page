import { useEffect, useState } from 'react';
import { recordingLatency } from './recording-latency';

export type ChallengeMix = { voice: number; backing: number; tonic: number; metronome: boolean; latency: number };
const defaults: ChallengeMix = { voice: 1, backing: 1, tonic: 1, metronome: true, latency: 0 };

function readMix(key: string): ChallengeMix {
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? 'null') as Partial<ChallengeMix> | null;
    const level = (value: unknown) => typeof value === 'number' && value >= 0 && value <= 1 ? value : 1;
    return { voice: level(saved?.voice), backing: level(saved?.backing), tonic: level(saved?.tonic), metronome: saved?.metronome !== false,
      latency: recordingLatency(saved?.latency) };
  } catch {
    return defaults;
  }
}

export function useChallengeMix(userId: string) {
  const key = `same-page:sight-singing-mix:${userId}`;
  const [mix, setMix] = useState(() => readMix(key));
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(mix)); } catch { /* This session still works without storage. */ }
  }, [key, mix]);
  return [mix, setMix] as const;
}
