import { useRef, useState } from 'react';
import { useLibraryAttachments } from '../score-library/attachments/use-library-attachments';
import { Button, Popover, Tooltip, TooltipTrigger } from 'react-aria-components';
import { FileMusic, Volume2 } from 'lucide-react';
import { Dialog } from '../navigation/overlays';
import { useApplicationIdentity } from '../auth/application-identity';
import { startPlayback, type PlaybackSource } from './playback-store';
import './practice-player.css';

type Kind = 'audio' | 'musicxml';
export function ReaderPracticeLauncher({ source, enabled, open, onOpenChange }: { source: Omit<PlaybackSource, 'attachment'>; enabled: boolean; open: boolean; onOpenChange(open: boolean): void }) {
  const identity = useApplicationIdentity();
  const current = identity.onlineState === 'authenticated' || identity.onlineState === 'signed-out';
  const active = enabled && current && identity.authenticatedSessionId === source.sessionId;
  const metadata = useLibraryAttachments(source.choirId, [source.score], active, `${source.ownerKey}:${source.sessionId ?? 'guest'}`);
  const items = metadata.items.filter(item => (item.kind === 'musicxml' || item.kind === 'audio') && !item.trashExpiresAt);
  const [kind, setKind] = useState<Kind>('audio');
  const audioTrigger = useRef<HTMLButtonElement>(null), xmlTrigger = useRef<HTMLButtonElement>(null);
  const title = kind === 'audio' ? '音频附件' : 'MusicXML 附件';
  return <>
    <div className="reader-playback-entries" aria-label="可播放附件">
      {metadata.error && !items.length && <div className="reader-playback-error" role="status">附件暂不可用<Button onPress={metadata.retry}>重试</Button></div>}
      {(['audio', 'musicxml'] as const).filter(type => items.some(item => item.kind === type)).map(type => {
        const label = type === 'audio' ? '音频附件' : 'MusicXML 附件';
        return <TooltipTrigger key={type}><Button ref={type === 'audio' ? audioTrigger : xmlTrigger} className="reader-playback-entry" aria-label={label} aria-expanded={open && kind === type} onPress={() => { setKind(type); onOpenChange(!(open && kind === type)); }}>
          {type === 'audio' ? <Volume2 size={21} aria-hidden="true" /> : <FileMusic size={21} aria-hidden="true" />}
        </Button><Tooltip className="practice-tooltip" placement="top">{label}</Tooltip></TooltipTrigger>;
      })}
    </div>
    {open && <Popover triggerRef={kind === 'audio' ? audioTrigger : xmlTrigger} isOpen onOpenChange={onOpenChange} placement="top end" offset={10} className="practice-popover">
      <Dialog className="practice-panel reader-practice-launcher" aria-label={title}>
        <h2>{title}</h2>
        {!active ? <p>联网并确认访问后，可打开本谱的播放附件。</p> : metadata.error ? <p role="status">暂时无法读取附件。<Button onPress={metadata.retry}>重试</Button></p>
          : items.filter(item => item.kind === kind).map(attachment => <Button className="reader-practice-source" key={attachment.id} aria-label={attachment.name} onPress={() => { startPlayback({ ...source, attachment }); onOpenChange(false); }}>
            {kind === 'audio' ? <Volume2 size={18} aria-hidden="true" /> : <FileMusic size={18} aria-hidden="true" />}<span>{attachment.name}</span>
          </Button>)}
      </Dialog>
    </Popover>}
  </>;
}
