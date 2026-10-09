import { useSettingsLifetime, captureSettingsLifetime, invalidateSettingsLifetime } from "../../settings/use-settings-lifetime";
import { captureReadIdentity } from "../../settings/read-resource";
import { SettingsRequestError, isSettingsReadDenied, settingsError } from "../../settings/settings-request";
import { useEffect, useState } from "react";
import { Button } from "react-aria-components";
import { attachmentListSchema, type ScoreAttachment } from "../../../shared/attachments";
import { attachmentFetch as diagnosticFetch } from "./request";
import { attachmentMessage, attachmentPath } from "./api";
import "./attachments.css";

export function AttachmentTrash({ choirId, onRestored, writable = true }: { choirId: string; onRestored: () => void | Promise<void>; writable?: boolean }) {
  const lifetime = useSettingsLifetime(writable);
  const [items, setItems] = useState<ScoreAttachment[]>([]);
  const [attempt, setAttempt] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [now] = useState(Date.now);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!writable) return;
    const abort = new AbortController();
    void diagnosticFetch(`/api/choirs/${choirId}/attachments/trash`, { signal: abort.signal }).then(async response => {
      if (!response.ok) throw new SettingsRequestError(response.status);
      const result = attachmentListSchema.parse(await response.json());
      if (!abort.signal.aborted) { setItems(result.attachments); setMessage(null); }
    }).catch(error => { if (!abort.signal.aborted) {
      if (isSettingsReadDenied(error)) { invalidateSettingsLifetime(lifetime); setItems([]); }
      setMessage(settingsError(error, "暂时无法读取已删除的附件。"));
    } });
    return () => abort.abort();
  }, [choirId, attempt, writable, lifetime]);
  return items.length || message ? <section className="attachment-trash" aria-label="已删除的附件"><h3>已删除的附件</h3>
    <ul className="trash-list">{items.map(item => <li key={item.id}><span><strong>{item.name}</strong><small>{item.scoreName} · {Math.max(1, Math.ceil(((item.trashExpiresAt ?? 0) - now) / 86400000))} 天后自动删除</small></span>
      <Button isDisabled={busy || !writable} onPress={async () => {
        if (!writable) return;
        const sameIdentity = captureReadIdentity();
        const sameLifetime = captureSettingsLifetime(lifetime);
        const current = () => sameIdentity() && sameLifetime();
        setBusy(true);
        try {
          const response = await diagnosticFetch(attachmentPath(choirId, item.scoreId, item.id) + "/restore", { method: "POST" });
          if (!current()) return;
          if (!response.ok) {
            const payload = await response.json().catch(() => null);
            if (!current()) return;
            setMessage(attachmentMessage(response.status, payload)); return;
          }
          setItems(current => current.filter(value => value.id !== item.id)); await onRestored();
        } catch { if (!current()) return; setMessage("恢复结果未确认，请重新读取回收站。"); }
        finally { setBusy(false); if (!current()) setAttempt(value => value + 1); }
      }}>恢复</Button></li>)}</ul>
    {message && <p role="status">{message}<Button isDisabled={busy || !writable} onPress={() => setAttempt(value => value + 1)}>重新读取</Button></p>}
  </section> : null;
}
