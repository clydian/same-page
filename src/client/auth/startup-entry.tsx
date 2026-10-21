import { DrivePage } from "../score-library/drive-page";
import { AppHeader } from "../components/app-header";
import { guestSessionResponseSchema } from "../../shared/choirs";
import { activateGuestLocalOwner } from "../platform/local-workspace";
import { useEffect, useState, type ReactNode } from "react";
import { Link, Navigate } from "react-router-dom";
import { choirMembershipsResponseSchema } from "../../shared/choirs";
import { diagnosticFetch, diagnosticScope, parseDiagnosticResponse } from "../diagnostics/diagnostics";
import { driveCacheOwnerKey, rememberDriveSummary } from "../score-library/drive-library-cache";
import { readLastDrive } from "../score-library/last-drive";
import { readLocalDriveDirectories } from "../score-library/local-drive-directory";
import type { ApplicationIdentity } from "./application-identity";

type EntryResult = { path: string; missingLastDrive?: boolean } | "home" | "failed";

function destination(userId: string, driveIds: string[]): EntryResult {
  const lastDrive = readLastDrive(userId);
  if (lastDrive && !driveIds.includes(lastDrive)) return { path: "/drives", missingLastDrive: true };
  const driveId = lastDrive ?? (driveIds.length === 1 ? driveIds[0] : null);
  return driveId ? { path: `/choirs/${driveId}` } : driveIds.length ? { path: "/drives" } : "home";
}

// This component only exists for a startup intent. Explicit home visits never
// mount it, so a late session/directory response cannot redirect those visits.
export function StartupEntry({ identity, children }: { identity: ApplicationIdentity; children: ReactNode }) {
  const userId = identity.authenticatedUserId ?? identity.localUserId;
  const online = identity.onlineState === "authenticated";
  const [result, setResult] = useState<{ userId: string | null; value: EntryResult } | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!userId && !identity.restoring) return;
    const ownerId = userId;
    const controller = new AbortController();
    const report = diagnosticScope();
    let localSettled = false;
    let cloudSettled = !online;
    const finish = (value: EntryResult) => {
      if (controller.signal.aborted) return;
      clearTimeout(timer);
      setResult({ userId: ownerId, value });
      // Fence late local reads and cancel an unnecessary cloud request after
      // a saved directory wins. Never cancel or clear business storage.
      controller.abort();
    };
    const timer = setTimeout(() => {
      if (!localSettled) report({ operation: "storage", category: "internal", stage: "prepare", errorType: "TimeoutError" });
      if (!cloudSettled) report({ operation: "drive", category: "network", stage: "request", errorType: "TimeoutError" });
      finish("failed");
    }, 10_000);
    if (ownerId) {
      // Independent reads: a stalled IndexedDB transaction must not prevent an
      // authenticated user from asking the server for their memberships.
      const local = localDestination(ownerId);
      void local.then(value => {
        localSettled = true;
        if (typeof value === "object" || !online) finish(value);
      });
      if (online) void (async () => {
        try {
          const response = await diagnosticFetch("/api/choirs", { signal: controller.signal });
          if (!response.ok) throw new Error("memberships_failed");
          const { memberships } = await parseDiagnosticResponse(response, choirMembershipsResponseSchema);
          if (controller.signal.aborted) return;
          const drives = memberships.filter(({ choir }) => !choir.isPreviewEntry);
          drives.forEach(({ choir }) => rememberDriveSummary(driveCacheOwnerKey(ownerId, choir.id), choir));
          cloudSettled = true;
          finish(destination(ownerId, drives.map(({ choir }) => choir.id)));
        } catch {
          if (controller.signal.aborted) return;
          cloudSettled = true;
          const value = await local;
          finish(value === "home" ? "failed" : value);
        }
      })();
    }
    return () => { clearTimeout(timer); controller.abort(); };
  }, [userId, online, retry, identity.restoring]);

  if (!userId && !identity.restoring) return identity.onlineState === "signed-out" ? <GuestStartupEntry>{children}</GuestStartupEntry> : children;
  if ((!result || result.userId !== userId) && userId) {
    const lastDrive = readLastDrive(userId);
    if (lastDrive) return <DrivePage choirId={lastDrive} />;
  }
  if (!result || result.userId !== userId) return <div className="app-page"><AppHeader /><p className="page-shell" role="status">正在恢复云盘…</p></div>;
  if (typeof result.value === "object") return <Navigate to={result.value.path} replace state={{ missingLastDrive: result.value.missingLastDrive }} />;
  if (result.value === "failed") return <div className="app-page"><AppHeader /><p className="page-shell" role="status">暂时无法加载已加入的云盘。<button className="text-button" onClick={() => { setResult(null); setRetry(value => value + 1); }}>重试</button> <Link to="/diagnostics">反馈问题</Link></p></div>;
  return children;
}

async function localDestination(userId: string): Promise<EntryResult> {
  try {
    const drives = (await readLocalDriveDirectories(userId)).filter(entry => entry.membership && !entry.choir.isPreviewEntry);
    // No saved membership means there is no local startup to restore. Keep the
    // public homepage available even when the network or local database fails.
    return drives.length ? destination(userId, drives.map(entry => entry.choirId)) : "home";
  } catch { return "home"; }
}

function GuestStartupEntry({ children }: { children: ReactNode }) {
  const [path, setPath] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    async function restore() {
      try {
        const response = await diagnosticFetch("/api/guest/session", { cache: "no-store", signal: controller.signal });
        if (!response.ok) return;
        const guest = await parseDiagnosticResponse(response, guestSessionResponseSchema);
        if (controller.signal.aborted || guest.entryKind === "preview") return;
        await activateGuestLocalOwner(guest.choir.id, controller.signal);
        if (!controller.signal.aborted) setPath(`/choirs/${guest.choir.id}`);
      } catch { /* The public homepage remains usable if admission is unavailable. */ }
    }
    void restore();
    return () => controller.abort();
  }, []);
  return path ? <Navigate to={path} replace /> : children;
}
