import { useMessages } from "../../i18n";
import { LanguageSelect } from "../../i18n/language-select";
import { UserRound } from "lucide-react";
import { useApplicationIdentity } from "../auth/application-identity";
import { IdentityNotice } from "../auth/local-entry";
import { useLogout } from "../auth/logout-context";
import { Link } from "react-router-dom";
import { TaskHeader } from "../components/task-header";

export default function PersonalSettingsPage() {
  const t = useMessages("common");
  const identity = useApplicationIdentity();
  const { session } = identity;
  const logout = useLogout();
  const email = session.data?.user.email;
  return <div className="app-page">
    <TaskHeader title={t("account")} backTo={"/drives"} />
    <main className="page-shell settings-page settings-ux personal-settings-page">
      <div className="personal-settings-account">
        <span className="personal-settings-avatar" aria-hidden="true"><UserRound size={21} /></span>
        <div className="personal-settings-identity"><p>{email ?? (identity.localUserId ? t("localUser") : t("guest"))}</p><small>{identity.localUserId ? t("yourAccount") : t("signedOut")}</small></div>
        {identity.localUserId ? <button className="secondary-button" onClick={() => void logout.request()}>{t("signOut")}</button> : !identity.restoring && identity.onlineState === "signed-out" && <Link className="secondary-button" to="/login">{t("signIn")}</Link>}
      </div>
      <IdentityNotice identity={identity} />
      <LanguageSelect showLabel />
      <section className="personal-settings-data"><h2>{t("userData")}</h2><Link className="settings-secondary-link settings-danger-link" to="/user/lifecycle">{t("deleteUser")}<span aria-hidden="true">›</span></Link><p>{t("driveSettingsHint")}</p></section>
    </main>
  </div>;
}
