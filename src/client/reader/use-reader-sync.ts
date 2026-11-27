import { useAppLocale } from "../../i18n";
import type { AnnotationConflictRecord } from "../platform/local-database";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { readScoreAnnotationState } from "../annotations/annotation-state";
import { isLocalExperience } from "../annotations/guest-notes";
import { getAnnotationSyncActivity, subscribeAnnotationSync } from "../annotations/sync";
import type { LocalWorkspace } from "../platform/local-workspace";
import { deriveReaderSyncStatus, type ReaderSyncOutcome } from "./reader-sync-status";
import { subscribeReaderSync } from "./sync-reader";
import { ReaderAnnotationActions } from "./reader-annotation-actions";

type ReaderSyncAccess = {
  authenticatedUserId: string | null;
  sessionId: string | null;
  trashed: boolean;
  confirmIdentity: () => Promise<unknown>;
};

// Owns feedback, not synchronization: durable facts and request scheduling stay
// in the annotation store, ReaderAnnotationActions and the existing sync modules.
export function useReaderSync(workspace: LocalWorkspace | null, access: ReaderSyncAccess) {
  const { locale } = useAppLocale();
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);
  const { authenticatedUserId, sessionId, trashed, confirmIdentity } = access;
  const actions = useMemo(() => workspace ? new ReaderAnnotationActions(workspace, {
    authenticated: Boolean(authenticatedUserId && sessionId), online, trashed, confirmIdentity,
  }) : null, [workspace, authenticatedUserId, sessionId, online, trashed, confirmIdentity]);
  const current = useRef<{ actions: typeof actions; retrying: boolean } | null>(null);
  const [feedback, setFeedback] = useState({ workspace, actions, outcome: "none" as ReaderSyncOutcome, retrying: false });
  useEffect(() => {
    actions?.start();
    current.current = { actions, retrying: false };
    return () => { current.current = null; actions?.stop(); };
  }, [actions]);
  const reportOutcome = (outcome: ReaderSyncOutcome) => {
    if (current.current?.actions !== actions) return;
    setFeedback({ workspace, actions, outcome, retrying: current.current.retrying });
  };

  const activity = useSyncExternalStore(subscribeAnnotationSync,
    () => getAnnotationSyncActivity(workspace?.scopeKey ?? "", workspace?.sessionEpoch));
  useEffect(() => subscribeAnnotationSync(() => {
    if (getAnnotationSyncActivity(workspace?.scopeKey ?? "", workspace?.sessionEpoch) === "running") {
      setFeedback(previous => ({ ...previous, outcome: "none" }));
    }
  }), [workspace?.scopeKey, workspace?.sessionEpoch]);
  const [cloudCheck, setCloudCheck] = useState<{
    workspace: LocalWorkspace;
    at: number | null;
    availability?: "unavailable" | "denied";
  } | null>(null);
  useEffect(() => {
    if (!workspace) return;
    return subscribeReaderSync(workspace, result => {
      if (result.state === "active") {
        setCloudCheck({ workspace, at: Date.now() });
      } else if (result.state === "network-unavailable" || result.state === "service-unavailable" || result.state === "permission-denied") {
        const availability = result.state === "permission-denied" ? "denied" : "unavailable";
        setCloudCheck(previous => ({
          workspace, at: previous?.workspace === workspace ? previous.at : null,
          // A later transport failure cannot undo a confirmed denial.
          availability: previous?.workspace === workspace && previous.availability === "denied" ? "denied" : availability,
        }));
      }
    });
  }, [workspace]);

  const state = useLiveQuery(
    async () => workspace ? { workspace, state: await readScoreAnnotationState(workspace).catch(() => null) } : null,
    [workspace], null,
  );
  const annotationState = state?.workspace === workspace ? state?.state ?? null : null;
  const annotations = annotationState?.annotations ?? [];
  const layers = annotationState?.layers ?? [];
  const localOnly = workspace ? isLocalExperience(workspace) : false;
  const outcome = feedback.workspace === workspace ? feedback.outcome : "none";
  const syncing = (feedback.actions === actions && feedback.retrying) || activity === "running";
  const cloudAvailability = cloudCheck?.workspace === workspace ? cloudCheck.availability : undefined;
  const status = deriveReaderSyncStatus({
    localOnly,
    outcome: !localOnly && access.trashed ? "trash-preserved" : outcome,
    syncing,
    loaded: annotationState !== null,
    checkingLocal: state?.workspace !== workspace,
    cloudAvailability,
    draftCount: annotations.filter(annotation => annotation.state === "draft").length,
    acceptedCount: annotations.filter(annotation => annotation.state === "synced" && annotation.version > 0).length,
    permissionErrorCount: annotations.filter(annotation => annotation.syncErrorCode === "permission_denied" ||
      (annotation.state !== "synced" && !layers.some(layer => layer.id === annotation.layerId && layer.canEdit))).length,
    online,
    pendingCount: annotationState?.pendingCount ?? 0,
    conflictCount: annotationState?.conflicts.length ?? 0,
    syncErrorCount: annotationState?.syncErrorCount ?? 0,
  }, locale);
  const canRetry = !localOnly && online && !syncing && !access.trashed && actions !== null;
  const retrySuggested = status.kind === "failed" || status.kind === "unavailable" ||
    status.kind === "risk" && cloudAvailability === "denied" ||
    status.kind === "pending" && (activity === "failed" || outcome === "sync-attempt-failed" || cloudAvailability === "unavailable");

  const retry = async () => {
    const active = current.current;
    if (!canRetry || !actions || active?.actions !== actions || active.retrying) return;
    active.retrying = true;
    setFeedback({ workspace, actions, outcome, retrying: true });
    try {
      const result = await actions.retry();
      if (current.current === active && result) reportOutcome(result);
    } finally {
      if (current.current === active) {
        active.retrying = false;
        setFeedback(previous => ({ ...previous, retrying: false }));
      }
    }
  };
  const refreshConflicts = useCallback(async () => {
    const active = current.current;
    if (!actions || active?.actions !== actions) return false;
    try { return await actions.refreshConflicts() && current.current === active; } catch { return false; }
  }, [actions]);
  const resolveConflict = async (opId: string, strategy: "discard" | "reapply" | "keep-both", reviewed?: AnnotationConflictRecord) => {
    const active = current.current;
    if (!actions || active?.actions !== actions) return null;
    const result = await actions.resolveConflict(opId, strategy, reviewed);
    if (current.current !== active) return null;
    if (result) reportOutcome(result);
    return result;
  };

  return {
    annotationState, online, localOnly, status, syncing, canRetry, retrySuggested,
    lastCheckedAt: cloudCheck?.workspace === workspace ? cloudCheck?.at ?? null : null,
    reportOutcome, retry, refreshConflicts, resolveConflict,
  };
}
