import { buildId } from '../../shared/build';
import { canApplyUpdate, pageReloadBlocker } from './update-safety';
import { setUpdateStatus } from './update-status';
import { setPageRecoveryStatus } from './page-recovery-status';
import { requestWorker } from './worker-request';
const offlineRecoveryMessage = "shellRecovery.offline";

// Restore only this page, under the already-active worker. A reader/editor must
// first finish its normal guarded navigation; recovery never flushes or discards
// business state by itself, nor requires saved drafts to finish cloud upload.
export class ShellRecovery {
  private disposed = false;
  private checking = false;
  private pending: string | null = null;
  private requested = false;
  private verifyingReload = false;
  private offlineFailed = false;
  constructor(private reload: () => void) {}

  // Explicitly reopen this page under the active worker. This never activates
  // a waiting update, and the same editor/operation vetoes still apply.
  requestReload = () => {
    if (this.disposed) return;
    this.requested = true;
    this.pending = buildId;
    this.offlineFailed = false;
    this.tick();
  };

  check = async () => {
    const worker = navigator.serviceWorker?.controller;
    if (this.disposed || this.requested || this.checking || document.visibilityState !== 'visible' || !worker) return;
    this.checking = true;
    try {
      const reply = await requestWorker(worker, { type: 'SAME_PAGE_CHECK_SHELL', buildId });
      if (this.disposed || this.requested || navigator.serviceWorker?.controller !== worker || !reply || typeof reply !== 'object' || !('available' in reply)) return;
      if (reply.available === true) { this.pending = null; return; }
      if (reply.available !== false) return;
      this.pending = 'activeReady' in reply && reply.activeReady === true && 'activeBuild' in reply &&
        typeof reply.activeBuild === 'string' && /^(?:[a-f0-9]{7,40}|development)$/.test(reply.activeBuild) ? reply.activeBuild : null;
      setUpdateStatus({ phase: 'error', message: "", messageKey: this.pending
        ? "shellRecovery.expired"
        : "shellRecovery.unavailable" });
      this.tick();
    } finally { this.checking = false; }
  };

  tick = () => {
    if (this.disposed || !this.pending) return;
    if (this.requested) {
      const blocker = pageReloadBlocker();
      if (blocker) { setPageRecoveryStatus({ phase: 'waiting', message: "", messageKey: blocker }); return; }
      if (!navigator.onLine) {
        if (this.offlineFailed) setPageRecoveryStatus({ phase: 'offline', message: "", messageKey: offlineRecoveryMessage });
        else if (!this.verifyingReload) void this.reloadOffline();
        return;
      }
      this.offlineFailed = false;
    } else if (!canApplyUpdate()) return;
    if (!this.requested) try {
      const key = `same-page-shell-recovery:${this.pending}`;
      // Persist before reload. If storage is unavailable, offer recovery rather
      // than risk a reload loop; one attempt per target build per browser tab.
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, 'attempted');
    } catch { return; }
    this.pending = null;
    if (this.requested) setPageRecoveryStatus({ phase: 'reloading', message: "", messageKey: "shellRecovery.reloading" });
    this.reload();
  };

  private async reloadOffline() {
    this.verifyingReload = true;
    setPageRecoveryStatus({ phase: 'checking', message: "", messageKey: "shellRecovery.checking" });
    try {
      const worker = navigator.serviceWorker?.controller;
      const reply = worker && await requestWorker(worker, { type: 'SAME_PAGE_CHECK_SHELL', buildId }, 20_000);
      if (this.disposed || !this.pending) return;
      const verified = worker && navigator.serviceWorker?.controller === worker && reply && typeof reply === 'object' &&
        'available' in reply && reply.available === true && 'activeReady' in reply && reply.activeReady === true;
      if (!verified) {
        this.offlineFailed = true;
        setPageRecoveryStatus({ phase: 'offline', message: "", messageKey: offlineRecoveryMessage });
        return;
      }
      const blocker = pageReloadBlocker();
      if (blocker) { setPageRecoveryStatus({ phase: 'waiting', message: "", messageKey: blocker }); return; }
      this.pending = null;
      setPageRecoveryStatus({ phase: 'reloading', message: "", messageKey: "shellRecovery.verified" });
      this.reload();
    } finally { this.verifyingReload = false; }
  }

  dispose() { this.disposed = true; }
}
