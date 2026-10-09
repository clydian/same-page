import type { AnnotationConflictRecord } from "../platform/local-database";
import { syncReader } from "./sync-reader";
import { diagnosticScope } from "../diagnostics/diagnostics";
import { diagnoseLocalOperation } from "../diagnostics/local-operation";
import { AnnotationConflictChangedError, discardAnnotationConflict, queueScoreDrafts, readScoreAnnotationState, reapplyAnnotationConflict, retryScoreSyncErrors } from "../annotations/annotation-state";
import { assertLocalWorkspaceActive, type LocalWorkspace } from "../platform/local-workspace";
import type { ReaderSyncOutcome } from "./reader-sync-status";

type Access = { authenticated: boolean; online: boolean; trashed: boolean; confirmIdentity: () => Promise<unknown> };

// User intents only. Scheduling, push coalescing and authority fences remain in
// the existing sync/outbox modules; this object owns no background scheduler.
export class ReaderAnnotationActions {
  private controller = new AbortController();
  constructor(private workspace: LocalWorkspace, private access: Access) {}
  start() { this.controller.abort(); this.controller = new AbortController(); }
  stop() { this.controller.abort(); }

  private async check(signal: AbortSignal) {
    signal.throwIfAborted();
    await assertLocalWorkspaceActive(this.workspace);
    signal.throwIfAborted();
  }

  async retry(): Promise<ReaderSyncOutcome | null> {
    const signal = this.controller.signal;
    const diagnostics = { report: diagnosticScope(), signal };
    try {
      await this.check(signal);
      if (this.access.trashed) return "trash-preserved";
      if (!this.access.authenticated) {
        await this.access.confirmIdentity();
        await this.check(signal);
        await syncReader(this.workspace, { signal, push: false });
        return "synced";
      }
      await diagnoseLocalOperation("sync-retry", () => retryScoreSyncErrors(this.workspace), diagnostics);
      await this.check(signal);
      await diagnoseLocalOperation("draft-save", () => queueScoreDrafts(this.workspace), diagnostics);
      await this.check(signal);
      await syncReader(this.workspace, { signal });
      await this.check(signal);
      const state = await diagnoseLocalOperation("sync-retry", () => readScoreAnnotationState(this.workspace), diagnostics);
      await this.check(signal);
      return state.syncErrorCount > 0 ? "failed" : "synced";
    } catch { return signal.aborted ? null : "failed"; }
  }

  async refreshConflicts() {
    const signal = this.controller.signal;
    await this.check(signal);
    if (!this.access.online || !this.access.authenticated || this.access.trashed) return false;
    const result = await syncReader(this.workspace, { signal, push: false, fresh: true });
    await this.check(signal);
    return result.state === "active";
  }

  async resolveConflict(opId: string, strategy: "discard" | "reapply" | "keep-both", reviewed?: AnnotationConflictRecord): Promise<ReaderSyncOutcome | null> {
    let saved = false;
    const signal = this.controller.signal;
    const diagnostics = { report: diagnosticScope(), signal };
    try {
      await this.check(signal);
      if (reviewed && this.access.online) {
        if (!await this.refreshConflicts()) throw new Error("conflict_refresh_unavailable");
        await this.check(signal);
      }
      if (strategy === "discard") {
        await diagnoseLocalOperation("conflict-resolve", () => discardAnnotationConflict(this.workspace, opId, reviewed), diagnostics);
        await this.check(signal);
        return "conflict-discarded";
      }
      await reapplyAnnotationConflict(this.workspace, opId, strategy === "keep-both", reviewed);
      await this.check(signal);
      await diagnoseLocalOperation("draft-save", () => queueScoreDrafts(this.workspace), diagnostics);
      saved = true;
      await this.check(signal);
      if (!this.access.online || !this.access.authenticated || this.access.trashed) return "local-saved";
      await syncReader(this.workspace, { signal });
      await this.check(signal);
      return "conflict-reapplied";
    } catch (error) { return signal.aborted ? null : error instanceof AnnotationConflictChangedError ? "conflict-changed" : saved ? "local-saved" : "failed"; }
  }
}
