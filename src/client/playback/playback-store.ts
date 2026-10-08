import type { ScoreAttachment } from '../../shared/attachments';
import type { ScoreSummary } from '../../shared/scores';
import { onNavigationReset } from '../settings/navigation-events';
export interface PlaybackSource { attachment: ScoreAttachment; score: ScoreSummary; choirId: string; ownerKey: string; sessionId: string | null }
let source: PlaybackSource | null = null;
const listeners = new Set<() => void>();
export const playbackStore = {
  getSnapshot: () => source,
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
};
export function stopPlayback() { source = null; listeners.forEach(listener => listener()); }
export function startPlayback(next: PlaybackSource) { source = next; listeners.forEach(listener => listener()); }
onNavigationReset(stopPlayback);
