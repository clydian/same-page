import type { ScoreAttachment } from "../../../shared/attachments";
import type { AttachmentSelection } from "./attachment-list";

export function attachmentActionTitle(action: AttachmentSelection["action"], attachment?: ScoreAttachment, uploadKind: "audio" | "pdf" | "markdown" = "audio") {
  switch (action) {
    case "add": return "添加附件";
    case "upload": return `添加${{ audio: "音频", pdf: "PDF", markdown: "文档（.md）" }[uploadKind]}`;
    case "link": return "添加链接";
    case "trash": return "移到回收站";
    case "rename": return attachment?.kind === "link" ? "修改链接" : "重命名附件";
    case "markdown": return attachment?.name ?? "新建文档（.md）";
    case "open": return attachment?.name ?? "打开附件";
  }
}
