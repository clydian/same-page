import { useMessages } from "../../i18n";
import { TaskHeader } from "../components/task-header";
import { DiagnosticReportForm } from "./diagnostic-report-form";

export default function DiagnosticsPage() {
  const t = useMessages("system");
  return <div className="app-page support-page">
    <TaskHeader title={t("diagnosticsPage.title")} backTo="/help" />
    <main className="support-shell feedback-shell">

      <header className="support-intro"><p className="support-kicker">{t("diagnosticsPage.kicker")}</p><h2>{t("diagnosticsPage.heading")}</h2><p>{t("diagnosticsPage.intro")}</p></header>
      <DiagnosticReportForm />
      <details className="support-details diagnostic-help"><summary>{t("diagnosticsPage.help")}</summary><p>{t("diagnosticsPage.troubleshooting")}</p></details>

    </main>
  </div>;
}
