import { useEffect, useRef, useState } from "react";
import { Button, Form, Input, Label, TextField } from "react-aria-components";
import { replacedPdfListSchema, type ReplacedPdf } from "../../shared/scores";
import { scoreDisplayName, scorePdfFileName } from "../../shared/score-display-name";
import { diagnosticFetch } from "../diagnostics/diagnostics";
import { PurgeDialog } from "../drives/purge-dialog";
import { captureReadIdentity } from "../settings/read-resource";
import { captureSettingsLifetime, invalidateSettingsLifetime, useSettingsLifetime } from "../settings/use-settings-lifetime";
import { isSettingsReadDenied, SettingsRequestError, settingsError } from "../settings/settings-request";
import { uploadMessage } from "./library-format";

export function ReplacedPdfTrash({ userId, choirId, writable = true, canPurge = false, onRestored }: {
  userId: string; choirId: string; writable?: boolean; canPurge?: boolean; onRestored(): void | Promise<void>;
}) {
  const lifetime = useSettingsLifetime(writable);
  const gate = useRef(false);
  const [files, setFiles] = useState<ReplacedPdf[]>([]);
  const [now] = useState(Date.now);
  const [attempt, setAttempt] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<ReplacedPdf | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [purging, setPurging] = useState<ReplacedPdf | null>(null);
  const base = `/api/choirs/${choirId}/pdf-trash`;
  useEffect(() => {
    if (!writable) return;
    const abort = new AbortController();
    void diagnosticFetch(base, { signal: abort.signal }).then(async response => {
      if (!response.ok) throw new SettingsRequestError(response.status);
      const result = replacedPdfListSchema.parse(await response.json());
      if (!abort.signal.aborted) { setFiles(result.files); setMessage(null); }
    }).catch(error => {
      if (abort.signal.aborted) return;
      if (isSettingsReadDenied(error)) {
        invalidateSettingsLifetime(lifetime); setFiles([]); setRestoring(null); setPurging(null);
      }
      setMessage(settingsError(error, "暂时无法读取被替换的 PDF。"));
    });
    return () => abort.abort();
  }, [base, attempt, writable, lifetime]);
  if (!writable && purging) setPurging(null);
  async function restore() {
    if (!restoring || !writable || gate.current) return;
    gate.current = true;
    const file = restoring;
    const identity = captureReadIdentity(), active = captureSettingsLifetime(lifetime);
    const current = () => identity() && active();
    setBusy(true); setMessage(null);
    try {
      const response = await diagnosticFetch(`${base}/${file.id}/restore`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ fileName: scorePdfFileName(name), expectedReplacedAt: file.replacedAt }),
      });
      if (!current()) return;
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        if (!current()) return;
        setMessage(response.status === 404 ? "这个 PDF 已不在可恢复的回收站中，请重新读取。" : uploadMessage(response.status, payload));
        return;
      }
      setFiles(items => items.filter(item => item.id !== file.id)); setRestoring(null);
      setMessage("PDF 已恢复为独立乐谱，原乐谱的 PDF、笔记和附件保持不变。");
      await onRestored();
    } catch { if (current()) setMessage("恢复结果未确认，请重新读取后核对。再次恢复不会创建重复文件。"); }
    finally { gate.current = false; setBusy(false); if (!current()) setAttempt(value => value + 1); }
  }
  if (!files.length && !message) return null;
  return <section className="attachment-trash" aria-label="被替换的 PDF"><h3>被替换的 PDF</h3>
    <p>恢复为独立乐谱，不覆盖当前 PDF，也不复制原乐谱的笔记和附件。</p>
    <ul className="trash-list">{files.map(file => <li key={file.id}><span><strong>{scoreDisplayName(file.fileName)}</strong>
      <small>{new Date(file.replacedAt).toLocaleDateString()} · {file.pageCount} 页 · {Math.max(1, Math.ceil((file.trashExpiresAt - now) / 86400000))} 天后自动删除</small></span>
      <Button isDisabled={busy || !writable} onPress={() => { setRestoring(file); setName(`${scoreDisplayName(file.fileName)}（恢复）`); setMessage(null); }}>恢复</Button>
      {canPurge && <Button className="primary-button destructive-button" isDisabled={busy || !writable} onPress={() => setPurging(file)}>彻底删除</Button>}
    </li>)}</ul>
    {restoring && <Form className="entry-form restore-conflict" onSubmit={event => { event.preventDefault(); void restore(); }}>
      <TextField isRequired value={name} onChange={setName} maxLength={255} isDisabled={busy || !writable}><Label>恢复后的文件名</Label><Input autoFocus /></TextField>
      <Button type="submit" isDisabled={busy || !writable}>恢复为独立乐谱</Button>
      <Button isDisabled={busy} onPress={() => setRestoring(null)}>取消</Button>
    </Form>}
    {purging && writable && <PurgeDialog userId={userId} path={`${base}/${purging.id}/purge`} title="彻底删除 PDF"
      description="这个回收站 PDF 将无法恢复。当前乐谱、笔记和附件保持不变。" onClose={() => setPurging(null)}
      onComplete={async current => { if (!current()) return; setFiles(items => items.filter(item => item.id !== purging.id)); setPurging(null); await onRestored(); }} />}
    {message && <p role="status">{message}<Button isDisabled={busy || !writable} onPress={() => setAttempt(value => value + 1)}>重新读取</Button></p>}
  </section>;
}
