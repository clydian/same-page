import { shellDownloadTimeoutMs } from "../../shared/update-timing";
import { UpdateCheckSchedule } from "./update-check-schedule";
import { parseInstallProgress, type InstallProgress } from '../../shared/update-progress';
import { requestWorker } from './worker-request';
import { canApplyUpdate } from "./update-safety";
import { setUpdateStatus, type UpdatePhase, type UpdateStatus } from "./update-status";

const prepared = "updateController.prepared";
const blocked = "updateController.otherWindows";

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
  private progress?: InstallProgress;
  private initialInstall = false;
  private slowPreparation = false;

  constructor(
    private registration: ServiceWorkerRegistration | undefined,
    private registrationError: boolean,
    private retryRegistration: () => void,
    private setRequested: (value: boolean) => void,
    private schedule = new UpdateCheckSchedule(),
  ) {}

  start() {
    navigator.serviceWorker?.addEventListener?.('message', this.progressMessage);
    if (!("serviceWorker" in navigator)) {
      this.show("unsupported", "updateController.unsupported");
    } else if (this.registration) {
      this.registration.addEventListener("updatefound", this.updateFound);
      if (this.registration.installing) this.observe(this.registration.installing);
      else if (!navigator.onLine || document.visibilityState === "visible") void this.check();
      else if (this.registration.waiting) this.show("ready", prepared);
    } else if (!navigator.onLine) {
      this.registrationError = true;
      this.schedule.failed();
      this.show("offline", "updateController.offline");
    } else if (this.registrationError) {
      this.failedCheck("updateController.registrationFailed");
    } else {
      this.show("registering", "updateController.registering");
      this.checkTimer = setTimeout(() => {
        this.registrationError = true;
        this.failedCheck("updateController.registrationTimeout");
      }, 30000);
    }
  }

  private show(phase: UpdatePhase, messageKey: string) {
    if (this.disposed) return;
    if ((phase !== "ready" && phase !== "applying") || this.deferred?.worker !== this.registration?.waiting) this.deferred = undefined;
    this.phase = phase;
    setUpdateStatus({ phase, message: "", messageKey, ...(this.initialInstall ? {initialInstall:true} : {}), ...((phase === "preparing" || phase === "current" && this.initialInstall) && this.progress ? {progress:this.progress} : {}), ...(this.deferred ? { deferred: this.deferred } : {}) });
  }

  private failedCheck(messageKey: string) {
    this.schedule.failed();
    this.show(this.registration?.waiting ? "ready" : "error", this.registration?.waiting ? prepared : messageKey);
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
    this.progress = undefined; this.slowPreparation = false;
    this.initialInstall = navigator.serviceWorker?.controller === null && !this.registration?.active;
    const changed = () => {
      if (this.disposed || this.worker !== worker || this.phase === "applying") return;
      if (worker.state === "redundant") {
        this.endCheck();
        this.stopWorker?.(); this.worker = undefined;
        clearTimeout(this.installTimer);
        this.failedCheck("updateController.preparationFailed");
      } else if (worker.state === "installed" || worker.state === "activated") {
        this.endCheck();
        clearTimeout(this.installTimer);
        this.schedule.succeeded();
        if (this.registration?.waiting) this.show("ready", prepared);
        else this.show("current", "updateController.current");
      } else {
        this.show("preparing", "updateController.preparing");
      }
    };
    worker.addEventListener("statechange", changed);
    this.stopWorker = () => worker.removeEventListener("statechange", changed);
    this.installTimer = setTimeout(() => {
      if (this.disposed || this.worker !== worker || this.phase !== "preparing") return;
      // This is feedback, not a worker deadline: final verification, storage
      // and a quota-recovery attempt may still be running. Keep observing it.
      this.slowPreparation = true;
      this.show("preparing", "updateController.slow");
    }, shellDownloadTimeoutMs);
    changed();
    void requestWorker(worker, {type:'SAME_PAGE_INSTALL_PROGRESS'}).then(value => this.acceptProgress(worker, value));
  }

  private progressMessage = (event: MessageEvent) => {
    if (event.data?.type === 'SAME_PAGE_INSTALL_PROGRESS' && event.source === this.worker) this.acceptProgress(this.worker, event.data.progress);
  };
  private acceptProgress(worker: ServiceWorker | undefined, value: unknown) {
    const initialCompleted = this.initialInstall && this.phase === 'current';
    if (this.disposed || this.phase !== 'preparing' && !initialCompleted || !worker || this.worker !== worker) return;
    const progress = parseInstallProgress(value);
    if (initialCompleted && progress?.stage !== 'ready') return;
    if (!progress || this.progress && (progress.buildId !== this.progress.buildId || progress.sequence <= this.progress.sequence)) return;
    this.progress = progress;
    if (initialCompleted) this.show('current', "updateController.offlineReady");
    else this.show('preparing', this.slowPreparation ? "updateController.slow" : this.initialInstall ? "updateController.preparingOffline" : "updateController.preparing");
  }

  check = async () => {
    if (this.disposed || this.checking || this.phase === "applying" || this.phase === "preparing" || this.phase === "unsupported") return;
    if (!navigator.onLine) { this.schedule.failed(); this.show("offline", "updateController.offline"); return; }
    if (!this.registration) {
      if (this.registrationError) {
        this.schedule.started();
        this.show("registering", "updateController.registering");
        this.retryRegistration();
      }
      return;
    }
    this.schedule.started();
    this.initialInstall = false; this.progress = undefined;
    this.checking = true;
    const id = ++this.checkId;
    this.show("checking", "updateController.checking");
    this.checkTimer = setTimeout(() => {
      if (this.disposed || this.checkId !== id) return;
      ++this.checkId; this.checking = false;
      if (this.phase === "checking") this.failedCheck("updateController.checkTimeout");
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
        else if (this.phase === "checking") this.show("current", "updateController.current");
      }
    } catch {
      if (!this.disposed && id === this.checkId && this.phase === "checking") this.failedCheck("updateController.checkFailed");
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
      this.show(this.registration?.waiting ? "ready" : "error", this.registration?.waiting ? prepared : "updateController.unavailable");
    }
    if (this.phase === "ready" && Date.now() >= this.autoRetryAt && canApplyUpdate()) this.beginApply(false);
  };

  apply = () => this.beginApply(true);

  private beginApply(manual: boolean) {
    if (this.disposed || this.phase === "applying") return;
    const waiting = this.registration?.waiting;
    if (!waiting) {
      this.show("error", "updateController.unavailable");
      return;
    }
    if (!navigator.onLine) { this.show("ready", "updateController.applyOffline"); return; }
    if (!canApplyUpdate(manual)) {
      if (!manual) return;
      this.deferred = undefined;
      this.show("ready", "updateController.returnToLibrary");
      return;
    }
    this.stopApply?.(); this.stopApply = undefined;
    this.endCheck();
    this.setRequested(manual);
    this.show("applying", "updateController.confirming");
    let channel: MessageChannel;
    try { channel = new MessageChannel(); } catch {
      this.deferred = undefined;
      this.setRequested(false); this.show("ready", "updateController.startFailed"); return;
    }
    let active = true;
    const finish = (messageKey: string, windowDeferred = false) => {
      if (!active || this.disposed) return;
      this.deferred = windowDeferred && this.registration?.waiting === waiting
        ? this.deferred?.worker === waiting ? this.deferred : { worker: waiting, since: Date.now() }
        : undefined;
      this.stopApply?.(); this.stopApply = undefined;
      this.setRequested(false);
      this.autoRetryAt = Date.now() + 10000;
      this.show(this.registration?.waiting ? "ready" : "error", !manual && this.registration?.waiting ? prepared : messageKey);
    };
    let accepted = false;
    const changed = () => {
      if (!active || this.disposed) return;
      if (waiting.state === "redundant") finish("updateController.unavailable");
      else if (waiting.state === "activating" || waiting.state === "activated") {
        accepted = true;
        this.deferred = undefined;
        this.show("applying", "updateController.applying");
      }
    };
    // A page deadline cannot cancel skipWaiting or the browser's activation.
    // Keep observing the same attempt so a late approval is not discarded.
    const timeout = setTimeout(() => {
      if (!active || this.disposed) return;
      if (accepted) this.show("applying", "updateController.switchSlow");
      else {
        this.autoRetryAt = Date.now() + 10000;
        this.show("ready", "updateController.approvalPending");
      }
    }, 10000);
    waiting.addEventListener("statechange", changed);
    this.stopApply = () => { active = false; clearTimeout(timeout); waiting.removeEventListener("statechange", changed); channel.port1.close(); };
    channel.port1.onmessage = event => {
      if (!active || this.disposed) return;
      if (event.data?.safe === true) { accepted = true; this.deferred = undefined; this.show("applying", "updateController.applying"); }
      else finish(event.data?.reason === "incomplete" ? "updateController.missingResources" : blocked, event.data?.safe === false && event.data?.reason !== "incomplete");
    };
    try { waiting.postMessage({ type: "SAME_PAGE_SAFE_UPDATE", requested: true, ...(!manual ? { automatic: true } : {}) }, [channel.port2]); }
    catch { finish("updateController.startRetry"); }
  }

  dispose() {
    this.disposed = true;
    ++this.checkId;
    this.registration?.removeEventListener("updatefound", this.updateFound);
    navigator.serviceWorker?.removeEventListener?.("message", this.progressMessage);
    this.stopWorker?.(); this.stopApply?.();
    clearTimeout(this.checkTimer); clearTimeout(this.installTimer);
    this.setRequested(false);
  }
}
