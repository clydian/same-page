import { buildId } from '../../shared/build';
import { canApplyUpdate } from './update-safety';
import { setUpdateStatus } from './update-status';
import { requestWorker } from './worker-request';

// Restore only this page, under the already-active worker. A reader/editor must
// first finish its normal guarded navigation; recovery never flushes or discards
// business state by itself, nor requires saved drafts to finish cloud upload.
export class ShellRecovery {
  private disposed = false;
  private checking = false;
  private pending: string | null = null;
  private requested = false;
  constructor(private reload: () => void) {}

  // Explicitly reopen this page under the active worker. This never activates
  // a waiting update, and the same editor/operation vetoes still apply.
  requestReload = () => {
    if (this.disposed) return;
    this.requested = true;
    this.pending = buildId;
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
      setUpdateStatus({ phase: 'error', message: this.pending
        ? '当前版本资源已失效，完成操作并返回文件库后将恢复。'
        : '当前版本资源暂不可用，请联网后检查更新；本机内容仍保留。' });
      this.tick();
    } finally { this.checking = false; }
  };

  tick = () => {
    if (this.disposed || !this.pending || !canApplyUpdate(this.requested)) return;
    if (!this.requested) try {
      const key = `same-page-shell-recovery:${this.pending}`;
      // Persist before reload. If storage is unavailable, offer recovery rather
      // than risk a reload loop; one attempt per target build per browser tab.
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, 'attempted');
    } catch { return; }
    this.pending = null;
    this.reload();
  };

  dispose() { this.disposed = true; }
}
