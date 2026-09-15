import type { PlayerSession, PlayerState } from '@itscly2026/chorus-player';
import type { PlaybackSource } from './playback-store';
const keyFor = (source: PlaybackSource) => `same-page.practice:${JSON.stringify([source.ownerKey,source.choirId,source.attachment.id,source.attachment.revision])}`;
/** Best-effort private device preferences; never authority or a modified score. */
export function rememberPractice(session: PlayerSession, source: PlaybackSource) {
  let restored = false;
  const key = keyFor(source);
  const changed = () => {
    const state = session.getSnapshot();
    if (state.status !== 'ready') return;
    if (!restored) {
      restored = true;
      let saved: Partial<PlayerState> | null = null;
      try { saved = JSON.parse(localStorage.getItem(key) ?? 'null'); } catch { /* Storage is optional. */ }
      if (saved && typeof saved === 'object') {
        if (typeof saved.speed === 'number' && Number.isFinite(saved.speed)) session.speed(saved.speed);
        if (Array.isArray(saved.parts)) for (const part of saved.parts) {
          if (part && Number.isInteger(part.id) && typeof part.volume === 'number' && Number.isFinite(part.volume) && typeof part.muted === 'boolean' && typeof part.solo === 'boolean') session.mix(part.id, { volume: part.volume, muted: part.muted, solo: part.solo });
        }
        if (saved.focus === null || typeof saved.focus === "number" && Number.isInteger(saved.focus) && state.parts.some(part => part.id === saved.focus)) session.focus(saved.focus);
        if (Number.isInteger(saved.measure)) session.seek(saved.measure!);
      }
      return;
    }
    try { localStorage.setItem(key, JSON.stringify({ speed:state.speed,focus:state.focus,parts:state.parts,measure:state.measure })); } catch { /* Quota/private mode never blocks playback. */ }
  };
  const release = session.subscribe(changed); changed(); return release;
}
