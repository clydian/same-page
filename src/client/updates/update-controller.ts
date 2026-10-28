import { shellDownloadTimeoutMs } from "../../shared/update-timing";
import { UpdateCheckSchedule } from "./update-check-schedule";
import { canApplyUpdate } from "./update-safety";
import { setUpdateStatus, type UpdatePhase, type UpdateStatus } from "./update-status";

const prepared = "更新已准备好";
const blocked = "请先在其他合谱窗口完成操作并返回文件库，或关闭那些窗口，再重试";

// One lifetime owns checks, installation observation and the explicit handover.
// Disposing it fences promises, worker events, message ports and timers together.
export class UpdateController {
  private disposed = false;
  private phase: UpdatePhase = "registering";
  private checkId = 0;
  private checking = false;
  private stopWorker?: () => void;
  private worker?: ServiceWorker;
  private checkTimer?: ReturnType<typeof setTimeout>;
  private installTimer?: ReturnType<typeof setTimeout>;
  private stopApply?: () => void;
  private autoRetryAt = 0;
  private deferred: UpdateStatus["deferred"];

  constructor(
    private registration: ServiceWorkerRegistration | undefined,
    private registrationError: boolean,
    private retryRegistration: () => void,
    private setRequested: (value: boolean) => void,
    private schedule = new UpdateCheckSchedule(),
  ) {}

  start() {
    if (!("serviceWorker" in navigator)) {
      this.show("unsupported", "当前浏览器不支持应用内更新，请关闭页面后重新打开");
    } else if (this.registration) {
      this.registration.addEventListener("updatefound", this.updateFound);
      if (!navigator.onLine || document.visibilityState === "visible") void this.check();
      else if (this.registration.installing) this.observe(this.registration.installing);
      else if (this.registration.waiting) this.show("ready", prepared);
    } else if (!navigator.onLine) {
      this.registrationError = true;
      this.schedule.failed();
      this.show("offline", "当前离线，联网后可重试；当前版本仍可使用");
    } else if (this.registrationError) {
      this.failedCheck("更新检查准备失败，请重试");
    } else {
      this.show("registering", "正在准备更新检查…");
      this.checkTimer = setTimeout(() => {
        this.registrationError = true;
        this.failedCheck("更新检查尚未准备好，请重试");
      }, 30000);
    }
  }

  private show(phase: UpdatePhase, message: string) {
    if (this.disposed) return;
    if ((phase !== "ready" && phase !== "applying") || this.deferred?.worker !== this.registration?.waiting) this.deferred = undefined;
    this.phase = phase;
    setUpdateStatus({ phase, message, ...(this.deferred ? { deferred: this.deferred } : {}) });
  }

  private failedCheck(message: string) {
    this.schedule.failed();
    this.show(this.registration?.waiting ? "ready" : "error", this.registration?.waiting ? prepared : message);
  }

  private endCheck() {
    ++this.checkId;
    this.checking = false;
    clearTimeout(this.checkTimer);
  }

  private isApplying() { return this.phase === "applying"; }

  private updateFound = () => {
    if (this.disposed || this.phase === "applying") return;
    if (this.registration?.installing) this.observe(this.registration.installing);
  };

  private observe(worker: ServiceWorker) {
    if (this.worker === worker) return;
    this.stopWorker?.();
    clearTimeout(this.installTimer);
    this.worker = worker;
    const changed = () => {
      if (this.disposed || this.worker !== worker || this.phase === "applying") return;
      if (worker.state === "redundant") {
        this.endCheck();
        this.stopWorker?.(); this.worker = undefined;
        clearTimeout(this.installTimer);
        this.failedCheck("更新准备失败，请重试；当前版本仍可使用");
      } else if (worker.state === "installed" || worker.state === "activated") {
        this.endCheck();
        clearTimeout(this.installTimer);
        this.schedule.succeeded();
        if (this.registration?.waiting) this.show("ready", prepared);
        else this.show("current", "检查完成，当前版本继续运行");
      } else {
        this.show("preparing", "正在准备更新…，可以继续使用");
      }
    };
    worker.addEventListener("statechange", changed);
    this.stopWorker = () => worker.removeEventListener("statechange", changed);
    this.installTimer = setTimeout(() => {
      if (this.disposed || this.worker !== worker || this.phase !== "preparing") return;
      // This is feedback, not a worker deadline: final verification, storage
      // and a quota-recovery attempt may still be running. Keep observing it.
      this.show("preparing", "更新准备较慢，仍在后台进行，可以继续使用");
    }, shellDownloadTimeoutMs);
    changed();
  }

