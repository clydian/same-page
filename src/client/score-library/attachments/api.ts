import { getCurrentLocale, getMessages } from "../../../i18n";
import { attachmentRecoverySchema, attachmentSchema, type ScoreAttachment } from "../../../shared/attachments";
import { attachmentFetch as diagnosticFetch } from "./request";
import { SettingsRequestError } from "../../settings/settings-request";

export const attachmentPath = (choirId: string, scoreId: string, id: string) => `/api/choirs/${encodeURIComponent(choirId)}/scores/${encodeURIComponent(scoreId)}/attachments/${encodeURIComponent(id)}`;
export function attachmentFileUrl(choirId: string, attachment: ScoreAttachment, download = false) {
  const query = new URLSearchParams();
  // Only Markdown content can change; renaming a recording does not invalidate playback.
  if (attachment.kind === "markdown") query.set("revision", String(attachment.revision));
  if (download) query.set("download", "1");
  return `${attachmentPath(choirId, attachment.scoreId, attachment.id)}/file?${query}`;
}

export async function readAttachment(choirId: string, scoreId: string, id: string, signal?: AbortSignal) {
  const response = await diagnosticFetch(attachmentPath(choirId, scoreId, id), { signal });
  if (!response.ok) throw new SettingsRequestError(response.status);
  return attachmentSchema.parse((await response.json()).attachment);
}

export async function readAttachmentRecovery(choirId: string, scoreId: string, id: string, operation: "create" | "modify" | "trash") {
  const response = await diagnosticFetch(`${attachmentPath(choirId, scoreId, id)}/recovery?operation=${operation}`);
  if (!response.ok) throw new SettingsRequestError(response.status);
  return attachmentRecoverySchema.parse(await response.json());
}

export function attachmentMessage(status: number, body: unknown) {
  const t = getMessages(getCurrentLocale(), "library");
  const code = body && typeof body === "object" && "error" in body ? body.error : "";
  if (status === 401 || status === 403) return t("apiCurrentlyThereNoOperation");
  if (code === "attachment_conflict") return t("apiAttachmentHasChangedCheck");
  if (code === "choir_storage_quota_exceeded") return t("apiCloudDiskCapacityInsufficient");
  if (code === "platform_storage_limit_reached") return t("apiPlatformStorageTemporarilyFull");
  if (code === "attachment_limit_reached") return t("apiEachSheetMusicSave");
  if (code === "attachment_type_unsupported") return t("apiSupportsMusicxmlCommonAudio");
  if (code === "attachment_content_mismatch") return t("apiFileContentDoesNot");
  if (code === "invalid_markdown_encoding") return t("apiMarkdownRequiresUtfEncoding");
  if (status === 413) return t("apiFileSizeExceedsMaximum");
  if (status === 404) return t("apiAttachmentAccompanyingScoreNo");
  if (code === "invalid_musicxml") return t("apiUnableReadPlayableScore");
  if (status === 429 || code === "rate_limited") return t("apiOperationFrequentTryAgain");
  return t("apiOperationNotCompletedCheck");
}

export async function readMarkdown(choirId: string, scoreId: string, id: string, signal?: AbortSignal) {
  const attachment = await readAttachment(choirId, scoreId, id, signal);
  const response = await diagnosticFetch(attachmentFileUrl(choirId, attachment), { signal });
  if (!response.ok) throw new SettingsRequestError(response.status);
  return { attachment, text: await response.text() };
}
