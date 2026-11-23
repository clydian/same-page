import { AlphaTabApi, PlayerMode } from '@coderline/alphatab';
import { useEffect, useRef } from 'react';
import { useMessages } from '../../i18n';
import { targetPitches, type Melody, type MelodyScore, type MelodyVoice } from './melody';
import type { PitchFrame } from './pitch-feedback';

export function ChallengeNotation({ score, voice, melody, currentBar, beatIndex }: {
  score: MelodyScore['score']; voice: MelodyVoice; melody: Melody; currentBar: number; beatIndex?: number;
}) {
  const t = useMessages('practice');
  const viewport = useRef<HTMLDivElement>(null), notation = useRef<HTMLDivElement>(null), cursor = useRef<HTMLDivElement>(null);
  const beatCursor = useRef<HTMLDivElement>(null);
  const player = useRef<AlphaTabApi | null>(null);
  const min = melody.measures.reduce((value, bar) => Math.min(value, bar.bar), Infinity);
  const max = melody.measures.reduce((value, bar) => Math.max(value, bar.bar), -Infinity);
  useEffect(() => {
    if (!notation.current) return;
    const api = new AlphaTabApi(notation.current, {
      core: { fontDirectory: '/font/', engine: 'svg' },
      display: { scale: .75, startBar: min + 1, barCount: max - min + 1 },
      player: { playerMode: PlayerMode.Disabled, enableUserInteraction: false },
    });
    player.current = api;
    api.renderScore(score, [voice.track]);
    return () => { player.current = null; api.destroy(); };
  }, [score, voice.track, min, max]);
  useEffect(() => {
    const api = player.current, host = viewport.current, marker = cursor.current, noteMarker = beatCursor.current;
    if (!api || !host || !marker || !noteMarker) return;
    const bar = score.tracks[voice.track].staves[voice.staff].bars[currentBar];
    const beat = beatIndex === undefined ? undefined : bar?.voices[voice.voice]?.beats[beatIndex];
    const show = () => {
      const bounds = api.boundsLookup?.findMasterBarByIndex(currentBar)?.realBounds;
      const hit = beat && api.boundsLookup?.findBeat(beat);
      marker.hidden = !bounds;
      noteMarker.hidden = !hit;
      if (!bounds) return;
      Object.assign(marker.style, { left: `${bounds.x}px`, top: `${bounds.y}px`, width: `${bounds.w}px`, height: `${bounds.h}px` });
      if (hit) Object.assign(noteMarker.style, { left: `${hit.onNotesX - 2}px`, top: `${bounds.y}px`, height: `${bounds.h}px` });
      if (bounds.y < host.scrollTop || bounds.y + bounds.h > host.scrollTop + host.clientHeight) host.scrollTop = Math.max(0, bounds.y - 12);
      const x = hit?.onNotesX ?? bounds.x;
      if (x < host.scrollLeft || x > host.scrollLeft + host.clientWidth - 12) host.scrollLeft = Math.max(0, x - 24);
    };
    show();
    api.postRenderFinished.on(show);
    return () => api.postRenderFinished.off(show);
  }, [score, voice, min, max, currentBar, beatIndex]);
  return <div ref={viewport} className="challenge-notation" role="img" aria-label={t('sight.notation')}>
    <div className="challenge-notation-sheet">
      <div ref={notation} />
      <div ref={cursor} className="challenge-notation-cursor" hidden />
      <div ref={beatCursor} className="challenge-notation-beat" hidden />
    </div>
  </div>;
}

export function PitchGraph({ melody, frames, elapsed, review }: { melody: Melody; frames: PitchFrame[]; elapsed: number; review: boolean }) {
  const t = useMessages('practice');
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const drawing = canvas.current?.getContext('2d');
    if (!drawing || !canvas.current) return;
    const { width, height } = canvas.current;
    const start = review ? 0 : Math.max(0, Math.min(melody.duration - 12, Math.floor(elapsed / 6) * 6));
    const end = review ? melody.duration : Math.min(melody.duration, start + 12);
    const notes = melody.notes.filter(note => note.start < end && note.end > start);
    const range = notes.length ? notes : melody.notes;
    const targets = range.flatMap(targetPitches);
    const low = targets.reduce((value, midi) => Math.min(value, midi), Infinity) - 4;
    const high = targets.reduce((value, midi) => Math.max(value, midi), -Infinity) + 4;
    const x = (time: number) => (time - start) / (end - start) * width;
    const y = (pitch: number) => 12 + (high - pitch) / (high - low) * (height - 24);
    drawing.clearRect(0, 0, width, height);
    drawing.fillStyle = '#768e96';
    for (const bar of melody.measures) if (bar.start > start && bar.start < end) drawing.fillRect(x(bar.start), 0, 1, height);
    drawing.fillStyle = '#548d85';
    for (const note of notes) for (const midi of targetPitches(note)) drawing.fillRect(x(note.start), y(midi) - 4, Math.max(2, x(note.end) - x(note.start) - 2), 8);
    drawing.fillStyle = '#cf673c';
    for (let index = frames.length - 1; index >= 0; index--) {
      const frame = frames[index];
      if (frame.time < start) break;
      if (frame.midi === null || frame.time > end) continue;
      const position = Math.max(6, Math.min(height - 6, y(frame.midi)));
      drawing.fillRect(x(frame.time), position - 2, 3, 4);
    }
    if (elapsed > 0 && elapsed < end) {
      drawing.fillStyle = '#7c989f';
      drawing.fillRect(x(elapsed), 0, 2, height);
    }
  }, [melody, frames, elapsed, review]);
  return <figure className="challenge-graph">
    <canvas ref={canvas} width={900} height={174} role="img" aria-label={t('sight.pitchGraph')} />
    <figcaption><span>{t('sight.targetLegend')}</span><span>{t('sight.voiceLegend')}</span></figcaption>
  </figure>;
}
