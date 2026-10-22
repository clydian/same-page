import { ReleaseChannelBadge } from "../updates/release-channel-picker";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";

import { canAcceptUpdate, canApplyUpdate, noteUpdateInteraction, setUpdateRoute } from "../updates/update-safety";
import { useUpdateStatus } from "../updates/update-status";
import { buildId, buildVersion } from "../../shared/build";
import { UpdateController } from "../updates/update-controller";
import { ShellRecovery } from "../updates/shell-recovery";
import { requestWorker, watchControllerChanges } from "../updates/worker-request";
import { rememberUpdateFailure } from "../updates/update-diagnostics";

export function ReloadPrompt() {
  const [attempt, setAttempt] = useState(0);
  const retryRegistration = useCallback(() => setAttempt(value => value + 1), []);
  return <RegisteredReloadPrompt key={attempt} retryRegistration={retryRegistration} />;
}

function RegisteredReloadPrompt({ retryRegistration }: { retryRegistration(): void }) {
  const { pathname } = useLocation();
  const [registration, setRegistration] = useState<ServiceWorkerRegistration>();
  const reloadPending = useRef(false);
  const requested = useRef(false);
  const [registrationError, setRegistrationError] = useState(false);
  const onNeedReload = useCallback(() => {
    if (reloadPending.current) return;
    reloadPending.current = true;
    // Activation may come from another window. Recheck after the worker's probe.
    if (canApplyUpdate(requested.current)) window.location.reload();
  }, []);
  const onRegisteredSW = useCallback((_url: string, value?: ServiceWorkerRegistration) => setRegistration(value), []);
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    let disposed = false;
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then(value => { if (!disposed) onRegisteredSW("/sw.js", value); })
      .catch(() => { if (!disposed) setRegistrationError(true); });
    return () => { disposed = true; };
  }, [onRegisteredSW]);
  useLayoutEffect(() => setUpdateRoute(pathname), [pathname]);
  useEffect(() => watchControllerChanges(onNeedReload), [onNeedReload]);
  useEffect(() => {
    const controller = new UpdateController(registration, registrationError, retryRegistration, value => { requested.current = value; });
    controller.start();
    const recovery = new ShellRecovery(() => window.location.reload());
    const visible = () => { if (document.visibilityState === "visible") { noteUpdateInteraction(); controller.foregroundCheck(); void recovery.check(); } };
    const restored = (event: PageTransitionEvent) => { if (event.persisted) void recovery.check(); };
    const preloadFailed = () => { void recovery.check(); };
    const idle = setInterval(() => { recovery.tick(); controller.autoApply(); }, 1000);
    window.addEventListener("pageshow", restored);
    window.addEventListener("vite:preloadError", preloadFailed);
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("same-page-check-update", controller.check);
    window.addEventListener("same-page-apply-update", controller.apply);
    return () => {
      controller.dispose(); recovery.dispose(); clearInterval(idle);
      window.removeEventListener("pageshow", restored);
      window.removeEventListener("vite:preloadError", preloadFailed);
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("same-page-check-update", controller.check);
      window.removeEventListener("same-page-apply-update", controller.apply);
    };
  }, [registration, registrationError, retryRegistration]);
  useEffect(() => {
    const events = ["pointerdown", "pointerup", "keydown", "input", "focusin", "wheel", "scroll"] as const;
    events.forEach(event => document.addEventListener(event, noteUpdateInteraction, true));
    const probe = (event: MessageEvent) => {
      if (event.data?.type === "SAME_PAGE_UPDATE_FAILURE") rememberUpdateFailure(event.data);
      if (event.data?.type === "SAME_PAGE_SHELL_PROBE") event.ports[0]?.postMessage({ buildId, cacheName: "" });
      if (event.data?.type === "SAME_PAGE_UPDATE_PROBE") event.ports[0]?.postMessage(event.data.requested === true && canAcceptUpdate(event.data.automatic !== true && requested.current));
    };
    navigator.serviceWorker?.addEventListener("message", probe);
    // Only complete an already-authorized handover; idle time never starts one.
    const timer = window.setInterval(() => {
      if (reloadPending.current && canApplyUpdate()) window.location.reload();
    }, 1000);
    return () => { clearInterval(timer); events.forEach(event => document.removeEventListener(event, noteUpdateInteraction, true)); navigator.serviceWorker?.removeEventListener("message", probe); };
  }, []);
  return <ReleaseChannelBadge />;
}

export function UpdateDetails() {
  const status = useUpdateStatus();
  const [preparedBuild, setPreparedBuild] = useState<{ status: typeof status; buildId: string } | null>(null);
  useEffect(() => {
    let stopped = false;
    if (status.phase === "ready" && navigator.serviceWorker?.getRegistration) {
      void navigator.serviceWorker.getRegistration().then(async registration => {
        if (!registration?.waiting) return;
        const reply = await requestWorker(registration.waiting, { type: "SAME_PAGE_SHELL_IDENTITY" });
        if (!stopped && reply && typeof reply === "object" && "buildId" in reply && typeof reply.buildId === "string" && /^(?:[a-f0-9]{7,40}|development)$/.test(reply.buildId)) setPreparedBuild({ status, buildId: reply.buildId });
      }).catch(() => undefined);
    }
    return () => { stopped = true; };
  }, [status]);
  const busy = ["registering", "checking", "preparing", "applying"].includes(status.phase);
  const ready = status.phase === "ready";
  const labels: Partial<Record<typeof status.phase, string>> = { registering: "准备中…", checking: "检查中…", preparing: "准备中…", applying: "更新中…" };
  const label = labels[status.phase];
  const titles: Record<typeof status.phase, string> = {
    registering: "正在连接更新服务", checking: "正在检查更新", preparing: "正在准备新版本",
    current: "更新检查已完成", ready: "新版本已准备好", applying: "正在应用更新",
    error: "暂时无法完成更新", offline: "联网后可检查更新", unsupported: "请重新打开合谱以更新",
  };
  return <section className="support-update" aria-labelledby="update-heading">
    <div className="support-update-meta"><span>应用更新</span><span>当前版本 <span translate="no">{buildVersion}</span></span></div>
    <h2 id="update-heading">{titles[status.phase]}</h2>
    <p className="support-update-message" role="status" aria-live="polite" aria-atomic="true">{status.message}</p>
    <button className={ready ? "primary-button" : "secondary-button"} disabled={busy || status.phase === "unsupported"}
      onClick={() => window.dispatchEvent(new Event(ready ? "same-page-apply-update" : "same-page-check-update"))}>
      {label ?? (ready ? "重新加载并更新" : status.phase === "error" || status.phase === "offline" ? "重试检查更新" : "检查更新")}
    </button>
    <p className="support-update-hint">{ready ? "更新将重新加载页面。也可以稍后关闭所有合谱窗口，下次打开时使用新版本。" : "合谱会在后台准备更新。关闭所有合谱窗口后，下次打开时使用已准备的新版本。"}</p>
    {status.phase === "error" && <a className="support-recovery-link" href="/api/support/update">更新遇到困难？检查更新问题 →</a>}
    <details className="support-details update-technical"><summary>更新帮助与详情</summary>
      {ready && preparedBuild?.status === status && <p>已准备版本：<code>{preparedBuild.buildId.slice(0, 7)}</code></p>}
      <p>更新不会要求你清除本机数据。如果无法完成更新，可使用独立检查页面排查。</p>
      <a href="/api/support/update">检查更新问题</a>
    </details>
  </section>;
}
