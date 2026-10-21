import { choirMembershipsResponseSchema, type ChoirSummary } from "../../shared/choirs";
import { diagnosticFetch, parseDiagnosticResponse } from "../diagnostics/diagnostics";
import { localDatabase } from "../platform/local-database";
import { authenticatedLocalOwnerKey, captureLocalWorkspaceSession, createLocalWorkspace, withLocalWorkspaceTransaction } from "../platform/local-workspace";
import { captureNavigationIdentity, NAVIGATION_FRESH_MS, onMembershipDirectoryChange, onNavigationReset } from "../settings/navigation-events";
import { SettingsRequestError } from "../settings/settings-request";
import { getReadResource } from "../settings/read-resource";
import { readLocalDriveDirectories } from "./local-drive-directory";
import { driveCacheOwnerKey, rememberDriveSummary } from "./drive-library-cache";

export type MembershipEntry = { choir: ChoirSummary; isOwner: boolean | null };
export const membershipDirectoryKey = (userId: string) => ({ owner: userId, driveId: "", kind: "memberships" as const });
export const membershipSnapshotKey = (owner: string) => JSON.stringify(["membership-directory-v1", owner]);
export const membershipFreshMs = NAVIGATION_FRESH_MS;
const observedUsers = new Set<string>();
onNavigationReset(() => observedUsers.clear());
onMembershipDirectoryChange(() => { for (const userId of observedUsers) getReadResource(membershipDirectoryKey(userId)).invalidate(); });

export async function restoreMembershipDirectory(userId: string): Promise<MembershipEntry[]> {
  observedUsers.add(userId);
  const workspace = await captureLocalWorkspaceSession(createLocalWorkspace(authenticatedLocalOwnerKey(userId), "", ""));
  const saved = await withLocalWorkspaceTransaction(workspace, "r", [], () => localDatabase.system.get(membershipSnapshotKey(workspace.ownerKey)));
  if (saved) {
    try { return choirMembershipsResponseSchema.parse(JSON.parse(saved.value)).memberships.filter(row => !row.choir.isPreviewEntry); }
    catch { /* Older/incomplete records fall back to independently saved drives. */ }
  }
  return (await readLocalDriveDirectories(userId)).filter(row => row.membership && !row.accessRevoked && !row.choir.isPreviewEntry)
    .map(row => ({ choir: row.choir, isOwner: row.capabilities?.isOwner ?? null }));
}

export async function loadMembershipDirectory(userId: string, signal: AbortSignal): Promise<MembershipEntry[]> {
  observedUsers.add(userId);
  const current = captureNavigationIdentity();
  const workspace = captureLocalWorkspaceSession(createLocalWorkspace(authenticatedLocalOwnerKey(userId), "", "")).catch(() => null);
  const response = await diagnosticFetch("/api/choirs", { signal });
  signal.throwIfAborted();
  if (!response.ok) {
    if ([401, 403, 404].includes(response.status)) void workspace.then(scope => scope && current() && !signal.aborted ? withLocalWorkspaceTransaction(scope, "rw", [], () => localDatabase.system.delete(membershipSnapshotKey(scope.ownerKey))) : undefined).catch(() => undefined);
    throw new SettingsRequestError(response.status);
  }
  const payload = await parseDiagnosticResponse(response, choirMembershipsResponseSchema);
  signal.throwIfAborted();
  if (!current()) throw new DOMException("Identity changed", "AbortError");
  const memberships = payload.memberships.filter(row => !row.choir.isPreviewEntry);
  void workspace.then(scope => scope ? withLocalWorkspaceTransaction(scope, "rw", [], async () => {
    signal.throwIfAborted();
    if (!current()) return;
    await localDatabase.system.put({ key: membershipSnapshotKey(scope.ownerKey), value: JSON.stringify({ memberships }) });
  }) : undefined).catch(() => undefined);
  signal.throwIfAborted();
  memberships.forEach(({ choir }) => rememberDriveSummary(driveCacheOwnerKey(userId, choir.id), choir));
  return memberships;
}

// One open picker owns the row order; server order and changing labels cannot
// move an existing pointer target. Denied rows keep their slot until close.
export function reconcileMembershipRows(previous: MembershipEntry[], next: MembershipEntry[]) {
  const remaining = new Map(next.map(row => [row.choir.id, row]));
  const rows = previous.map(row => {
    const updated = remaining.get(row.choir.id);
    remaining.delete(row.choir.id);
    return { ...updated ?? row, unavailable: !updated };
  });
  const added = [...remaining.values()].sort((a, b) => a.choir.name.localeCompare(b.choir.name, "zh-CN") || a.choir.id.localeCompare(b.choir.id));
  return [...rows, ...added.map(row => ({ ...row, unavailable: false }))];
}
