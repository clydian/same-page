import { useId } from "react";
import { Link } from "react-router-dom";
import { loginHref } from "../auth/login-return";
import { UserRound, Settings } from "lucide-react";
import { Button, Form, Input, MenuItem, MenuTrigger, Popover, TextField } from "react-aria-components";
import { Menu } from "../navigation/overlays";
import { DrivePersonalMenu } from "./drive-personal-menu";
import { DriveSwitcher } from "./drive-switcher";
import { LibrarySortControl } from "./library-sort-control";
import type { LibrarySort, LibrarySortDirection, LibraryView } from "./library-view-state";

export function DriveHeader({ choirId, choirName, userId, email, search, onSearch,
  canManageIdentity, localOnly = false, resolvingIdentity = false, loading = false,
  view = { sort: "name" }, onSort, onDirection,
}: {
  choirId: string; choirName: string; userId?: string; email?: string | null; search: string;
  onSearch: (value: string) => void;
  loading?: boolean; resolvingIdentity?: boolean; localOnly?: boolean; canManageIdentity?: boolean;
  view?: Pick<LibraryView, "sort" | "sortDirections">;
  onSort?: (value: LibrarySort) => void; onDirection?: (value: LibrarySortDirection) => void;
}) {
  const settingsHint = useId();
  return <header className="drive-header">
    <div className="drive-context-row">
      <h1 aria-label={choirName}><DriveSwitcher key={`${userId ?? "guest"}:${choirId}`} choirId={choirId} choirName={choirName} userId={userId} localOnly={localOnly} loading={loading} /></h1>
      <span className="drive-settings-control"><Link className="icon-button drive-settings-entry" to={`/choirs/${choirId}/settings`} aria-label="云盘设置" aria-describedby={settingsHint} aria-disabled={loading || localOnly || undefined} onClick={event => { if (loading || localOnly) event.preventDefault(); }}>
        <Settings size={20} aria-hidden="true" />
      </Link><span id={settingsHint} role="tooltip" className="drive-settings-hint">{localOnly ? "联网并确认访问后可使用云盘设置" : "云盘设置"}</span></span>
      {userId ? <DrivePersonalMenu key={`${userId}:${choirId}`} choirId={choirId} choirName={choirName} userId={userId} email={email} localOnly={localOnly} canManageIdentity={canManageIdentity} />
        : resolvingIdentity || loading ? <span className="drive-avatar" aria-label="正在恢复用户"><UserRound aria-hidden="true" size={20} /></span>
        : <GuestMenu choirId={choirId} />}
    </div>
    <div className="drive-library-controls">
      <Form className="library-search drive-search" role="search" onSubmit={event => event.preventDefault()}>
        <TextField isDisabled={loading} value={search} onChange={onSearch} aria-label={`搜索「${choirName}」中的乐谱`}><Input type="search" placeholder="搜索乐谱" /></TextField>
      </Form>
      <LibrarySortControl view={view} disabled={loading} onSort={onSort ?? (() => {})} onDirection={onDirection ?? (() => {})} />
    </div>
  </header>;
}

function GuestMenu({ choirId }: { choirId: string }) {
  return <MenuTrigger><Button className="drive-avatar" aria-label="访客选项">访</Button>
    <Popover className="file-menu-popover account-menu-popover"><Menu aria-label="访客选项">
      <MenuItem href={loginHref(`/choirs/${choirId}`)}>登录或注册</MenuItem>
      <MenuItem href="/help">使用手册</MenuItem>
      <MenuItem href="/diagnostics">问题反馈</MenuItem>
      <MenuItem href="/about">关于与更新</MenuItem>
    </Menu></Popover>
  </MenuTrigger>;
}
