import { useLibraryAttachments } from '../score-library/attachments/use-library-attachments';
import { Button } from 'react-aria-components';
import { Music, Headphones } from 'lucide-react';
import { useApplicationIdentity } from '../auth/application-identity';
import { startPlayback, type PlaybackSource } from './playback-store';
import '../playback/practice-player.css';

export function ReaderPracticeLauncher({ source, enabled, onStarted }: { source: Omit<PlaybackSource, 'attachment'>; enabled: boolean; onStarted(): void }) {
  const identity = useApplicationIdentity();
  const current = identity.onlineState === 'authenticated' || identity.onlineState === 'signed-out';
  const active = enabled && current && identity.authenticatedSessionId === source.sessionId;
  const metadata = useLibraryAttachments(source.choirId, [source.score], active, `${source.ownerKey}:${source.sessionId ?? 'guest'}`);
  const items = metadata.items.filter(item => (item.kind === 'musicxml' || item.kind === 'audio') && !item.trashExpiresAt);
  return <section className="reader-practice-launcher" aria-label="练习播放">
    <h2>练习播放</h2>
    {!active ? <p>联网并确认访问后，可打开本谱的练习音源。</p> : metadata.statusFor(source.score.id) === 'loading' ? <p role="status">正在读取音源…</p>
      : metadata.error ? <p role="status">暂时无法读取音源。<Button onPress={metadata.retry}>重试</Button></p>
      : items.length ? items.map(attachment => <Button className="reader-practice-source" key={attachment.id} onPress={() => { startPlayback({ ...source, attachment }); onStarted(); }}>
        {attachment.kind === 'musicxml' ? <Music size={18} aria-hidden="true" /> : <Headphones size={18} aria-hidden="true" />}<span>{attachment.name}</span>
      </Button>) : <p>本谱暂没有可播放的附件。</p>}
  </section>;
}
