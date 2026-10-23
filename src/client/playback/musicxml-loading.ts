import { completeLoadingJourney, markLoadingMilestone, startLoadingJourney } from '../performance/loading-performance';
import type { PlayerLoadingStage } from '@same-page/player';
export type MusicXmlSourceTier = 'prepared' | 'local' | 'network' | 'offline';
type Stage = PlayerLoadingStage | 'authorized' | 'raw-ready' | 'offline-ready';
interface MusicXmlLoading {
  stage(stage: Stage): void;
  source(tier: MusicXmlSourceTier): void;
  end(reason: 'cancelled' | 'error'): void;
}
let current: MusicXmlLoading | undefined;
let ended = true;
/** Local, bounded diagnostics only: no source IDs, names, XML or user data. */
export function startMusicXmlLoading() {
  current?.end('cancelled');
  try { performance.clearMarks('same-page:open-musicxml:start'); } catch { /* Optional diagnostics. */ }
  startLoadingJourney('open-musicxml', 'direct');
  ended = false;
  let closed = false, ready = false, firstSystem = false, usable = false;
  const once = new Set<string>();
  const mark = (stage: string) => {
    if (closed || current !== tracker || once.has(stage) && stage !== 'play-request' && stage !== 'playing') return;
    once.add(stage);
    // One mark per fixed stage name; Performance's own mark buffer is bounded
    // as well as the existing loading journal's 100-record ring.
    try { performance.clearMarks(`same-page:musicxml:${stage}`); } catch { /* Optional diagnostics. */ }
    markLoadingMilestone(`musicxml:${stage}`);
  };
  const complete = (milestone: string) => {
    try { performance.clearMarks(`same-page:${milestone}`); performance.clearMeasures('same-page:open-musicxml:duration'); } catch { /* Optional diagnostics. */ }
    completeLoadingJourney('open-musicxml', milestone);
  };
  const tracker: MusicXmlLoading = {
    stage(stage) {
      mark(stage);
      if (closed || current !== tracker) return;
      if (stage === 'ready') ready = true;
      if (stage === 'first-system') firstSystem = true;
      if (!usable && ready && firstSystem) { usable = true; complete('musicxml:usable'); }
    },
    source(tier) { mark(`source:${tier}`); },
    end(reason) {
      if (closed || current !== tracker) return;
      if (usable) mark(reason); else complete(`musicxml:${reason}`);
      closed = true; ended = true;
    },
  };
  current = tracker;
  return tracker;
}
export function musicXmlLoadingTracker() { return !current || ended ? startMusicXmlLoading() : current; }
export function stopMusicXmlLoading() { current?.end('cancelled'); }
