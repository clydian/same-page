import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { getReadResource } from "../settings/read-resource";
import { useReadResource } from "../settings/use-read-resource";
import { membershipDirectoryRevision, onMembershipDirectoryChange } from "../settings/navigation-events";
import { loadMembershipDirectory, membershipDirectoryKey, membershipFreshMs, reconcileMembershipRows, restoreMembershipDirectory, type MembershipEntry } from "./membership-directory";


type Rows = ReturnType<typeof reconcileMembershipRows>;

export function useMembershipDirectory(userId: string, localOnly = false) {
  const [localFailure, setLocalFailure] = useState<string | null>(null);
  const resource = getReadResource<MembershipEntry[]>(membershipDirectoryKey(userId));
  useEffect(() => { if (localOnly) resource.invalidate(); }, [localOnly, resource]);
  const directory = useReadResource(membershipDirectoryKey(userId), signal => loadMembershipDirectory(userId, signal), async () => {
    try { return await restoreMembershipDirectory(userId); }
    catch { setLocalFailure(userId); return null; }
  }, membershipFreshMs, !localOnly);
  const revision = useSyncExternalStore(onMembershipDirectoryChange, membershipDirectoryRevision);
  const seenRevision = useRef(revision);
  const { refresh } = directory;
  useEffect(() => {
    if (seenRevision.current === revision) return;
    seenRevision.current = revision;
    if (!localOnly) void refresh().catch(() => undefined);
  }, [revision, localOnly, refresh]);
  const [presentation, setPresentation] = useState<{ userId: string; data: MembershipEntry[] | null; rows: Rows }>({ userId, data: null, rows: [] });
  let rows = presentation.rows;
  if (presentation.userId !== userId || presentation.data !== directory.data) {
    rows = reconcileMembershipRows(presentation.userId === userId ? presentation.rows : [], directory.data ?? []);
    setPresentation({ userId, data: directory.data, rows });
  }
  // Endpoint denial clears protected presentation; temporary failures retain it.
  if (directory.authority === "signed-out" || directory.authority === "revoked") rows = [];
  const failed = Boolean(directory.error) && !localOnly;
  const knownEmpty = directory.data !== null && !directory.data.length && (localOnly || directory.authority === "confirmed");
  if (knownEmpty) rows = [];
  return { directory, rows, failed, knownEmpty, localFailure: localFailure === userId };
}
