import { FileAudio, FileText, Link as LinkIcon, MoreHorizontal, Paperclip } from "lucide-react";
import { Button, MenuItem, MenuTrigger, Popover } from "react-aria-components";
import { safeAttachmentUrl, type ScoreAttachment } from "../../../shared/attachments";
import { scoreDisplayName } from "../../../shared/score-display-name";
import type { ScoreSummary } from "../../../shared/scores";
import { Menu } from "../../navigation/overlays";
import { attachmentFileUrl } from "./api";
import "./attachments.css";
import { LoadingStatus } from "../../components/loading-status";

export type AttachmentSelection = { score: ScoreSummary; action: "add" | "upload" | "link" | "markdown" | "open" | "rename" | "trash"; attachment?: ScoreAttachment };

export function AttachmentCount({ score, expanded, disabled, onToggle }: { score: ScoreSummary; expanded: boolean; disabled: boolean; onToggle: () => void }) {
  return score.attachmentCount ? <Button className="attachment-count" aria-label={`${scoreDisplayName(score.fileName)}：${score.attachmentCount} 个附件`}
    aria-expanded={expanded} aria-controls={`score-attachments-${score.id}`} isDisabled={disabled} onPress={onToggle}
    aria-description={expanded ? "收起这份乐谱的附件" : "展开这份乐谱的附件"}><Paperclip size={13} aria-hidden="true" /><span>{score.attachmentCount}</span></Button> : null;
}

export function AttachmentRows({ score, choirId, items, canModify, canTrash, onSelect }: {
  score: ScoreSummary; choirId: string; items: ScoreAttachment[]; canModify: boolean; canTrash: boolean;
  onSelect: (selection: AttachmentSelection) => void;
}) {
  const rows = items.filter(item => item.scoreId === score.id);
  if (!rows.length) return null;
  return <ul className="attachment-list" aria-label={`${score.fileName} 的附件`}>
    {rows.map(attachment => {
      const Icon = attachment.kind === "audio" ? FileAudio : attachment.kind === "link" ? LinkIcon : FileText;
      const content = <><Icon size={16} aria-hidden="true" /><span>{attachment.name}</span></>;
      return <li className="attachment-row" key={attachment.id}>
        {attachment.kind === "link" ? <a className="attachment-open" href={safeAttachmentUrl(attachment.url ?? "")} target="_blank" rel="noopener noreferrer">{content}</a>
          : <Button className="attachment-open" onPress={() => onSelect({ score, attachment, action: "open" })}>{content}</Button>}
        {(attachment.kind !== "link" || canModify || canTrash) && <MenuTrigger><Button className="attachment-menu" aria-label={`${attachment.name} 更多操作`}><MoreHorizontal size={18} /></Button>
          <Popover className="file-menu-popover"><Menu aria-label={`${attachment.name} 操作`} onAction={key => { if (key === "rename" || key === "trash") onSelect({ score, attachment, action: key }); }}>
            {attachment.kind !== "link" && <MenuItem id="download" href={attachmentFileUrl(choirId, attachment, true)} download={attachment.name}>下载</MenuItem>}
            {canModify && <MenuItem id="rename">{attachment.kind === "link" ? "修改链接" : "重命名"}</MenuItem>}
            {canTrash && <MenuItem id="trash">移到回收站</MenuItem>}
          </Menu></Popover></MenuTrigger>}
      </li>;
    })}
  </ul>;
}

export function AttachmentPending({ count, failed, retry }: { count: number; failed: boolean; retry: () => void }) {
  return <div className="attachment-pending" style={{ minHeight: Math.max(1, count) * 44 }} aria-busy={!failed}>
    {failed ? <p className="attachment-help" role="status">暂时无法读取附件。<Button onPress={retry}>重试</Button></p>
      : <LoadingStatus>正在读取附件…</LoadingStatus>}
  </div>;
}