  check = async () => {
    if (this.disposed || this.checking || this.phase === "applying" || this.phase === "preparing" || this.phase === "unsupported") return;
    if (!navigator.onLine) { this.schedule.failed(); this.show("offline", "当前离线，联网后可重试；当前版本仍可使用"); return; }
    if (!this.registration) {
      if (this.registrationError) {
        this.schedule.started();
        this.show("registering", "正在准备更新检查…");
        this.retryRegistration();
      }
      return;
    }
    this.schedule.started();
    this.checking = true;
    const id = ++this.checkId;
    this.show("checking", "正在检查更新…");
    this.checkTimer = setTimeout(() => {
      if (this.disposed || this.checkId !== id) return;
      ++this.checkId; this.checking = false;
      if (this.phase === "checking") this.failedCheck("更新检查仍未完成，请重试");
    }, 30000);
    try {
      // update() resolves before the installing worker necessarily finishes.
      const pending = this.registration.update();
      if (this.registration.installing) this.observe(this.registration.installing);
      await pending;
      if (this.disposed || id !== this.checkId || this.isApplying()) return;
      if (this.registration.installing) this.observe(this.registration.installing);
      else {
        this.schedule.succeeded();
        if (this.registration.waiting) this.show("ready", prepared);
        else if (this.phase === "checking") this.show("current", "检查完成，当前版本继续运行");
      }
    } catch {
      if (!this.disposed && id === this.checkId && this.phase === "checking") this.failedCheck("更新检查失败，请重试");
    } finally {
      if (id === this.checkId) { this.checking = false; clearTimeout(this.checkTimer); }
    }
  };

  private automaticCheck(foreground = false) {
    // Check/download authority is independent of reload safety. Readers may
    // prepare a release; the existing handover gate still protects their work.
    if (this.disposed || document.visibilityState !== "visible" || !navigator.onLine || this.phase === "ready") return;
    if (foreground) this.schedule.request();
    if (this.schedule.due()) void this.check();
  }

  foregroundCheck = () => this.automaticCheck(true);

  tick = () => {
    this.autoApply();
    this.automaticCheck();
  };

  autoApply = () => {
    if (this.phase === "ready" && this.deferred && this.deferred.worker !== this.registration?.waiting) {
      this.show(this.registration?.waiting ? "ready" : "error", this.registration?.waiting ? prepared : "已准备的更新暂不可用，请重新检查更新");
    }
    if (this.phase === "ready" && Date.now() >= this.autoRetryAt && canApplyUpdate()) this.beginApply(false);
  };

  apply = () => this.beginApply(true);

  private beginApply(manual: boolean) {
    if (this.disposed || this.phase === "applying") return;
    const waiting = this.registration?.waiting;
    if (!waiting) {
      this.show("error", "已准备的更新暂不可用，请重新检查更新");
      return;
    }
    if (!navigator.onLine) { this.show("ready", "当前离线，请联网后再更新"); return; }
    if (!canApplyUpdate(manual)) {
      if (!manual) return;
      this.deferred = undefined;
      this.show("ready", "请先完成当前操作并返回文件库，再重试更新");
      return;
    }
    this.endCheck();
    this.setRequested(manual);
    this.show("applying", "正在确认并应用更新…");
    let channel: MessageChannel;
    try { channel = new MessageChannel(); } catch {
      this.deferred = undefined;
      this.setRequested(false); this.show("ready", "更新未能开始，请重试"); return;
    }
    let active = true;
    const finish = (message: string, windowDeferred = false) => {
      if (!active || this.disposed) return;
      this.deferred = windowDeferred && this.registration?.waiting === waiting
        ? this.deferred?.worker === waiting ? this.deferred : { worker: waiting, since: Date.now() }
        : undefined;
      this.stopApply?.(); this.stopApply = undefined;
      this.setRequested(false);
      this.autoRetryAt = Date.now() + 10000;
      this.show(this.registration?.waiting ? "ready" : "error", !manual && this.registration?.waiting ? prepared : message);
    };
    const timeout = setTimeout(() => finish("更新未完成，请检查其他合谱窗口后重试"), 10000);
    this.stopApply = () => { active = false; clearTimeout(timeout); channel.port1.close(); };
    channel.port1.onmessage = event => {
      if (!active || this.disposed) return;
      if (event.data?.safe === true) { this.deferred = undefined; this.show("applying", "正在应用更新…"); }
      else finish(event.data?.reason === "incomplete" ? "更新资源暂不可用，请联网后重试" : blocked, event.data?.safe === false && event.data?.reason !== "incomplete");
    };
    try { waiting.postMessage({ type: "SAME_PAGE_SAFE_UPDATE", requested: true, ...(!manual ? { automatic: true } : {}) }, [channel.port2]); }
    catch { finish("更新未能开始，请稍后重试，或关闭所有合谱窗口后重新打开"); }
  }

  dispose() {
    this.disposed = true;
    ++this.checkId;
    this.registration?.removeEventListener("updatefound", this.updateFound);
    this.stopWorker?.(); this.stopApply?.();
    clearTimeout(this.checkTimer); clearTimeout(this.installTimer);
    this.setRequested(false);
  }
}
