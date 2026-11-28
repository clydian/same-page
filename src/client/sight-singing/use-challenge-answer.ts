import { useEffect, useState } from 'react';
import { mixPianoAnswer } from './challenge-audio';
import type { assessNotes } from './pitch-feedback';
import type { ChallengeMix } from './use-challenge-mix';

type Review = ReturnType<typeof assessNotes>;
type Answer = { status: 'ready'; url: string } | { status: 'failed' };

function pianoNotes(review: Review) {
  const octaves = new Map<number, number>();
  for (const row of review) if (row.octave !== null && row.status !== 'wrongNote') {
    octaves.set(row.octave, (octaves.get(row.octave) ?? 0) + 1);
  }
  const sungOctave = [...octaves].sort((a, b) => b[1] - a[1] || Math.abs(a[0]) - Math.abs(b[0]))[0]?.[0] ?? 0;
  return review.map(row => ({ ...row.note,
    midi: (row.target ?? row.note.midi) + 12 * (row.octave ?? sungOctave),
    chord: row.target === null ? row.note.chord?.map(midi => midi + 12 * sungOctave) : undefined,
  }));
}

export function useChallengeAnswer(recording: Blob | undefined, review: Review | undefined,
  { voice, answer: piano }: Pick<ChallengeMix, 'voice' | 'answer'>, duration: number, latency: number) {
  const [attempt, setAttempt] = useState(0);
  const [prepared, setPrepared] = useState<{ recording: Blob; review: Review; voice: number; piano: number; latency: number; attempt: number; answer: Answer }>();
  const current = prepared && prepared.recording === recording && prepared.review === review && prepared.latency === latency &&
    prepared.voice === voice && prepared.piano === piano && prepared.attempt === attempt;
  if (prepared && !current) setPrepared(undefined);
  useEffect(() => {
    if (!recording || !review) return;
    let active = true;
    let url: string | undefined;
    // Coalesce range input events before rendering another full recording.
    const timer = setTimeout(async () => {
      try {
        const mixed = await mixPianoAnswer(recording, pianoNotes(review), voice, piano, duration, latency);
        if (!active) return;
        url = URL.createObjectURL(mixed);
        setPrepared({ recording, review, voice, piano, latency, attempt, answer: { status: 'ready', url } });
      } catch {
        if (active) setPrepared({ recording, review, voice, piano, latency, attempt, answer: { status: 'failed' } });
      }
    }, 150);
    return () => {
      active = false;
      clearTimeout(timer);
      if (url) URL.revokeObjectURL(url);
    };
  }, [recording, review, voice, piano, duration, latency, attempt]);

  const answer = current ? prepared.answer : { status: 'preparing' as const };
  return { answer, retryAnswer: () => setAttempt(value => value + 1) };
}
