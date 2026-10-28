import { useEffect, useState } from 'react';
import { Button } from 'react-aria-components';

export type PlaybackPreparationProgress = { message: string; loaded?: number; total?: number };

/** A single current phase, with real byte progress only when its total is known. */
export function PlaybackPreparationNotice({ message, loaded, total, retry }: PlaybackPreparationProgress & { retry(): void }) {
  const [attempt, setAttempt] = useState(0);
  const [slowMessage, setSlowMessage] = useState<string | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => setSlowMessage(message), 30_000);
    return () => clearTimeout(timer);
  }, [message, attempt]);
  const known = Number.isFinite(loaded) && Number.isFinite(total) && total! > 0 && loaded! >= 0;
  const value = known ? Math.min(loaded!, total!) : undefined;
  return <div className="practice-notice practice-preparation" role="status">
    <div className="practice-preparation-label"><span>{message}</span>{known && <span className="practice-preparation-value">{Math.floor(value! / total! * 100)}%</span>}</div>
    <progress aria-label={message} max={known ? total : undefined} value={value} />
    {slowMessage === message && <div className="practice-preparation-slow"><span>准备时间较长，可以继续等待。</span><Button onPress={() => { setSlowMessage(null); setAttempt(value => value + 1); retry(); }}>重试</Button></div>}
  </div>;
}
