import { FeedbackMessage } from "../components/feedback-message";
import { useFeedbackMessage } from "../components/use-feedback-message";
import { useAppLocale, useMessages } from "../../i18n";
import { CheckCircle2, Send } from "lucide-react";
import "../support-pages.css";
import { useEffect, useState, useSyncExternalStore } from "react";
import { diagnosticReportRetentionDays, type DiagnosticReader } from "../../shared/diagnostic-report";
import { clearDiagnostics, exportDiagnostics, subscribeDiagnosticReset } from "./diagnostics";
import { captureDiagnosticReport, getDiagnosticSubmission, resetDiagnosticSubmission, sendDiagnosticReport,
  setDiagnosticDescription, subscribeDiagnosticSubmission } from "./diagnostic-submission";

export function DiagnosticReportForm({ reader = null }: { reader?: DiagnosticReader | null }) {
  const t = useMessages("system");
  const { locale } = useAppLocale();
  const submission = useSyncExternalStore(subscribeDiagnosticSubmission, getDiagnosticSubmission);
  const [previewId] = useState(() => crypto.randomUUID());
  const [preview, setPreview] = useState(exportDiagnostics);
  const feedback = useFeedbackMessage();
  const { setMessage } = feedback;
  useEffect(() => {
    const refresh = () => { setPreview(exportDiagnostics()); setMessage(""); };
    const unsubscribe = subscribeDiagnosticReset(refresh);
    const timer = setInterval(() => setPreview(exportDiagnostics()), 1000);
    return () => { unsubscribe(); clearInterval(timer); };
  }, [setMessage]);
  // Preview the complete payload (including optional text) without freezing the incident until Send.
  let current = preview;
  try { current = JSON.stringify(submission.report ?? captureDiagnosticReport(submission.description, reader, previewId), null, 2); }
  catch { /* Copying existing diagnostic categories remains available. */ }
  const copy = async (value: string, success: string) => {
    try { await navigator.clipboard.writeText(value); setMessage(success, { duration: 5000 }); }
    catch { setMessage("diagnosticReportForm.copyFailed"); }
  };
  return <div className="diagnostic-report-form">
    <label htmlFor="diagnostic-description">{t("diagnosticReportForm.description")}</label>
    <textarea id="diagnostic-description" rows={5} maxLength={1000} placeholder={t("diagnosticReportForm.placeholder")} autoComplete="off" value={submission.description}
      readOnly={submission.report !== null} aria-describedby="diagnostic-description-hint"
      onChange={event => setDiagnosticDescription(event.target.value)} />
    <p id="diagnostic-description-hint" className="diagnostic-hint">{t("diagnosticReportForm.descriptionHelp")}</p>
    <p className="diagnostic-privacy-note">{t("diagnosticReportForm.privacy")}</p>
    <div className="diagnostics-actions">
      <button className="diagnostic-send" type="button" disabled={submission.phase === "sending" || submission.phase === "sent"}
        onClick={() => { setMessage(""); void sendDiagnosticReport(reader); }}>
        <Send size={16} aria-hidden="true" />
        {submission.phase === "sending" ? t("diagnosticReportForm.sending") : submission.phase === "sent" ? t("diagnosticReportForm.sent") : submission.phase === "failed" ? t("diagnosticReportForm.retry") : t("diagnosticReportForm.send")}
      </button>
      {submission.report && submission.phase !== "sending" && <button type="button" onClick={() => { resetDiagnosticSubmission(); setMessage(""); }}>{t("diagnosticReportForm.newReport")}</button>}
    </div>
    {submission.phase === "sent" && submission.report && <div className="diagnostic-receipt">
      <CheckCircle2 size={24} aria-hidden="true" /><h3>{t("diagnosticReportForm.received")}</h3>
      <p>{t("diagnosticReportForm.investigation")}</p>
      <p>{t.rich("diagnostic.reportId", { id: submission.report.id, value: chunks => <code>{chunks}</code> })}</p>
      <button className="secondary-button" type="button" onClick={() => void copy(submission.report!.id, "diagnosticReportForm.copiedId")}>{t("diagnosticReportForm.copyId")}</button>
      <p>{t("diagnosticReportForm.contact")}</p>
    </div>}
    <FeedbackMessage feedback={{ ...feedback, message: feedback.message ? t(feedback.message) : null }} fallback={submission.message} />
    <p className="diagnostic-hint">{t("diagnosticReportForm.keepOpen")}</p>
    <details className="support-details diagnostic-details">
      <summary>{t("diagnosticReportForm.details")}</summary>
      <p>{t("diagnostic.retention", { days: diagnosticReportRetentionDays })}</p>
      <p>{t("diagnosticReportForm.payload")}</p>
      {!reader && <p>{t.rich("diagnostic.independent", { check: chunks => <a href={`/api/support/update?lang=${locale}`}>{chunks}</a> })}</p>}
      <label htmlFor="diagnostic-report">{t("diagnosticReportForm.diagnosticData")}</label>
      <textarea id="diagnostic-report" readOnly value={current} rows={12} />
      <div className="diagnostics-actions diagnostic-utilities">
      <button type="button" onClick={() => void copy(current, "diagnosticReportForm.copiedData")}>{t("diagnosticReportForm.copyData")}</button>
      <button type="button" onClick={() => { clearDiagnostics(); setMessage("diagnosticReportForm.cleared", { duration: 5000 }); }}>{t("diagnosticReportForm.clear")}</button>
      </div>
    </details>

  </div>;
}
