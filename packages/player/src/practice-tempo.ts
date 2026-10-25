import type { MusicXmlTempoMeasure } from './musicxml-metronome.ts';

type PlaybackBar = {
  start: number; end: number;
  masterBar: { index: number };
  tempoChanges?: readonly { tick: number; tempo: number }[];
};

/** Read the same expanded playback timeline as the synthesizer, including repeats
 * and boundary/mid-bar tempo changes. BPM is always quarter-normalized internally. */
export function playbackTempo(bars: readonly PlaybackBar[], tick: number, source: readonly MusicXmlTempoMeasure[] = []): { bpm: number; unit: number } {
  let bpm = 120, unit = 1;
  for (const bar of bars) {
    if (bar.start > tick) break;
    for (const change of bar.tempoChanges ?? []) {
      if (change.tick <= tick) bpm = change.tempo;
    }
    for (const event of source[bar.masterBar.index]?.events ?? []) {
      if (bar.start + Math.round(event.quarter * 960) > tick) break;
      unit = event.unitQuarters ?? 1;
    }
  }
  return { bpm, unit };
}
