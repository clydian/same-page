import type { ReactNode } from "react";
import { DriveHeader } from "./drive-header";

// Startup, route-code loading and directory loading use the same drive layout.
export function DrivePage({ choirId, choirName, header, children }: { choirId: string; choirName?: string; header?: ReactNode; children?: ReactNode }) {
  return <div className="app-page drive-page">
    {header ?? <DriveHeader loading choirId={choirId} choirName={choirName ?? "云盘"} resolvingIdentity search="" onSearch={() => {}} onRefresh={() => {}} />}
    {children ?? <main className="page-shell file-library">
      {choirName && <h1 className="visually-hidden">{choirName}</h1>}
      <p className="route-loading" role="status">正在加载乐谱…</p>
    </main>}
  </div>;
}
