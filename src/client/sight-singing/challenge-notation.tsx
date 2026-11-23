import { AlphaTabApi, NotationElement, PlayerMode } from '@coderline/alphatab';
import { useEffect, useRef } from 'react';
import { useMessages } from '../../i18n';
import type { Melody, MelodyScore, MelodyVoice } from './melody';

export function ChallengeNotation({ score, voice, melody, currentBar, beatIndex }: {
  score: MelodyScore['score']; voice: MelodyVoice; melody: Melody; currentBar?: number; beatIndex?: number;
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
      display: { scale: 1, startBar: min + 1, barCount: max - min + 1, justifyLastSystem: true },
      player: { playerMode: PlayerMode.Disabled, enableUserInteraction: false },
    });
    api.settings.notation.elements.set(NotationElement.ScoreTitle, false);
    api.settings.notation.elements.set(NotationElement.ScoreSubTitle, false);
    api.updateSettings();
    player.current = api;
    api.renderScore(score, [voice.track]);
    return () => { player.current = null; api.destroy(); };
  }, [score, voice.track, min, max]);
  useEffect(() => {
    const api = player.current, host = viewport.current, marker = cursor.current, noteMarker = beatCursor.current;
    if (!api || !host || !marker || !noteMarker) return;
    const bar = currentBar === undefined ? undefined : score.tracks[voice.track].staves[voice.staff].bars[currentBar];
    const beat = beatIndex === undefined ? undefined : bar?.voices[voice.voice]?.beats[beatIndex];
    const show = () => {
      const bounds = currentBar === undefined ? undefined : api.boundsLookup?.findMasterBarByIndex(currentBar)?.realBounds;
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
