import { getCurrentLocale, getMessages, type AppLocale } from "../../../i18n";
import type { ScoreAttachment } from "../../../shared/attachments";
import type { AttachmentSelection } from "./attachment-list";

export function attachmentActionTitle(action: AttachmentSelection["action"], attachment?: ScoreAttachment, uploadKind: "audio" | "pdf" | "markdown" | "musicxml" = "audio", locale: AppLocale = getCurrentLocale()) {
  const t = getMessages(locale, "library");
  switch (action) {
    case "add": return t("addAttachment");
    case "upload": return t({ audio: "addAudioAttachment", musicxml: "addPlayableScoreAttachment", pdf: "addPdfAttachment", markdown: "addMarkdownAttachment" }[uploadKind]);
    case "link": return t("attachmentPresentationAddLink");
    case "trash": return t("moveToTrash");
    case "rename": return attachment?.kind === "link" ? t("attachmentListModifyLink") : t("attachmentPresentationRenameAttachment");
    case "markdown": return attachment?.name ?? t("attachmentPresentationCreateNewDocumentMd");
    case "open": return attachment?.name ?? t("attachmentEntryOpenAttachment");
  }
}
