import { useMessages } from "../../i18n";
import { AppearanceSettings } from "../appearance/appearance";
import { TaskHeader } from "../components/task-header";

export default function AppearancePage() {
  const t = useMessages("system");
  return <div className="app-page">
    <TaskHeader title={t("appearancePage.title")} backTo="/drives" />
    <main className="page-shell settings-page settings-ux personal-settings-page">
      <AppearanceSettings />
    </main>
  </div>;
}
