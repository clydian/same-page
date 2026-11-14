import { ConnectionHelp } from "../connection/connection-control";
import type { ReactNode } from "react";
import { DriveHeader } from "./drive-header";

// Startup, route-code loading and directory loading use the same drive layout.
export function DrivePage({ choirId, choirName, header, children, connectionHelp }: { choirId: string; choirName?: string; header?: ReactNode; children?: ReactNode; connectionHelp?: ReactNode }) {
  return <div className="app-page drive-page">
    <ConnectionHelp>{connectionHelp}</ConnectionHelp>
    {header ?? <DriveHeader loading choirId={choirId} choirName={choirName ?? "云盘"} resolvingIdentity search="" onSearch={() => {}} />}
    {children ?? <main className="page-shell file-library">
      <p className="route-loading" role="status">正在加载乐谱…</p>
    </main>}
  </div>;
}
