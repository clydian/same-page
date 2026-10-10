import type { ReactNode } from "react";
import { DriveHeader } from "./drive-header";

// Startup, route-code loading and directory loading use the same drive layout.
export function DriveLoading({ choirId, choirName, header }: { choirId: string; choirName?: string; header?: ReactNode }) {
  return <div className="app-page drive-page">
    {header ?? <DriveHeader loading choirId={choirId} choirName={choirName ?? "云盘"} resolvingIdentity search="" onSearch={() => {}} onRefresh={() => {}} />}
    <main className="page-shell file-library">
      {choirName && <h1 className="visually-hidden">{choirName}</h1>}
      <p className="route-loading" role="status">正在加载乐谱…</p>
    </main>
  </div>;
}
