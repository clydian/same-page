import { UserRound } from "lucide-react";
import { Button, Header, MenuItem, MenuSection, MenuTrigger, Popover } from "react-aria-components";
import { useLogout } from "../auth/logout-context";
import { Menu } from "../navigation/overlays";
import { buildVersion } from "../../shared/build";

export interface PersonalDriveActions {
  choirId: string; choirName: string; displayName?: string; localOnly: boolean;
  canManageIdentity?: boolean;
}

export function PersonalMenu({ email, drive }: { email?: string | null; drive?: PersonalDriveActions }) {
  const logout = useLogout();
  return <MenuTrigger>
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
        <MenuItem onAction={() => void logout.request()}>退出登录</MenuItem>
      </MenuSection>
    </Menu></Popover>
  </MenuTrigger>;
}
