import { lazy, Suspense, useRef, useState } from 'react';
import { useLibraryAttachments } from '../score-library/attachments/use-library-attachments';
import { Button, Popover, Tooltip, TooltipTrigger } from 'react-aria-components';
import { FileAudio, FileMusic, FileText, Link as LinkIcon, Paperclip, Play } from 'lucide-react';
import { Dialog } from '../navigation/overlays';
import { useApplicationIdentity } from '../auth/application-identity';
import { startPlayback, type PlaybackSource } from './playback-store';
import type { AttachmentSelection } from '../score-library/attachments/attachment-list';
import { safeAttachmentUrl } from '../../shared/attachments';
import './practice-player.css';
const AttachmentDialog = lazy(() => import('../score-library/attachments/attachment-dialog'));
export function ReaderPracticeLauncher({ source, enabled, open, onOpenChange }: { source: Omit<PlaybackSource, 'attachment'>; enabled: boolean; open: boolean; onOpenChange(open: boolean): void }) {
  const identity = useApplicationIdentity();
  const current = identity.onlineState === 'authenticated' || identity.onlineState === 'signed-out';
  const active = enabled && current && identity.authenticatedSessionId === source.sessionId;
  const metadata = useLibraryAttachments(source.choirId, [source.score], active, `${source.ownerKey}:${source.sessionId ?? 'guest'}`, source.ownerKey);
  const items = metadata.items.filter(item => !item.trashExpiresAt);
  const playable = items.some(item => item.kind === 'audio' || item.kind === 'musicxml');
  const trigger = useRef<HTMLButtonElement>(null);
  const [selection, setSelection] = useState<AttachmentSelection | null>(null);
  return <>
    <div className="reader-playback-entries" aria-label="乐谱附件">
      <TooltipTrigger><Button ref={trigger} className="reader-playback-entry" aria-label="本谱附件" aria-description={playable ? '含可播放附件' : undefined} aria-expanded={open} onPress={() => onOpenChange(!open)}>
        <Paperclip size={21} aria-hidden="true" />{playable && <Play className="attachment-play-badge" size={12} fill="currentColor" aria-hidden="true" />}
      </Button><Tooltip className="practice-tooltip" placement="top">本谱附件</Tooltip></TooltipTrigger>
    </div>
    {open && <Popover triggerRef={trigger} isOpen onOpenChange={onOpenChange} placement="top end" offset={10} className="practice-popover">
      <Dialog className="practice-panel reader-practice-launcher" aria-label="本谱附件">
        <h2>本谱附件</h2>
        {!active && <p role="status">连接网络并确认访问后可打开附件。</p>}
        {metadata.error && <p role="status">暂时无法读取附件。<Button onPress={metadata.retry}>重试</Button></p>}
        {metadata.loading && !items.length && <p role="status">正在读取附件…</p>}
        {items.map(attachment => {
          const canPlay = attachment.kind === 'audio' || attachment.kind === 'musicxml';
          const Icon = attachment.kind === 'musicxml' ? FileMusic : attachment.kind === 'audio' ? FileAudio : attachment.kind === 'link' ? LinkIcon : FileText;
          const content = <><Icon size={20} aria-hidden="true" /><span>{attachment.name}<small>{{audio:'音频附件',musicxml:'可播放乐谱',pdf:'PDF 附件',markdown:'文档',link:'链接'}[attachment.kind]}{attachment.source === "generated" ? " · 自动生成 · Beta" : ""}</small></span>{canPlay && <Play size={16} aria-hidden="true" />}</>;
          return attachment.kind === 'link' && active ? <a key={attachment.id} className="reader-practice-source" href={safeAttachmentUrl(attachment.url ?? '')} target="_blank" rel="noopener noreferrer">{content}</a> : <Button className="reader-practice-source" key={attachment.id} aria-label={attachment.name} isDisabled={!active} onPress={() => {
            if (canPlay) startPlayback({ ...source, attachment });
            else setSelection({score:source.score,attachment,action:'open'});
            onOpenChange(false);
          }}>{content}</Button>;
        })}
        {!metadata.loading && !metadata.error && active && !items.length && <p>暂无附件</p>}
      </Dialog>
    </Popover>}
    {selection && <Suspense fallback={null}><AttachmentDialog selection={selection} choirId={source.choirId} ownerKey={source.ownerKey} canModify={false} writable={false} onClose={() => setSelection(null)} onChanged={async () => { metadata.retry(); }} /></Suspense>}
  </>;
}
