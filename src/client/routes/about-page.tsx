import { FeedbackMessage } from "../components/feedback-message";
import { useFeedbackMessage } from "../components/use-feedback-message";
import { useMessages } from "../../i18n";
import { assetUrl } from "../../shared/asset-url";
import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { ArrowUpRight, BookOpen, ChevronRight, Globe, MessageSquare, ShieldCheck } from "lucide-react";
import { buildId, buildRunId, buildVersion } from "../../shared/build";
import { TaskHeader } from "../components/task-header";
import { UpdateDetails } from "../components/reload-prompt";
import { usePageRecoveryStatus } from "../updates/use-update-status";
import "../support-pages.css";

export default function AboutPage() {
  const t = useMessages("entry");
  const { state } = useLocation();
  const feedback = useFeedbackMessage();
  const { message, setMessage } = feedback;
  const information = [t("about.version", { version: buildVersion, build: buildId }), ...(buildRunId ? [t("about.run", { run: buildRunId })] : [])].join("\n");
  async function copy() {
    try { await navigator.clipboard.writeText(information); setMessage("about.copied", { duration: 5000 }); }
    catch { setMessage("about.copyError"); }
  }
  return <div className="app-page support-page"><TaskHeader title={t("about.title")} backTo="/drives" />
    <main className="support-shell about-shell">
      <header className="about-identity">
        <img src={assetUrl("icon-192.png")} width="72" height="72" alt="" />
        <div><p className="support-kicker">SAME PAGE</p><h2>合谱</h2></div>
        <p className="about-tagline">{t("about.tagline")}</p>
        <p className="support-muted">{t("about.summary")}</p>
      </header>
      {state?.recoverPlayer === true && <PlaybackRecovery />}
      <UpdateDetails />
      <nav className="support-links" aria-label={t("about.links")}>
        <Link to="/" state={{ home: true }}><Globe size={20} aria-hidden="true" /><span>{t("about.product")}<small>{t("about.productHint")}</small></span><ChevronRight size={18} aria-hidden="true" /></Link>
        <Link to="/help"><BookOpen size={20} aria-hidden="true" /><span>{t("about.manual")}<small>{t("about.manualHint")}</small></span><ChevronRight size={18} aria-hidden="true" /></Link>
        <Link to="/diagnostics"><MessageSquare size={20} aria-hidden="true" /><span>{t("about.feedback")}<small>{t("about.feedbackHint")}</small></span><ArrowUpRight size={18} aria-hidden="true" /></Link>
        <Link to="/privacy"><ShieldCheck size={20} aria-hidden="true" /><span>{t("about.privacy")}</span><ChevronRight size={18} aria-hidden="true" /></Link>
      </nav>
      <details className="support-details about-build" open={message === "about.copyError" || undefined}>
        <summary>{t("about.buildInfo")}</summary>
        <p className="support-muted">{t("about.currentVersion", { version: buildVersion })}</p>
        <pre>{information}</pre>
        <button className="support-text-button" onClick={() => void copy()}>{t("about.copy")}</button>
        <FeedbackMessage feedback={{ ...feedback, message: message ? t(message) : null }} closeLabel={t("join.close")} />
      </details>
    </main>
  </div>;
}

function PlaybackRecovery() {
  const t = useMessages("entry");
  const [requested, setRequested] = useState(false);
  const status = usePageRecoveryStatus();
  return <section className="support-update app-version-panel" aria-labelledby="playback-recovery-heading">
    <h2 id="playback-recovery-heading">{t("about.recovery")}</h2>
    <p>{t("about.recoveryHint")}</p>
    <button className="primary-button" type="button" disabled={requested && status.phase !== 'offline'} onClick={() => {
      setRequested(true);
      window.dispatchEvent(new Event('same-page-recover-page'));
    }}>{t("about.reload")}</button>
    {requested && <p role="status">{status.message}</p>}
  </section>;
}
