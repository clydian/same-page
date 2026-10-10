import type { ScoreAttachment } from '../../shared/attachments';
import type { ScoreSummary } from '../../shared/scores';
import { onNavigationReset } from '../settings/navigation-events';
export interface PlaybackSource { attachment: ScoreAttachment; score: ScoreSummary; choirId: string; ownerKey: string; sessionId: string | null }
let source: PlaybackSource | null = null;
let notation: PlaybackSource | null = null;
let view: 'pdf' | 'xml' = 'pdf';
const listeners = new Set<() => void>();
const viewListeners = new Set<() => void>();
export const playbackViewStore = {
  getSnapshot: () => view,
  subscribe(listener: () => void) { viewListeners.add(listener); return () => { viewListeners.delete(listener); }; },
};
export function setPlaybackView(next: 'pdf' | 'xml') {
  view = next;
  viewListeners.forEach(listener => listener());
}
export const playbackStore = {
  getSnapshot: () => source,
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
};
export const playbackNotationStore = { getSnapshot: () => notation, subscribe: playbackStore.subscribe };
function sameScore(a: PlaybackSource | null, b: PlaybackSource) {
  return a?.ownerKey === b.ownerKey && a.sessionId === b.sessionId && a.choirId === b.choirId && a.score.id === b.score.id;
}
export function setPlaybackNotation(next: PlaybackSource) {
  if (!sameScore(source, next) || next.attachment.kind !== 'musicxml') return;
  notation = next;
  setPlaybackView('xml');
  listeners.forEach(listener => listener());
}
export function stopPlayback() { source = null; notation = null; setPlaybackView('pdf'); listeners.forEach(listener => listener()); }
export function startPlayback(next: PlaybackSource) {
  if (!sameScore(source, next)) { notation = null; setPlaybackView('pdf'); }
  if (next.attachment.kind === 'musicxml') {
    if (!notation || notation.attachment.id !== next.attachment.id || notation.attachment.revision !== next.attachment.revision) notation = next;
    source = notation;
  } else source = next;
  listeners.forEach(listener => listener());
}
onNavigationReset(stopPlayback);
