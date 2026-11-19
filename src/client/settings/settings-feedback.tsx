import { useMessages } from "../../i18n";
import { PendingText } from "../components/loading-status";

export function SettingsFeedback({
  loading,
  loadError,
  message,
  retry,
}: {
  loading: boolean;
  loadError: string | null;
  message: string | null;
  retry: () => void;
}) {
  const t = useMessages("library");
  if (loadError) {
    return (
      <div className="settings-feedback" role="alert">
        {message && <p>{message}</p>}
        <p>{loadError}</p>
        <button className="secondary-button" type="button" onClick={retry}>{t("settingsFeedbackReload")}</button>
      </div>
    );
  }
  return (
    <p className="settings-feedback settings-feedback--status" role="status">
      {loading ? <PendingText>{t("settingsFeedbackReadingSettings")}</PendingText> : message ?? ""}
    </p>
  );
}
