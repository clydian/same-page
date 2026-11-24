import { useMessages } from "../../i18n";
import { useLocation } from "react-router-dom";
import { UserRound, FolderOpen, Settings2, Layers, HardDrive, Mic, Palette, Info, LogOut, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, Header, MenuItem, MenuSection, MenuTrigger, Popover } from "react-aria-components";
import { useLogout } from "../auth/logout-context";
import { Menu } from "../navigation/overlays";
import { buildVersion } from "../../shared/build";
import { useApplicationIdentity } from "../auth/application-identity";
import { adminSession } from "../admin/api";
import { useNetworkStatus } from "../platform/use-network-status";

export interface PersonalDriveActions {
  choirId: string; choirName: string; displayName?: string; localOnly: boolean;
  canManageIdentity?: boolean;
}

export function PersonalMenu({ drive }: { email?: string | null; drive?: PersonalDriveActions }) {
  const t = useMessages("common");
  const practice = useMessages("practice");
  const logout = useLogout();
  const experience = new URLSearchParams(useLocation().search).get("experience") === "1";
  const identity = useApplicationIdentity();
  const online = useNetworkStatus();
  const [open, setOpen] = useState(false);
  const [adminFor, setAdminFor] = useState<string | null>(null);
  const sessionKey = identity.authenticatedUserId && identity.authenticatedSessionId
    ? JSON.stringify([identity.authenticatedUserId, identity.authenticatedSessionId]) : null;
  useEffect(() => {
    if (!open || !sessionKey || !online) return;
    const abort = new AbortController();
    void adminSession(AbortSignal.any([abort.signal, AbortSignal.timeout(8000)])).then(cap => {
      if (!abort.signal.aborted && (cap.viewScores || cap.manageReports || cap.manageReleases)) setAdminFor(sessionKey);
    }).catch(() => undefined);
    return () => abort.abort();
  }, [open, sessionKey, online]);
  const showAdmin = open && online && sessionKey !== null && adminFor === sessionKey;
  return <MenuTrigger isOpen={open} onOpenChange={next => { setOpen(next); setAdminFor(null); }}>
    <Button className="drive-avatar" aria-label={t("myMenu")}><UserRound aria-hidden="true" size={20} /></Button>
    <Popover className="file-menu-popover account-menu-popover"><Menu aria-label={t("myMenu")}>
      {drive && <MenuSection className="personal-menu-group">
        <Header className="personal-menu-scope">
          <span className="personal-menu-scope-title"><FolderOpen size={15} aria-hidden="true" />{t("currentDrive")}</span>
        </Header>
        {drive.canManageIdentity && <MenuItem href={`/choirs/${drive.choirId}/me`} textValue={t("driveIdentity")}><UserRound size={17} aria-hidden="true" /><span>{t("driveIdentity")}</span></MenuItem>}
        {drive.canManageIdentity && !drive.localOnly && !experience && <MenuItem href={`/choirs/${drive.choirId}/sight-singing`} textValue={practice("sight.title")}><Mic size={17} aria-hidden="true" /><span>{practice("sight.title")}</span></MenuItem>}
        <MenuItem href={`/choirs/${drive.choirId}/preferences`} textValue={t("readingPreferences")}><Layers size={17} aria-hidden="true" /><span>{t("readingPreferences")}</span></MenuItem>
        <MenuItem href={`/choirs/${drive.choirId}/storage`} textValue={t("localStorage")}><HardDrive size={17} aria-hidden="true" /><span>{t("localStorage")}</span></MenuItem>
      </MenuSection>}
      <MenuSection className="personal-menu-group">
        <Header className="personal-menu-scope">
          <span className="personal-menu-scope-title"><Settings2 size={15} aria-hidden="true" />{t("appSettings")}</span>
        </Header>
        <MenuItem href="/user" textValue={t("account")}><UserRound size={17} aria-hidden="true" /><span>{t("account")}</span></MenuItem>
        <MenuItem href={experience ? "/appearance?experience=1" : "/appearance"} textValue={t("appearance")}><Palette size={17} aria-hidden="true" /><span>{t("appearance")}</span></MenuItem>
        <MenuItem className="personal-menu-about" href="/about" textValue={t("about")}><Info size={17} aria-hidden="true" /><span>{t("about")}</span><small className="personal-menu-version" translate="no">{buildVersion}</small></MenuItem>
        {showAdmin && <MenuItem href="/admin" textValue={t("admin")}><ShieldCheck size={17} aria-hidden="true" /><span>{t("admin")}</span></MenuItem>}
      </MenuSection>
      <MenuSection className="personal-menu-group personal-menu-footer">
        <MenuItem onAction={() => void logout.request()} textValue={t("signOut")}><LogOut size={17} aria-hidden="true" /><span>{t("signOut")}</span></MenuItem>
      </MenuSection>
    </Menu></Popover>
  </MenuTrigger>;
}
