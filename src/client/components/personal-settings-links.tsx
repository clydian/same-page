import { BookOpen, ChevronRight, HardDrive, Info, Layers, LogIn, LogOut, MessageSquare, Palette, ShieldCheck, UserRound, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "react-aria-components";
import { Link } from "react-router-dom";
import { useMessages } from "../../i18n";
import { buildVersion } from "../../shared/build";
import { adminSession } from "../admin/api";
import type { ApplicationIdentity } from "../auth/application-identity";
import { loginHref } from "../auth/login-return";
import { useLogout } from "../auth/logout-context";
import { useNetworkStatus } from "../platform/use-network-status";

type Identity = Pick<ApplicationIdentity, "localUserId" | "authenticatedUserId" | "authenticatedSessionId" | "restoring" | "onlineState">;
type Drive = { choirId: string; canManageIdentity: boolean };

export function PersonalSettingsLinks({ identity, drive, choirId, experience }: {
  identity: Identity; drive?: Drive; choirId?: string; experience: boolean;
}) {
  const t = useMessages("common");
  const logout = useLogout();
  const online = useNetworkStatus();
  const sessionKey = identity.authenticatedUserId && identity.authenticatedSessionId
    ? JSON.stringify([identity.authenticatedUserId, identity.authenticatedSessionId]) : null;
  const signedOut = !identity.restoring && identity.onlineState === "signed-out";
  return <div className="workspace-settings">
    {drive && identity.localUserId && <section aria-labelledby="workspace-drive-settings">
      <h2 id="workspace-drive-settings">{t("currentDrive")}</h2>
      <div className="workspace-settings-list">
        {drive.canManageIdentity && <SettingLink to={`/choirs/${drive.choirId}/me`} icon={UserRound}>{t("driveIdentity")}</SettingLink>}
        <SettingLink to={`/choirs/${drive.choirId}/preferences`} icon={Layers}>{t("readingPreferences")}</SettingLink>
        <SettingLink to={`/choirs/${drive.choirId}/storage`} icon={HardDrive}>{t("localStorage")}</SettingLink>
      </div>
    </section>}
    <section aria-labelledby="workspace-app-settings">
      <h2 id="workspace-app-settings">{t("appSettings")}</h2>
      <div className="workspace-settings-list">
        {identity.localUserId ? <SettingLink to="/user" icon={UserRound}>{t("account")}</SettingLink>
          : signedOut && <SettingLink to={choirId ? loginHref(`/choirs/${choirId}`) : "/login"} icon={LogIn}>{t("signIn")}</SettingLink>}
        {identity.localUserId && <SettingLink to={experience ? "/appearance?experience=1" : "/appearance"} icon={Palette}>{t("appearance")}</SettingLink>}
        <SettingLink to="/help" icon={BookOpen}>{t("help")}</SettingLink>
        <SettingLink to="/diagnostics" icon={MessageSquare}>{t("feedback")}</SettingLink>
        <SettingLink to="/about" icon={Info} version={buildVersion}>{t("about")}</SettingLink>
        {online && sessionKey && <AdminSettingsLink key={sessionKey} />}
        {identity.localUserId && <Button className="workspace-settings-row" onPress={() => void logout.request()}>
          <LogOut size={18} aria-hidden="true" /><span>{t("signOut")}</span>
        </Button>}
      </div>
    </section>
  </div>;
}

function SettingLink({ to, icon: Icon, version, children }: { to: string; icon: LucideIcon; version?: string; children: string }) {
  return <Link className="workspace-settings-row" to={to}><Icon size={18} aria-hidden="true" />
    <span>{children}</span>{" "}
    {version && <small className="workspace-settings-version" translate="no">{version}</small>}
    <ChevronRight size={16} aria-hidden="true" />
  </Link>;
}

function AdminSettingsLink() {
  const t = useMessages("common");
  const [allowed, setAllowed] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    void adminSession(AbortSignal.any([abort.signal, AbortSignal.timeout(8000)])).then(cap => {
      if (!abort.signal.aborted && (cap.viewScores || cap.manageReports || cap.manageReleases)) setAllowed(true);
    }).catch(() => undefined);
    return () => abort.abort();
  }, []);
  return allowed ? <SettingLink to="/admin" icon={ShieldCheck}>{t("admin")}</SettingLink> : null;
}
