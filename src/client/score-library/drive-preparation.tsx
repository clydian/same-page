import { useMessages } from "../../i18n";
import { Check } from "lucide-react";
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
  const login = loginHref(`/choirs/${choirId}`);
  return <DriveSuggestion id="preparation" label={t("drivePreparationRehearsalPreparation")} title={t("drivePreparationGetReadyNextRehearsal")}
    closeLabel={t("drivePreparationNotUsedTimeBeing")}
    action={<>
      {!installed && (pendingInstall
        ? <Button className="secondary-button" onPress={install.open}>{t("drivePreparationViewAddingHelp")}</Button>
        : <InstallButton className="primary-button" />)}
      {installed && !accountReady && <Link className="primary-button" to={login}>{t("drivePreparationRegisterLogStartTaking")}</Link>}
    </>}>
    <ol className="preparation-steps">
      <li data-complete={installed || undefined}>
        <span className="preparation-step-marker" aria-hidden="true">{installed ? <Check size={16} /> : "1"}</span>
        <div><strong>{installed ? t("drivePreparationAddedDesktop") : pendingInstall ? t("drivePreparationAddRequestSubmitted") : t("drivePreparationAddDesktop")}</strong>
          {!installed && <p>{pendingInstall ? t("drivePreparationReturnDesktopClickScore") : t("drivePreparationLikeOtherAppsOpened")}</p>}
        </div>
      </li>
      <li data-complete={accountReady || undefined}>
        <span className="preparation-step-marker" aria-hidden="true">{accountReady ? <Check size={16} /> : "2"}</span>
        <div><strong>{accountReady ? t("drivePreparationLoginJoinCloudDisk") : t("drivePreparationLogSaveSyncNotes")}</strong>
          {!accountReady && <p>{install.runningInApp
            ? t("drivePreparationRegisterLogAddCloud")
            : t("drivePreparationRecommendedLogAfterOpening")}</p>}
        </div>
      </li>
    </ol>
  </DriveSuggestion>;
}
