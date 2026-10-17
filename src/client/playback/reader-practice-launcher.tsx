import { useRef } from 'react';
import { useLibraryAttachments } from '../score-library/attachments/use-library-attachments';
import { Button, Popover, Tooltip, TooltipTrigger } from 'react-aria-components';
import { FileMusic, Play } from 'lucide-react';
import { Dialog } from '../navigation/overlays';
import { useApplicationIdentity } from '../auth/application-identity';
import { startPlayback, type PlaybackSource } from './playback-store';
import './practice-player.css';

export function ReaderPracticeLauncher({ source, enabled, open, onOpenChange }: { source: Omit<PlaybackSource, 'attachment'>; enabled: boolean; open: boolean; onOpenChange(open: boolean): void }) {
  const identity = useApplicationIdentity();
  const current = identity.onlineState === 'authenticated' || identity.onlineState === 'signed-out';
  const active = enabled && current && identity.authenticatedSessionId === source.sessionId;
  const metadata = useLibraryAttachments(source.choirId, [source.score], active, `${source.ownerKey}:${source.sessionId ?? 'guest'}`, source.ownerKey);
  const items = metadata.items.filter(item => !item.trashExpiresAt && item.kind === 'musicxml')
    .sort((left, right) => Number(right.source === 'generated') - Number(left.source === 'generated'));
  const trigger = useRef<HTMLButtonElement>(null);
  // Older local score summaries do not have musicXmlCount. Resolve their directory
  // before showing a practice entry, rather than showing it for an audio-only score.
  if (!items.length && !(source.score.musicXmlCount ?? 0)) return null;
  return <>
    <div className="reader-playback-entries" aria-label="练习谱">
      <TooltipTrigger><Button ref={trigger} className="reader-playback-entry" aria-label="练习谱" aria-expanded={open} onPress={() => onOpenChange(!open)}>
        <FileMusic size={21} aria-hidden="true" /><Play className="attachment-play-badge" size={12} fill="currentColor" aria-hidden="true" />
      </Button><Tooltip className="practice-tooltip" placement="top">练习谱</Tooltip></TooltipTrigger>
    </div>
    {open && <Popover triggerRef={trigger} isOpen onOpenChange={onOpenChange} placement="top end" offset={10} className="practice-popover">
      <Dialog className="practice-panel reader-practice-launcher" aria-label="练习谱">
        <h2>练习谱</h2>
        {!active && <p role="status">连接网络并确认访问后可打开练习谱。</p>}
        {metadata.error && <p role="status">暂时无法读取练习谱。<Button onPress={metadata.retry}>重试</Button></p>}
        {metadata.loading && !items.length && <p role="status">正在读取练习谱…</p>}
        {items.map(attachment => {
          const generated = attachment.source === 'generated';
          const name = generated ? '自动生成练习版' : attachment.name;
          return <Button className="reader-practice-source" key={attachment.id} aria-label={name} isDisabled={!active} onPress={() => {
            startPlayback({ ...source, attachment });
            onOpenChange(false);
          }}>
            <FileMusic size={20} aria-hidden="true" /><span>{name}<small>{generated ? '自动生成 · Beta' : '用户上传'}</small></span><Play size={16} aria-hidden="true" />
          </Button>;
        })}
        {!metadata.loading && !metadata.error && active && !items.length && <p>暂无练习谱</p>}
      </Dialog>
    </Popover>}
  </>;
}
