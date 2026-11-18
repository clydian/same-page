import { useMessages } from "../../i18n";
import type { InstallGuide } from "./install-context";

export function InstallCompletion({ guide }: { guide: InstallGuide }) {
  const t = useMessages("system");
  return <section aria-label={t("installCompletion.help")}>
    <p role="status">{t("installCompletion.submitted")}</p>
    <details className="install-fallback">
      <summary>{t("installCompletion.missingIcon")}</summary>
      {guide.startsWith("android") ? <>
        <p>{t("installCompletion.shortcutPermission")}</p>
        <p>{t("installCompletion.tryAgain")}</p>
        <p>{t("installCompletion.switchBrowser")}</p>
      </> : <p>{t("installCompletion.checkAdded")}</p>}
    </details>
  </section>;
}
