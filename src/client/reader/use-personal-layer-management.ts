import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { annotationLayerListResponseSchema, type AnnotationLayerSummary } from "../../shared/annotations";
import { isLocalExperience } from "../annotations/guest-notes";
import { readScoreAnnotationState } from "../annotations/annotation-state";
import { diagnosticFetch } from "../diagnostics/diagnostics";
import {
  assertLocalWorkspaceActive, captureLocalWorkspaceSession, LocalWorkspaceOwnerChangedError,
  type LocalWorkspace,
} from "../platform/local-workspace";
import { captureSettingsLifetime, useSettingsLifetime } from "../settings/use-settings-lifetime";
import { syncReader } from "./sync-reader";

export type PersonalLayerChange = { name: string } | { sharing: boolean } | { action: "delete" | "restore" };
type Operation =
  | { kind: "create"; id: string; name: string }
  | { kind: "change"; layer: AnnotationLayerSummary; change: PersonalLayerChange }
  | { kind: "deleted" };
type Attempt = { operation: Operation; workspace?: LocalWorkspace; refreshOnly: boolean; conflict: boolean };
type Feedback = { target: string | null; name: string; inDeleted: boolean; message: string };
class DeletionCheckError extends Error {}

// Mount inside the workspace-keyed panel. Every entry point, including retry,
// crosses the same admission gate and retains the original operation/session.
export function usePersonalLayerManagement(workspace: LocalWorkspace, signedIn: boolean) {
  const enabled = signedIn && !isLocalExperience(workspace);
  const lifetime = useSettingsLifetime();
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const gate = useRef({ busy: false, needsRefresh: false, retired: false });
  const attempt = useRef<Attempt | null>(null);
  const creationId = useRef<string | null>(null);
  const deletedRequested = useRef(false);
  const [creating, setCreating] = useState(false);
  const [pending, setPending] = useState(false);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [retired, setRetired] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [canRetry, setCanRetry] = useState(false);
  const [deleted, setDeleted] = useState<AnnotationLayerSummary[]>([]);
  const [deletedLoaded, setDeletedLoaded] = useState(false);
  const [previousEnabled, setPreviousEnabled] = useState(enabled);
  if (previousEnabled !== enabled) {
    setPreviousEnabled(enabled);
    setPending(false); setNeedsRefresh(false); setCanRetry(false); setFeedback(null);
  }
  useLayoutEffect(() => {
    if (enabled) return;
    // Losing cloud authentication need not change the offline owner or unmount
    // the panel. Retire remote work while preserving the user's form input.
    controller.current?.abort();
    gate.current.busy = false;
    gate.current.needsRefresh = false;
    attempt.current = null;
  }, [enabled]);

  const run = async (current: Attempt) => {
    if (!enabled || gate.current.busy || gate.current.retired) return false;
    gate.current.busy = true;
    attempt.current = current;
    const operation = current.operation;
    const target = operation.kind === "change" ? operation.layer : null;
    const context = { target: target?.id ?? null, name: target?.name ?? "",
      inDeleted: operation.kind === "deleted" || (operation.kind === "change" && "action" in operation.change && operation.change.action === "restore") };
    setPending(true); setCanRetry(false); setFeedback({ ...context, message: "" });
    const active = captureSettingsLifetime(lifetime);
    const signal = (controller.current = new AbortController()).signal;
    const isCurrent = () => active() && !signal.aborted;
    const check = async () => {
      signal.throwIfAborted();
      await assertLocalWorkspaceActive(current.workspace!);
      signal.throwIfAborted();
    };
    const readDeleted = async () => {
      await check();
      const response = await diagnosticFetch(`${base}/layers?state=deleted`, { signal });
      await check();
      if (!response.ok) throw new Error("deleted_layers_refresh_failed");
      const result = annotationLayerListResponseSchema.parse(await response.json());
      await check();
      setDeleted(result.layers.filter(layer => layer.kind === "personal" && layer.canEdit && layer.deletedAt));
      setDeletedLoaded(true);
    };
    const base = `/api/choirs/${encodeURIComponent(workspace.choirId)}/scores/${encodeURIComponent(workspace.scoreId)}`;
    try {
      current.workspace ??= await captureLocalWorkspaceSession(workspace);
      await check();
      if (operation.kind === "deleted") {
        deletedRequested.current = true;
        await readDeleted();
      } else {
        if (!current.refreshOnly) {
          if (operation.kind === "change" && "action" in operation.change && operation.change.action === "delete") {
            let state;
            try { state = await readScoreAnnotationState(current.workspace); }
            catch (error) {
              if (error instanceof LocalWorkspaceOwnerChangedError) throw error;
              throw new DeletionCheckError("无法确认本机内容，请重试。");
            }
            await check();
            if (state.annotations.some(note => note.layerId === operation.layer.id && note.state !== "synced") || state.conflicts.some(note => note.layerId === operation.layer.id)) {
              throw new DeletionCheckError("此层有未同步内容或冲突，请先完成同步和冲突处理，再删除。");
            }
          }
          const path = operation.kind === "create" ? "personal-layers" : `personal-layers/${encodeURIComponent(operation.layer.id)}`;
          const body = operation.kind === "create" ? { id: operation.id, name: operation.name }
            : { ...operation.change, expectedRevision: operation.layer.revision ?? 0 };
          const response = await diagnosticFetch(`${base}/${path}`, {
            method: operation.kind === "create" ? "POST" : "PUT", signal,
            headers: { "content-type": "application/json" }, body: JSON.stringify(body),
          });
          await check();
          current.conflict = response.status === 409;
          current.refreshOnly = response.ok || current.conflict;
          if (!response.ok) throw new Error("personal_layer_update_failed");
          if (operation.kind === "create") { creationId.current = null; setCreating(false); }
        }
        await check();
        await syncReader(current.workspace, { fresh: true, signal });
        await check();
        if (deletedRequested.current) await readDeleted();
      }
      gate.current.needsRefresh = false;
      setNeedsRefresh(false);
      setFeedback(current.conflict ? { ...context, message: "图层已刷新，请核对当前状态后重新操作。" } : null);
      attempt.current = null;
      return true;
    } catch (error) {
      if (!isCurrent()) return false;
      // Network failures also need the session fence: no response means the
      // post-request check did not run, but the old intent must still retire.
      let ownerChanged = error instanceof LocalWorkspaceOwnerChangedError;
      if (current.workspace) {
        try { await check(); }
        catch (fenceError) { ownerChanged ||= fenceError instanceof LocalWorkspaceOwnerChangedError; }
      }
      if (!isCurrent()) return false;
      if (ownerChanged) {
        gate.current.retired = true; setRetired(true); setFeedback(null); attempt.current = null;
        return false;
      }
      gate.current.needsRefresh = current.refreshOnly;
      setNeedsRefresh(current.refreshOnly);
      setFeedback({ ...context, message: error instanceof DeletionCheckError ? error.message
        : operation.kind === "deleted" ? "个人层列表读取失败，请重试。"
        : current.refreshOnly && !current.conflict ? "修改已保存，内容刷新失败。请重试刷新。"
        : "修改尚未确认，请检查网络后重试。" });
      setCanRetry(true);
      return false;
    } finally {
      if (isCurrent()) { gate.current.busy = false; setPending(false); }
    }
  };
  const submit = (operation: Operation) => {
    if (gate.current.needsRefresh) return Promise.resolve(false);
    return run({ operation: structuredClone(operation), refreshOnly: false, conflict: false });
  };
  return {
    creating, pending, blocked: !enabled || retired || pending || needsRefresh,
    feedback, deleted, deletedLoaded,
    startCreation: () => {
      if (!enabled || gate.current.busy || gate.current.needsRefresh || gate.current.retired) return;
      creationId.current ??= crypto.randomUUID(); setCreating(true);
    },
    cancelCreation: () => {
      if (gate.current.busy) return;
      creationId.current = null; setCreating(false);
      if (attempt.current?.operation.kind === "create" && !attempt.current.refreshOnly) {
        attempt.current = null; setCanRetry(false); setFeedback(null);
      }
    },
    create: (name: string) => creationId.current
      ? submit({ kind: "create", id: creationId.current, name: name.trim() }) : Promise.resolve(false),
    change: (layer: AnnotationLayerSummary, change: PersonalLayerChange) => submit({ kind: "change", layer, change }),
    loadDeleted: () => submit({ kind: "deleted" }),
    retry: canRetry ? () => attempt.current ? run(attempt.current) : Promise.resolve(false) : null,
  };
}
