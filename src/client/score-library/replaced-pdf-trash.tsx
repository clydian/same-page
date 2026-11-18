import { FeedbackMessage } from "../components/feedback-message";
import { useFeedbackMessage } from "../components/use-feedback-message";
import { useAppLocale, useMessages } from "../../i18n";
import "./replaced-pdf-trash.css";
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
  const { locale } = useAppLocale();
  const t = useMessages("library");
  const lifetime = useSettingsLifetime(writable);
  const gate = useRef(false);
  const [files, setFiles] = useState<ReplacedPdf[]>([]);
  const [now] = useState(Date.now);
  const [attempt, setAttempt] = useState(0);
  const feedback = useFeedbackMessage();
  const { message, setMessage } = feedback;
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
      setMessage(settingsError(error, t("replacedPdfTrashReplacedPdfCannotRead")));
    });
    return () => abort.abort();
  }, [base, attempt, writable, lifetime, setMessage, t]);
  if (!writable && purging) setPurging(null);
  async function restore() {
    if (!restoring || !writable || gate.current) return;
    gate.current = true;
    const file = restoring;
    const identity = captureReadIdentity(), active = captureSettingsLifetime(lifetime);
    const current = () => identity() && active();
    setBusy(true); setMessage(null);
    let confirmed = false;
    try {
      const response = await diagnosticFetch(`${base}/${file.id}/restore`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ fileName: scorePdfFileName(name), expectedReplacedAt: file.replacedAt }),
      });
      if (!current()) return;
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        if (!current()) return;
        setMessage(response.status === 404 ? t("replacedPdfTrashPdfNoLongerRecoverable") : uploadMessage(response.status, payload));
        return;
      }
      confirmed = true;
      setFiles(items => items.filter(item => item.id !== file.id)); setRestoring(null);
      await onRestored();
      if (current()) setMessage(t("replacedPdfTrashPdfHasBeenRestored"), { duration: 5000 });
    } catch { if (current()) setMessage(confirmed ? t("replacedPdfTrashPdfRestoredButRefresh") : t("replacedPdfTrashRestoringAgainNotCreate")); }
    finally { gate.current = false; setBusy(false); if (!current()) setAttempt(value => value + 1); }
  }
  if (!files.length && !message) return null;
  return <section className="attachment-trash replaced-pdf-trash" aria-label={t("replacedPdfTrashReplacedPdf")}><h3>{t("replacedPdfTrashReplacedPdf")}</h3>
    <p>{t("replacedPdfTrashRevertIndependentScoreWithout")}</p>
    <ul className="trash-list">{files.map(file => <li key={file.id}><span><strong>{scoreDisplayName(file.fileName)}</strong>
      <small>{t("pdfTrashSummary", { date: new Date(file.replacedAt).toLocaleDateString(locale), pages: file.pageCount, days: Math.max(1, Math.ceil((file.trashExpiresAt - now) / 86400000)) })}</small></span>
      <Button isDisabled={busy || !writable} onPress={() => { setRestoring(file); setName(t("replacedPdfTrashRecovery", { name: String(scoreDisplayName(file.fileName)) })); setMessage(null); }}>{t("membershipManagementRecoveryMembership")}</Button>
      {canPurge && <Button className="primary-button destructive-button" isDisabled={busy || !writable} onPress={() => setPurging(file)}>{t("replacedPdfTrashCompletelyDeleted")}</Button>}
    </li>)}</ul>
    {restoring && <Form className="entry-form restore-conflict" onSubmit={event => { event.preventDefault(); void restore(); }}>
      <TextField isRequired value={name} onChange={setName} maxLength={255} isDisabled={busy || !writable}><Label>{t("replacedPdfTrashRestoredFileName")}</Label><Input autoFocus /></TextField>
      <Button type="submit" isDisabled={busy || !writable}>{t("replacedPdfTrashRevertIndependentScore")}</Button>
      <Button className="secondary-button" isDisabled={busy} onPress={() => setRestoring(null)}>{t("cancel")}</Button>
    </Form>}
    {purging && writable && <PurgeDialog userId={userId} path={`${base}/${purging.id}/purge`} title={t("replacedPdfTrashCompletelyDeletePdf")}
      description={t("replacedPdfTrashRecycleBinPdfNot")} onClose={() => setPurging(null)}
      onComplete={async current => { if (!current()) return; setFiles(items => items.filter(item => item.id !== purging.id)); setPurging(null); await onRestored(); }} />}
    <FeedbackMessage feedback={feedback}>{!feedback.temporary && <Button isDisabled={busy || !writable} onPress={() => setAttempt(value => value + 1)}>{t("readAgain")}</Button>}</FeedbackMessage>
  </section>;
}
