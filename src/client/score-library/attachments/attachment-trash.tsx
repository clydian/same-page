import { useMessages } from "../../../i18n";
import { invalidateSettingsLifetime } from "../../settings/use-settings-lifetime";
import { SettingsRequestError, isSettingsReadDenied } from "../../settings/settings-request";
import { settingsError } from "../../settings/settings-error";
import { useEffect, useState } from "react";
import { Button } from "react-aria-components";
import { attachmentListSchema, type ScoreAttachment } from "../../../shared/attachments";
import { attachmentFetch as diagnosticFetch } from "./request";
import { attachmentMessage, attachmentPath } from "./api";
import { useTrashRestore } from "../use-trash-restore";
import "./attachments.css";

export function AttachmentTrash({ choirId, onRestored, writable = true }: { choirId: string; onRestored: () => void | Promise<void>; writable?: boolean }) {
  const t = useMessages("library");
  const { lifetime, busy, attempt, reread, runRestore } = useTrashRestore(writable);
  const [items, setItems] = useState<ScoreAttachment[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [now] = useState(Date.now);
  useEffect(() => {
    if (!writable) return;
    const abort = new AbortController();
    void diagnosticFetch(`/api/choirs/${choirId}/attachments/trash`, { signal: abort.signal }).then(async response => {
      if (!response.ok) throw new SettingsRequestError(response.status);
      const result = attachmentListSchema.parse(await response.json());
      if (!abort.signal.aborted) { setItems(result.attachments); setMessage(null); }
    }).catch(error => { if (!abort.signal.aborted) {
      if (isSettingsReadDenied(error)) { invalidateSettingsLifetime(lifetime); setItems([]); }
      setMessage(settingsError(error, t("attachmentTrashDeletedAttachmentCannotRead")));
    } });
    return () => abort.abort();
  }, [choirId, attempt, writable, lifetime, t]);
  const restoreAttachment = (item: ScoreAttachment) => runRestore(async current => {
    const response = await diagnosticFetch(attachmentPath(choirId, item.scoreId, item.id) + "/restore", { method: "POST" });
    if (!current()) return;
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      if (!current()) return;
      setMessage(attachmentMessage(response.status, payload));
      return;
    }
    setItems(current => current.filter(value => value.id !== item.id));
    await onRestored();
  }, () => setMessage(t("attachmentTrashRecoveryResultNotConfirmed")));

  return items.length || message ? <section className="attachment-trash" aria-label={t("attachmentTrashDeletedAttachmentsAutomaticallyDeleted")}><h3>{t("attachmentTrashDeletedAttachmentsAutomaticallyDeleted")}</h3>
    <ul className="trash-list">{items.map(item => <li key={item.id}><span><strong>{item.name}</strong><small>{item.scoreName} · {t("trashExpiresAfter", { days: Math.max(1, Math.ceil(((item.trashExpiresAt ?? 0) - now) / 86400000)) })}</small></span>
      <Button isDisabled={busy || !writable} onPress={() => void restoreAttachment(item)}>{t("membershipManagementRecoveryMembership")}</Button></li>)}</ul>
    {message && <p role="status">{message}<Button isDisabled={busy || !writable} onPress={reread}>{t("readAgain")}</Button></p>}
  </section> : null;
}
