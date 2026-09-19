import { useEffect, useRef, useState } from "react";
import { attachmentSchema, type ScoreAttachment } from "../../../shared/attachments";
import { diagnosticFetch } from "../../diagnostics/diagnostics";
import { useSettingsMutation } from "../../settings/settings-mutation";
import { SettingsRequestError } from "../../settings/settings-request";
import { uploadBody, type UploadProgress } from "../upload-transport";
import { attachmentMessage, attachmentPath, readAttachmentRecovery, readMarkdown } from "./api";

export type AttachmentWrite =
  | { kind: "upload"; name: string; file: File }
  | { kind: "link"; name: string; url: string }
  | { kind: "modify"; name: string; url?: string; revision: number }
  | { kind: "trash"; revision: number }
  | { kind: "markdown"; name: string; text: string; revision: number | null };
export type AttachmentReceipt = { attachment: ScoreAttachment | null; text?: string };

// A mounted attachment owns one stable request identity. The view supplies
// content intent; confirmation, recovery and refresh ordering stay here.
export function useAttachmentMutation({ choirId, scoreId, id, enabled, onChanged, onSaved, onComplete }: {
  choirId: string; scoreId: string; id: string; enabled: boolean;
  onChanged: () => Promise<void>;
  onSaved?: (receipt: AttachmentReceipt) => void;
  onComplete?: () => void;
}) {
  const attempt = useRef<{ intent: AttachmentWrite; confirmed: boolean } | null>(null);
  const abort = useRef<AbortController | null>(null);
  const [saved, setSaved] = useState(false);
  const [detail, setDetail] = useState<string | null>(null);
  const [progress, setProgress] = useState<UploadProgress>();
  useEffect(() => () => abort.current?.abort(), []);
  const accept = (receipt: AttachmentReceipt) => {
    if (attempt.current) attempt.current.confirmed = true;
    setSaved(true);
    onSaved?.(receipt);
  };
  const mutation = useSettingsMutation({ enabled, refresh: async isCurrent => {
    const pending = attempt.current;
    if (!pending) return;
    if (!pending.confirmed) {
      const intent = pending.intent;
      const creating = intent.kind === "upload" || intent.kind === "link" || (intent.kind === "markdown" && intent.revision === null);
      const recovery = await readAttachmentRecovery(choirId, scoreId, id, creating ? "create" : intent.kind === "trash" ? "trash" : "modify");
      if (!isCurrent()) return;
      setDetail(null);
      if (recovery.state === "pending") {
        setDetail("附件仍在保存，请稍后再次核对。");
        throw new SettingsRequestError(409);
      }
      if (creating && recovery.state === "absent") {
        setProgress(undefined);
        setDetail("附件尚未保存，输入仍保留，可以重试。");
      } else if (intent.kind === "trash" && (recovery.state === "trashed" || recovery.state === "absent")) {
        accept({ attachment: null });
      } else if (recovery.state === "available") {
        const row = recovery.attachment;
        if (intent.kind === "markdown") {
          const remote = await readMarkdown(choirId, scoreId, id);
          if (!isCurrent()) return;
          if (remote.text === intent.text && remote.attachment.name === intent.name) accept(remote);
          else if (remote.attachment.revision === intent.revision) setDetail("文档尚未保存，草稿仍保留，可以重试。");
          else conflict();
        } else if (intent.kind !== "trash" && row.name === intent.name
          && (intent.kind !== "link" && intent.kind !== "modify" || intent.url === undefined || row.url === intent.url)
          && (intent.kind !== "upload" || row.sizeBytes === intent.file.size)) accept({ attachment: row });
        else if (!creating && "revision" in intent && row.revision === intent.revision) setDetail("修改尚未保存，可以重试。");
        else conflict();
      } else throw new SettingsRequestError(404);
    }
    await onChanged();
    if (isCurrent() && pending.confirmed) onComplete?.();
  } });
  function conflict(): never {
    setDetail("附件已发生变化，当前修改仍保留；请下载草稿或重新打开附件核对。");
    throw new SettingsRequestError(409);
  }
  const save = (intent: AttachmentWrite) => mutation.submit(async () => {
    // SettingsMutation admits the submission synchronously before this runs;
    // a double click cannot replace the intent being recovered.
    attempt.current = { intent, confirmed: false };
    setSaved(false); setDetail(null); setProgress(undefined);
    abort.current = new AbortController();
    const signal = abort.current.signal;
    const path = attachmentPath(choirId, scoreId, id);
    if (intent.kind === "upload" || intent.kind === "markdown") {
      const body = intent.kind === "upload" ? intent.file : new Blob([intent.text], { type: "text/markdown; charset=utf-8" });
      const revision = intent.kind === "markdown" ? intent.revision : null;
      const query = new URLSearchParams({ name: intent.name, size: String(body.size), ...(revision === null ? {} : { expectedRevision: String(revision) }) });
      return uploadBody(`${path}/file?${query}`, body, signal, value => { if (!signal.aborted) setProgress(value); }, revision === null ? "POST" : "PUT");
    }
    if (intent.kind === "trash") return diagnosticFetch(`${path}?expectedRevision=${intent.revision}`, { method: "DELETE", signal });
    const body = intent.kind === "link" ? { id, name: intent.name, url: intent.url } : { name: intent.name, ...(intent.url === undefined ? {} : { url: intent.url }), expectedRevision: intent.revision };
    return diagnosticFetch(intent.kind === "link" ? `/api/choirs/${encodeURIComponent(choirId)}/scores/${encodeURIComponent(scoreId)}/attachments/links` : path, {
      method: intent.kind === "link" ? "POST" : "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal,
    });
  }, {
    rejectionMessage: attachmentMessage,
    confirmed: async (response, isCurrent) => {
      const attachment = response.status === 204 ? null : attachmentSchema.parse((await response.json()).attachment);
      if (isCurrent()) accept({ attachment, ...(intent.kind === "markdown" ? { text: intent.text } : {}) });
    },
  });
  return { pending: mutation.pending, blocked: mutation.blocked, needsRefresh: mutation.needsRefresh, refresh: mutation.refresh, message: detail ?? mutation.message, saved, progress, save, cancel: () => abort.current?.abort() };
}
