import { useMessages } from "../../i18n";
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
  const t = useMessages("library");
  const settingsHint = useId();
  return <header className="drive-header">
    <div className="drive-context-row">
      <h1 aria-label={choirName}><DriveSwitcher key={`${userId ?? "guest"}:${choirId}`} choirId={choirId} choirName={choirName} userId={userId} localOnly={localOnly} loading={loading} /></h1>
      <span className="drive-settings-control"><Link className="icon-button drive-settings-entry" to={`/choirs/${choirId}/settings`} aria-label={t("driveSettings")} aria-describedby={settingsHint} aria-disabled={loading || localOnly || undefined} onClick={event => { if (loading || localOnly) event.preventDefault(); }}>
        <Settings size={20} aria-hidden="true" />
      </Link><span id={settingsHint} role="tooltip" className="drive-settings-hint">{localOnly ? t("driveHeaderUseCloudDiskSettings") : t("driveSettings")}</span></span>
      {userId ? <DrivePersonalMenu key={`${userId}:${choirId}`} choirId={choirId} choirName={choirName} userId={userId} email={email} localOnly={localOnly} canManageIdentity={canManageIdentity} />
        : resolvingIdentity || loading ? <span className="drive-avatar" aria-label={t("driveHeaderRecoveringUser")}><UserRound aria-hidden="true" size={20} /></span>
        : <GuestMenu choirId={choirId} />}
    </div>
    <div className="drive-library-controls">
      <Form className="library-search drive-search" role="search" onSubmit={event => event.preventDefault()}>
        <TextField isDisabled={loading} value={search} onChange={onSearch} aria-label={t("driveHeaderSearchMusicScores", { choirName: String(choirName) })}><Input type="search" placeholder={t("driveHeaderSearchSheetMusic")} /></TextField>
      </Form>
      <LibrarySortControl view={view} disabled={loading} onSort={onSort ?? (() => {})} onDirection={onDirection ?? (() => {})} />
    </div>
  </header>;
}

function GuestMenu({ choirId }: { choirId: string }) {
  const t = useMessages("library");
  return <MenuTrigger><Button className="drive-avatar" aria-label={t("driveHeaderGuestOptions")}>{t("driveHeaderInterview")}</Button>
    <Popover className="file-menu-popover account-menu-popover"><Menu aria-label={t("driveHeaderGuestOptions")}>
      <MenuItem href={loginHref(`/choirs/${choirId}`)}>{t("driveHeaderLogRegister")}</MenuItem>
      <MenuItem href="/help">{t("driveHeaderUserManual")}</MenuItem>
      <MenuItem href="/diagnostics">{t("driveHeaderProblemFeedback")}</MenuItem>
      <MenuItem href="/about">{t("driveHeaderAboutUpdates")}</MenuItem>
    </Menu></Popover>
  </MenuTrigger>;
}
