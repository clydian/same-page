import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
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
  const [cloudCheck, setCloudCheck] = useState<{ workspace: LocalWorkspace; at: number } | null>(null);
  useEffect(() => {
    if (!workspace) return;
    return subscribeReaderSync(workspace, result => {
      if (result.state === "active") setCloudCheck({ workspace, at: Date.now() });
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
  const status = deriveReaderSyncStatus({
    localOnly,
    outcome: localOnly ? outcome : access.trashed ? "trash-preserved" : activity === "failed" && online ? "failed" : outcome,
    syncing,
    loaded: annotationState !== null,
    draftCount: annotations.filter(annotation => annotation.state === "draft").length,
    acceptedCount: annotations.filter(annotation => annotation.state === "synced" && annotation.version > 0).length,
    permissionErrorCount: annotations.filter(annotation => annotation.syncErrorCode === "permission_denied" ||
      (annotation.state !== "synced" && !layers.some(layer => layer.id === annotation.layerId && layer.canEdit))).length,
    online,
    pendingCount: annotationState?.pendingCount ?? 0,
    conflictCount: annotationState?.conflicts.length ?? 0,
    syncErrorCount: annotationState?.syncErrorCount ?? 0,
  });
  const canRetry = !localOnly && online && !syncing && !access.trashed && actions !== null;

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
  const resolveConflict = async (opId: string, strategy: "discard" | "reapply" | "keep-both") => {
    const active = current.current;
    if (!actions || active?.actions !== actions) return;
    const result = await actions.resolveConflict(opId, strategy);
    if (current.current === active && result) reportOutcome(result);
  };

  return {
    annotationState, online, localOnly, status, syncing, canRetry,
    lastCheckedAt: cloudCheck?.workspace === workspace ? cloudCheck?.at ?? null : null,
    reportOutcome, retry, resolveConflict,
  };
}
