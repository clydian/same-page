import { useMessages } from "../../i18n";
import { useLiveQuery } from 'dexie-react-hooks';
import { attachmentWorkspace, readAttachmentDirectory } from '../score-library/attachments/attachment-directory';
import { useRef } from 'react';
import { useLibraryAttachments } from '../score-library/attachments/use-library-attachments';
import { Button, Popover, Tooltip, TooltipTrigger } from 'react-aria-components';
import { FileMusic, Play } from 'lucide-react';
import { Dialog } from '../navigation/overlays';
import { useApplicationIdentity } from '../auth/application-identity';
import { startPlayback, type PlaybackSource } from './playback-store';
import './practice-player.css';

export function ReaderPracticeLauncher({ source, enabled, open, onOpenChange }: { source: Omit<PlaybackSource, 'attachment'>; enabled: boolean; open: boolean; onOpenChange(open: boolean): void }) {
  const t = useMessages("practice");
  const identity = useApplicationIdentity();
  const current = identity.onlineState === 'authenticated' || identity.onlineState === 'signed-out';
  const active = enabled && current && identity.authenticatedSessionId === source.sessionId;
  const metadata = useLibraryAttachments(source.choirId, [source.score], active, `${source.ownerKey}:${source.sessionId ?? 'guest'}`, source.ownerKey);
  // Retained PDFs intentionally contain no current attachment counters. Their
  // directory remains display metadata; opening still verifies the raw original.
  const retained = useLiveQuery(async () => {
    if (source.score.attachmentCount !== undefined) return null;
    const workspace = await attachmentWorkspace(source.ownerKey.replace(/^experience:/, ''), source.choirId, source.score.id).catch(() => null);
    return workspace ? readAttachmentDirectory(workspace, source.score, true).catch(() => null) : null;
  }, [source.ownerKey, source.choirId, source.score.id, source.score.updatedAt, source.score.attachmentCount]);
  const directoryItems = metadata.statusFor(source.score.id) === 'ready' ? metadata.items : retained ?? metadata.items;
  const items = directoryItems.filter(item => !item.trashExpiresAt && item.kind === 'musicxml')
    .sort((left, right) => Number(right.source === 'generated') - Number(left.source === 'generated'));
  const trigger = useRef<HTMLButtonElement>(null);
  // Older local score summaries do not have musicXmlCount. Resolve their directory
  // before showing a practice entry, rather than showing it for an audio-only score.
  const directoryKnown = metadata.statusFor(source.score.id) === 'ready';
  if (!items.length && (directoryKnown || !(source.score.musicXmlCount ?? 0))) return null;
  return <>
    <div className="reader-playback-entries" aria-label={t("practiceScores")} aria-busy={metadata.loading || metadata.refreshing}>
      <TooltipTrigger><Button ref={trigger} className="reader-playback-entry" aria-label={t("practiceScores")} aria-expanded={open} onPress={() => onOpenChange(!open)}>
        <FileMusic size={21} aria-hidden="true" /><Play className="attachment-play-badge" size={12} fill="currentColor" aria-hidden="true" />
      </Button><Tooltip className="practice-tooltip" placement="top">{t("practiceScores")}</Tooltip></TooltipTrigger>
    </div>
    {open && <Popover triggerRef={trigger} isOpen onOpenChange={onOpenChange} placement="top end" offset={10} className="practice-popover">
      <Dialog className="practice-panel reader-practice-launcher" aria-label={t("practiceScores")}>
        <h2>{t("practiceScores")}</h2>
        {!active && <p role="status">{t("offlineAvailable")}</p>}
        {metadata.error && <p role="status">{t("listUnavailable")}<Button onPress={metadata.retry}>{t("retry")}</Button></p>}
        {metadata.loading && !items.length && <p role="status">{t("readingPracticeScores")}</p>}
        {items.map(attachment => {
          const generated = attachment.source === 'generated';
          const name = generated ? t("generatedVersion") : attachment.name;
          return <Button className="reader-practice-source" key={attachment.id} aria-label={name} onPress={() => {
            startPlayback({ ...source, attachment });
            onOpenChange(false);
          }}>
            <FileMusic size={20} aria-hidden="true" /><span>{name}<small>{generated ? t("generatedBadge") : t("uploadedByUser")}</small></span><Play size={16} aria-hidden="true" />
          </Button>;
        })}
        {!metadata.loading && !metadata.error && active && !items.length && <p>{t("noScores")}</p>}
      </Dialog>
    </Popover>}
  </>;
}
