import { UserRound } from "lucide-react";
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
      {drive && <MenuSection><Header>此云盘 · {drive.choirName}</Header>
        {drive.displayName && <MenuItem isDisabled>{drive.displayName}</MenuItem>}
        {drive.canManageIdentity && <MenuItem href={`/choirs/${drive.choirId}/me`}>云盘内身份</MenuItem>}
        <MenuItem href={`/choirs/${drive.choirId}/preferences`}>阅读偏好</MenuItem>
        <MenuItem href={`/choirs/${drive.choirId}/storage`}>本机存储</MenuItem>
      </MenuSection>}
      <MenuSection><Header>用户</Header>
        <MenuItem isDisabled>{email || "已登录"}</MenuItem>
        <MenuItem href="/user">账户</MenuItem>
        <MenuItem href="/help">使用手册</MenuItem>
        <MenuItem href="/diagnostics">问题反馈</MenuItem>
        <MenuItem className="personal-menu-about" href="/about" textValue="关于与更新"><span>关于与更新</span><small className="personal-menu-version" translate="no">{buildVersion}</small></MenuItem>
      </MenuSection>
      {showAdmin && <MenuSection><Header>产品运营</Header>
        <MenuItem href="/admin">产品后台</MenuItem>
      </MenuSection>}
      <MenuSection>
        <MenuItem onAction={() => void logout.request()}>退出登录</MenuItem>
      </MenuSection>
    </Menu></Popover>
  </MenuTrigger>;
}
