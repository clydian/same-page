import { useMessages } from "../../i18n";
import { Button } from "react-aria-components";
import { Link } from "react-router-dom";
import { loginHref } from "../auth/login-return";
import { DriveSuggestion } from "../components/drive-suggestion";
import { InstallButton } from "../install/install-entry";
import { useInstall } from "../install/install-context";
import "./drive-preparation.css";

export function DrivePreparation({ choirId, accountReady }: { choirId: string; accountReady: boolean }) {
  const t = useMessages("library");
  const install = useInstall();
  if (!install || (install.hidden && accountReady)) return null;
  const installed = install.hidden;
  const pendingInstall = install.requested && !installed;
  const installTitle = pendingInstall ? t("drivePreparationAddRequestSubmitted") : t("drivePreparationAddDesktop");
  const installHint = pendingInstall ? t("drivePreparationReturnDesktopClickScore") : t("drivePreparationLikeOtherAppsOpened");
  return <DriveSuggestion id="preparation" label={t("drivePreparationRehearsalPreparation")} title={t("drivePreparationGetReadyNextRehearsal")}
    closeLabel={t("drivePreparationNotUsedTimeBeing")}
    action={installed
      ? <Link className="primary-button" to={loginHref(`/choirs/${choirId}`)}>{t("drivePreparationRegisterLogStartTaking")}</Link>
      : pendingInstall
        ? <Button className="secondary-button" onPress={install.open}>{t("drivePreparationViewAddingHelp")}</Button>
        : <InstallButton className="primary-button" />}>
    {installed ? <p>{t("drivePreparationRegisterLogAddCloud")}</p> : accountReady ? <>
      {pendingInstall && <strong>{installTitle}</strong>}
      <p>{installHint}</p>
    </> : <ol className="preparation-steps">
      <li>
        <span className="preparation-step-marker" aria-hidden="true">1</span>
        <div><strong>{installTitle}</strong>
          <p>{installHint}</p>
        </div>
      </li>
      <li>
        <span className="preparation-step-marker" aria-hidden="true">2</span>
        <div><strong>{t("drivePreparationLogSaveSyncNotes")}</strong>
          <p>{t("drivePreparationRecommendedLogAfterOpening")}</p>
        </div>
      </li>
    </ol>}
  </DriveSuggestion>;
}
