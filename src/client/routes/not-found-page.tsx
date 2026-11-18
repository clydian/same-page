import { useMessages } from "../../i18n";
import { Link } from "react-router-dom";
import { TaskHeader } from "../components/task-header";

export function NotFoundPage() {
  const t = useMessages("entry");
  return (
    <div className="app-page">
      <TaskHeader title={t("notFound.title")} backTo="/drives" backBehavior="parent" />
      <main className="page-shell compact-page">
        <p>{t("notFound.hint")}</p>
        <Link className="primary-link" to="/drives">{t("notFound.action")}</Link>
      </main>
    </div>
  );
}
