import { useMessages } from "../../i18n";
import { useId } from "react";
import { Link } from "react-router-dom";
import { Settings } from "lucide-react";
import { Form, Input, TextField } from "react-aria-components";
import { DriveSwitcher } from "./drive-switcher";
import { LibrarySortControl } from "./library-sort-control";
import type { LibrarySort, LibrarySortDirection, LibraryView } from "./library-view-state";

export function DriveHeader({ choirId, choirName, userId, search, onSearch,
  localOnly = false, loading = false,
  view = { sort: "name" }, onSort, onDirection,
}: {
  choirId: string; choirName: string; userId?: string; search: string;
  onSearch: (value: string) => void;
  loading?: boolean; localOnly?: boolean;
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
    </div>
    <div className="drive-library-controls">
      <Form className="library-search drive-search" role="search" onSubmit={event => event.preventDefault()}>
        <TextField isDisabled={loading} value={search} onChange={onSearch} aria-label={t("driveHeaderSearchMusicScores", { choirName: String(choirName) })}><Input type="search" placeholder={t("driveHeaderSearchSheetMusic")} /></TextField>
      </Form>
      <LibrarySortControl view={view} disabled={loading} onSort={onSort ?? (() => {})} onDirection={onDirection ?? (() => {})} />
    </div>
  </header>;
}
