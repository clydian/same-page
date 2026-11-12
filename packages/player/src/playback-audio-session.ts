type Session = { type: string };
type AudioNavigator = { userAgent: string; platform: string; maxTouchPoints: number; audioSession?: Session };

/** Declare intentional media playback without changing system volume or autoplay policy. */
export function playbackAudioSession(nav: AudioNavigator | undefined = typeof navigator === 'undefined' ? undefined : navigator) {
  const ios = Boolean(nav && (/iPad|iPhone|iPod/.test(nav.userAgent) || nav.platform === 'MacIntel' && nav.maxTouchPoints > 1));
  let owned: { session: Session; previous: string } | undefined;
  return {
    request(): string | undefined {
      try {
        const session = nav?.audioSession;
        if (session) {
          const previous = session.type;
          session.type = 'playback';
          if (session.type === 'playback') {
            owned ??= { session, previous };
            return;
          }
        }
      } catch { /* Unsupported or rejected declarations must not block playback. */ }
      return ios ? '此设备在静音模式下可能无法播放练习音频。若无声，请关闭静音模式并检查媒体音量。' : undefined;
    },
    release() {
      const lease = owned;
      owned = undefined;
      try {
        // A later owner may have changed the category; preserve its choice.
        if (lease?.session.type === 'playback') lease.session.type = lease.previous;
      } catch { /* Teardown must still stop the synthesizer. */ }
    },
  };
}
