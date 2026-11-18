import { useMessages } from "../../../i18n";
import { FileOpenLink } from "../file-open-link";
import { FeedbackMessage } from "../../components/feedback-message";
import { useFeedbackMessage } from "../../components/use-feedback-message";
import { useSyncExternalStore } from "react";
import { connections, connectionUrl } from "../../connection/connection";
import { FileAudio, FileText, Link as LinkIcon, MoreHorizontal, Paperclip, ExternalLink } from "lucide-react";
import { Button, MenuItem, MenuTrigger, Popover } from "react-aria-components";
import { safeAttachmentUrl, type ScoreAttachment } from "../../../shared/attachments";
import { scoreDisplayName } from "../../../shared/score-display-name";
import type { ScoreSummary } from "../../../shared/scores";
import { Menu } from "../../navigation/overlays";
import { attachmentFileUrl } from "./api";
import "./attachments.css";
import { useAttachmentReveal, type AttachmentRevealRequest } from "./use-attachment-reveal";
import { LoadingStatus } from "../../components/loading-status";

export type AttachmentSelection = { score: ScoreSummary; action: "add" | "upload" | "link" | "markdown" | "open" | "rename" | "trash"; attachment?: ScoreAttachment };

export function AttachmentCount({ score, count, expanded, disabled, onToggle }: { score: ScoreSummary; count: number; expanded: boolean; disabled: boolean; onToggle: () => void }) {
  const t = useMessages("library");
  return count ? <Button className="attachment-count" aria-label={t("attachmentListAttachments", { name: String(scoreDisplayName(score.fileName)), count: String(count) })}
    aria-expanded={expanded} aria-controls={`score-attachments-${score.id}`} isDisabled={disabled} onPress={onToggle}
    aria-description={expanded ? t("attachmentListCloseAttachmentsSheetMusic") : t("attachmentListExpandAttachmentSheetMusic")}><Paperclip size={13} aria-hidden="true" /><span>{count}</span></Button> : null;
}

export function AttachmentRows({ score, choirId, items, canModify, canTrash, onSelect, available = true, revealRequest, onRevealHandled }: {
  revealRequest?: AttachmentRevealRequest; onRevealHandled?: (request: AttachmentRevealRequest) => void;
  available?: boolean; score: ScoreSummary; choirId: string; items: ScoreAttachment[]; canModify: boolean; canTrash: boolean;
  onSelect: (selection: AttachmentSelection) => void;
}) {
  const t = useMessages("library");
  const feedback = useFeedbackMessage();
  const unavailable = () => feedback.setMessage(t("attachmentListAttachmentOpenedAfterConnecting"), { duration: 5000 });
  useSyncExternalStore(connections.subscribe, connections.getSnapshot);
  const rows = items.filter(item => item.scoreId === score.id && item.source !== "generated");
  const list = useAttachmentReveal(revealRequest, onRevealHandled);
  if (!rows.length) return null;
  return <><FeedbackMessage feedback={feedback} closeLabel={t("attachmentCloseFeedback")} /><ul ref={list} className="attachment-list" aria-label={t("attachmentListAttachment", { fileName: score.fileName })}>
    {rows.map(attachment => {
      const Icon = attachment.kind === "audio" ? FileAudio : attachment.kind === "link" ? LinkIcon : FileText;
      const content = <><Icon size={16} aria-hidden="true" /><span>{attachment.name}{attachment.source === "generated" && <small> {t("attachmentListAutomaticallyGeneratedBeta")}</small>}</span></>;
      return <li className="attachment-row" key={attachment.id}>
        {attachment.kind === "link" ? <FileOpenLink className="attachment-open" onClick={event => { if (!available) { event.preventDefault(); unavailable(); } }} href={safeAttachmentUrl(attachment.url ?? "")} target="_blank" rel="noopener noreferrer">{content}<ExternalLink size={13} aria-hidden="true" /></FileOpenLink>
          : <Button className="attachment-open" onPress={() => { if (!available && attachment.kind !== "musicxml") unavailable(); else onSelect({ score, attachment, action: "open" }); }}>{content}</Button>}
        {(attachment.kind !== "link" || canModify || canTrash) && <MenuTrigger><Button className="attachment-menu" aria-label={t("choirMoreOperations", { name: attachment.name })}><MoreHorizontal size={18} /></Button>
          <Popover className="file-menu-popover"><Menu aria-label={t("choirOperation", { name: attachment.name })} onAction={key => { if (key === "rename" || key === "trash") onSelect({ score, attachment, action: key }); }}>
            {attachment.kind !== "link" && <MenuItem id="download" isDisabled={!available} href={available ? connectionUrl(attachmentFileUrl(choirId, attachment, true)) : undefined} download={attachment.name}>{t("attachmentListDownload")}</MenuItem>}
            {canModify && <MenuItem isDisabled={!available} id="rename">{t(attachment.kind === "link" ? "attachmentListModifyLink" : "rename")}</MenuItem>}
            {canTrash && <MenuItem isDisabled={!available} id="trash">{t("moveToTrash")}</MenuItem>}
          </Menu></Popover></MenuTrigger>}
      </li>;
    })}
  </ul></>;
}

export function AttachmentPending({ count, failed, retry }: { count: number; failed: boolean; retry: () => void }) {
  const t = useMessages("library");
  return <div className="attachment-pending" style={{ minHeight: Math.max(1, count) * 44 }} aria-busy={!failed}>
    {failed ? <p className="attachment-help" role="status">{t("attachmentListAttachmentCannotReadTemporarily")}<Button onPress={retry}>{t("retry")}</Button></p>
      : <LoadingStatus>{t("attachmentListReadingAttachments")}</LoadingStatus>}
  </div>;
}
