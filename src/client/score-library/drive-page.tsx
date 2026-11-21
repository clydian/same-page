import { ConnectionHelp } from "../connection/connection-control";
import { useMessages } from "../../i18n";
import type { ReactNode } from "react";
import { DriveHeader } from "./drive-header";
import "./drive-page.css";

// Startup, route-code loading and directory loading use the same drive layout.
export function DrivePage({ choirId, choirName, header, children, connectionHelp }: { choirId: string; choirName?: string; header?: ReactNode; children?: ReactNode; connectionHelp?: ReactNode }) {
  const t = useMessages("library");
  return <div className="app-page drive-page" onContextMenu={event => {
    const target = event.target;
    // React portals also bubble here. Leave dialogs and all controls to their
    // existing handlers, including mouse/keyboard menus on file links.
    if (!(target instanceof Element) || !event.currentTarget.contains(target) ||
      target.closest('a, button, input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="menu"], [role="menuitem"]')) return;
    event.preventDefault();
  }}>
    <ConnectionHelp>{connectionHelp}</ConnectionHelp>
    {header ?? <DriveHeader loading choirId={choirId} choirName={choirName ?? t("drive")} resolvingIdentity search="" onSearch={() => {}} />}
    {children ?? <main className="page-shell file-library">
      <p className="route-loading" role="status">{t("driveLoadingSheetMusic")}</p>
    </main>}
  </div>;
}
