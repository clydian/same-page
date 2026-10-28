import { useLocation } from "react-router-dom";
import { UserRound, FolderOpen, Settings2, Layers, HardDrive, Palette, Info, LogOut, ShieldCheck } from "lucide-react";
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

export function PersonalMenu({ email, drive }: { email?: string | null; drive?: PersonalDriveActions }) {
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
    <Button className="drive-avatar" aria-label="我的"><UserRound aria-hidden="true" size={20} /></Button>
    <Popover className="file-menu-popover account-menu-popover"><Menu aria-label="我的">
      {drive && <MenuSection className="personal-menu-group">
        <Header className="personal-menu-scope">
          <span className="personal-menu-scope-title"><FolderOpen size={15} aria-hidden="true" />当前云盘</span>
          <strong className="personal-menu-scope-name">{drive.choirName}</strong>
          <span className="personal-menu-scope-description">此云盘中的身份与阅读设置</span>
          {drive.displayName && <span className="personal-menu-context-identity">云盘内显示名 · {drive.displayName}</span>}
        </Header>
        {drive.canManageIdentity && <MenuItem href={`/choirs/${drive.choirId}/me`} textValue="云盘内身份"><UserRound size={17} aria-hidden="true" /><span>云盘内身份</span></MenuItem>}
        <MenuItem href={`/choirs/${drive.choirId}/preferences`} textValue="阅读偏好"><Layers size={17} aria-hidden="true" /><span>阅读偏好</span></MenuItem>
        <MenuItem href={`/choirs/${drive.choirId}/storage`} textValue="本机存储"><HardDrive size={17} aria-hidden="true" /><span>本机存储</span></MenuItem>
      </MenuSection>}
      <MenuSection className="personal-menu-group">
        <Header className="personal-menu-scope">
          <span className="personal-menu-scope-title"><Settings2 size={15} aria-hidden="true" />应用设置</span>
          <span className="personal-menu-scope-description">账户、外观与应用信息</span>
          {email && <span className="personal-menu-context-identity">{email}</span>}
        </Header>
        <MenuItem href="/user" textValue="账户"><UserRound size={17} aria-hidden="true" /><span>账户</span></MenuItem>
        <MenuItem href={experience ? "/appearance?experience=1" : "/appearance"} textValue="外观"><Palette size={17} aria-hidden="true" /><span>外观</span></MenuItem>
        <MenuItem className="personal-menu-about" href="/about" textValue="关于与更新"><Info size={17} aria-hidden="true" /><span>关于与更新</span><small className="personal-menu-version" translate="no">{buildVersion}</small></MenuItem>
        {showAdmin && <MenuItem href="/admin" textValue="产品后台"><ShieldCheck size={17} aria-hidden="true" /><span>产品后台</span></MenuItem>}
      </MenuSection>
      <MenuSection className="personal-menu-group personal-menu-footer">
        <MenuItem onAction={() => void logout.request()} textValue="退出登录"><LogOut size={17} aria-hidden="true" /><span>退出登录</span></MenuItem>
      </MenuSection>
    </Menu></Popover>
  </MenuTrigger>;
}
