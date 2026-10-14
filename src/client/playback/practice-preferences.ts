import type { PlayerSession, PlayerState } from '@clydian/chorus-player';
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
          if (part && Number.isInteger(part.id) && typeof part.volume === 'number' && Number.isFinite(part.volume) && typeof part.muted === 'boolean' && typeof part.solo === 'boolean') session.mix(part.id, { volume: part.baseVolume ?? part.volume, muted: part.muted, solo: part.solo });
        }
        if (typeof saved.otherVolume === "number" && Number.isFinite(saved.otherVolume)) session.focusOther(saved.otherVolume);
        if (saved.focus === null || typeof saved.focus === "number" && Number.isInteger(saved.focus) && state.parts.some(part => part.id === saved.focus)) session.focus(saved.focus);
        if (typeof saved.focus === 'number') {
          const focused = saved.parts?.find(part => part.id === saved.focus);
          if (focused && typeof focused.volume === 'number' && Number.isFinite(focused.volume)) session.mix(saved.focus, {volume:focused.volume});
        }
        if (Number.isInteger(saved.measure)) session.seek(saved.measure!);
      }
      return;
    }
    try { localStorage.setItem(key, JSON.stringify({ speed:state.speed,focus:state.focus,otherVolume:state.otherVolume,parts:state.parts,measure:state.measure })); } catch { /* Quota/private mode never blocks playback. */ }
  };
  const release = session.subscribe(changed); changed(); return release;
}
