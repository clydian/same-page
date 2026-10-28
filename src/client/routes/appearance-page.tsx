import { AppearanceSettings } from "../appearance/appearance";
import { TaskHeader } from "../components/task-header";

export default function AppearancePage() {
  return <div className="app-page">
    <TaskHeader title="外观" backTo="/drives" />
    <main className="page-shell settings-page settings-ux personal-settings-page">
      <AppearanceSettings />
    </main>
  </div>;
}
