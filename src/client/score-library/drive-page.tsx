import { ConnectionHelp } from "../connection/connection-control";
import { useMessages } from "../../i18n";
import type { ReactNode } from "react";
import { DriveHeader } from "./drive-header";

// Startup, route-code loading and directory loading use the same drive layout.
export function DrivePage({ choirId, choirName, header, children, connectionHelp }: { choirId: string; choirName?: string; header?: ReactNode; children?: ReactNode; connectionHelp?: ReactNode }) {
  const t = useMessages("library");
  return <div className="app-page drive-page">
    <ConnectionHelp>{connectionHelp}</ConnectionHelp>
    {header ?? <DriveHeader loading choirId={choirId} choirName={choirName ?? t("drive")} resolvingIdentity search="" onSearch={() => {}} />}
    {children ?? <main className="page-shell file-library">
      <p className="route-loading" role="status">{t("driveLoadingSheetMusic")}</p>
    </main>}
  </div>;
}
