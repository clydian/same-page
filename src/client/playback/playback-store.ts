import type { ScoreAttachment } from '../../shared/attachments';
import type { ScoreSummary } from '../../shared/scores';
import { onNavigationReset } from '../settings/navigation-events';
export interface PlaybackSource { attachment: ScoreAttachment; score: ScoreSummary; choirId: string; ownerKey: string; sessionId: string | null; experience?: boolean }
let source: PlaybackSource | null = null;
let generation = 0;
export type PlaybackView = 'pdf' | 'xml' | 'compare';
let view: PlaybackView = 'pdf';
const listeners = new Set<() => void>();
const viewListeners = new Set<() => void>();
export const playbackViewStore = {
  getSnapshot: () => view,
  subscribe(listener: () => void) { viewListeners.add(listener); return () => { viewListeners.delete(listener); }; },
};
export function setPlaybackView(next: PlaybackView) {
  if (next !== 'pdf' && source?.attachment.kind !== 'musicxml') return;
  view = next;
  viewListeners.forEach(listener => listener());
}
export const playbackStore = {
  getSnapshot: () => source,
  getGeneration: () => generation,
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
};
export function stopPlayback() { source = null; setPlaybackView('pdf'); listeners.forEach(listener => listener()); }
export function startPlayback(next: PlaybackSource) {
  // Each explicit opening is a new session; view switching uses setPlaybackView.
  source = { ...next };
  generation += 1;
  setPlaybackView(next.attachment.kind === 'musicxml' ? 'xml' : 'pdf');
  listeners.forEach(listener => listener());
}
onNavigationReset(stopPlayback);
