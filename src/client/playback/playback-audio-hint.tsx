import { useEffect, useState } from 'react';
import { Button } from 'react-aria-components';
import { X } from 'lucide-react';
import type { PlayerSession } from '@same-page/player';

/** A compatibility hint gets one brief appearance per practice session. */
export function PlaybackAudioHint({ session, message }: { session: PlayerSession | null; message?: string }) {
  const [dismissedFor, setDismissedFor] = useState<PlayerSession | null>(null);
  const [hoveredFor, setHoveredFor] = useState<PlayerSession | null>(null);
  const [focusedFor, setFocusedFor] = useState<PlayerSession | null>(null);
  const hovered = session !== null && hoveredFor === session;
  const focused = session !== null && focusedFor === session;
  const visible = Boolean(session && message && dismissedFor !== session);
  useEffect(() => {
    if (!visible || hovered || focused) return;
    const timer = setTimeout(() => setDismissedFor(session), 8000);
    return () => clearTimeout(timer);
  }, [visible, hovered, focused, session]);
  if (!visible) return null;
  return <div className="practice-notice" aria-label="播放声音提示"
    onMouseEnter={() => setHoveredFor(session)} onMouseLeave={() => setHoveredFor(null)}
    onFocusCapture={() => setFocusedFor(session)} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocusedFor(null); }}>
    <span role="status">{message}</span>
    <Button aria-label="关闭播放声音提示" onPress={() => setDismissedFor(session)}><X size={16} aria-hidden="true" /></Button>
  </div>;
}
