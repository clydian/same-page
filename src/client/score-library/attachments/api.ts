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
  const code = body && typeof body === "object" && "error" in body ? body.error : "";
  if (status === 401 || status === 403) return "当前没有操作权限，请重新登录或联系云盘拥有者。";
  if (code === "attachment_conflict") return "这份附件已发生变化。请核对最新内容；当前修改仍保留，可先下载草稿。";
  if (code === "choir_storage_quota_exceeded") return "云盘容量不足，请释放空间后再试。";
  if (code === "platform_storage_limit_reached") return "平台存储暂时已满，请稍后再试。";
  if (code === "attachment_limit_reached") return "每份乐谱最多保存 100 个附件，请先整理已有附件。";
  if (code === "attachment_type_unsupported") return "支持常见音频、PDF 和 Markdown，暂不支持 TXT、DOCX。";
  if (code === "attachment_content_mismatch") return "文件内容与类型不符，请使用原始文件。";
  if (code === "invalid_markdown_encoding") return "Markdown 需要使用 UTF-8 编码，请转换编码后再上传。";
  if (status === 413) return "文件超过大小上限：音频 50 MB、PDF 20 MB、Markdown 1 MB。";
  if (status === 404) return "附件或所属乐谱已不可用，请刷新云盘。";
  if (code === "invalid_musicxml") return "无法读取可播放乐谱，请检查格式、编码或解压后的大小（最多 20 MiB）。";
  if (status === 429 || code === "rate_limited") return "操作较频繁，请稍后重试。";
  return "操作未完成，请核对文件名称、类型或网址后重试。";
}

export async function musicXmlEnabled(choirId: string, signal?: AbortSignal) {
  const response = await diagnosticFetch(`/api/choirs/${choirId}/attachments/capabilities`, { signal });
  if (!response.ok) return false;
  const value: unknown = await response.json();
  return typeof value === "object" && value !== null && "musicxml" in value && value.musicxml === true;
}
