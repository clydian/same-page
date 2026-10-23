import { ReleaseChannelMonitor, ReleaseChannelPicker } from "../updates/release-channel-picker";
import { useReleaseChannel } from "../updates/release-channel";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";

import { canAcceptUpdate, canApplyUpdate, noteUpdateInteraction, setUpdateRoute } from "../updates/update-safety";
import { useUpdateStatus } from "../updates/update-status";
import { buildId, buildVersion } from "../../shared/build";
import { UpdateController } from "../updates/update-controller";
import { ShellRecovery } from "../updates/shell-recovery";
import { requestWorker, watchControllerChanges } from "../updates/worker-request";
import { rememberUpdateFailure } from "../updates/update-diagnostics";
import { UpdateNotice } from "../updates/update-notice";
declare const __SAME_PAGE_RELEASE_CHANNELS__: boolean;

export function ReloadPrompt() {
  const [attempt, setAttempt] = useState(0);
  const retryRegistration = useCallback(() => setAttempt(value => value + 1), []);
  return <><RegisteredReloadPrompt key={attempt} retryRegistration={retryRegistration} /><UpdateNotice /></>;
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
  return <ReleaseChannelMonitor />;
}

export function UpdateDetails() {
  const status = useUpdateStatus();
  const channel = useReleaseChannel();
  const channelsEnabled = typeof __SAME_PAGE_RELEASE_CHANNELS__ === "boolean" && __SAME_PAGE_RELEASE_CHANNELS__;
  const switching = channelsEnabled && channel.target !== null && channel.target.target !== buildId
    && channel.runningChannel !== null && channel.target.channel !== channel.runningChannel;
  const targetName = channel.target?.channel === "beta" ? "测试版" : "稳定版";
  const runningName = channel.runningChannel === "beta" ? "测试版" : channel.runningChannel === "stable" ? "稳定版" : "原版本";
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
  const busy = (channelsEnabled && channel.busy) || ["registering", "checking", "preparing", "applying"].includes(status.phase);
  const ready = status.phase === "ready";
  const labels: Partial<Record<typeof status.phase, string>> = { registering: "准备中…", checking: "检查中…", preparing: "准备中…", applying: "更新中…" };
  const label = channelsEnabled && channel.busy ? "保存中…" : labels[status.phase];
  const titles: Record<typeof status.phase, string> = {
    registering: "正在连接更新服务", checking: "正在检查更新", preparing: "正在准备新版本",
    current: "更新检查已完成", ready: "新版本已准备好", applying: "正在应用更新",
    error: "暂时无法完成更新", offline: "联网后可检查更新", unsupported: "请重新打开合谱以更新",
  };
  let title = titles[status.phase], message = status.message;
  if (channelsEnabled && channel.busy) {
    title = "正在保存通道选择…";
    message = `当前仍运行${runningName}，确认选择后会准备对应版本。`;
  } else if (switching) {
    title = status.phase === "ready" ? `等待切换到${targetName}`
      : status.phase === "applying" ? `正在切换到${targetName}…`
      : status.phase === "error" ? "暂时无法完成切换"
      : status.phase === "offline" ? "联网后继续切换"
      : status.phase === "current" ? `已选择${targetName}` : `正在准备${targetName}…`;
    const progress = status.phase === "ready" && status.message === "更新已准备好" ? "版本已准备好，等待所有窗口安全后切换。"
      : status.phase === "current" ? "选择已保存，版本切换尚未完成。可重新检查更新。" : status.message;
    message = `当前仍运行${runningName}。${progress}`;
  } else if (channelsEnabled && channel.target && status.phase === "current") {
    title = `当前使用${targetName}`;
  }
  return <section className="support-update app-version-panel" aria-labelledby="update-heading">
    <div className="app-version-heading"><h2 id="update-heading">应用版本</h2><span translate="no">{buildVersion}</span></div>
    <ReleaseChannelPicker />
    <div className="app-version-status">
      <h3>{title}</h3>
      <p className="support-update-message" role="status" aria-live="polite" aria-atomic="true">{message}</p>
      <button type="button" className={ready ? "primary-button" : "secondary-button"} disabled={busy || status.phase === "unsupported"}
        onClick={() => window.dispatchEvent(new Event(ready ? "same-page-apply-update" : "same-page-check-update"))}>
        {label ?? (ready ? switching ? `切换到${targetName}` : "重新加载并更新" : status.phase === "error" || status.phase === "offline" ? "重试检查更新" : "检查更新")}
      </button>
      <p className="support-update-hint">{switching ? "切换会重新加载页面。请先保存其他窗口的操作；笔记和离线内容会保留。" : ready ? "将在安全时机重新加载，也可关闭所有合谱窗口后重新打开。" : "联网后会准备更新，并在所有窗口都安全时生效。"}</p>
      {status.deferred && <p className="support-update-hint">如果浏览器里也开着合谱，请让那些页面返回文件库，或将它们关闭。</p>}
    </div>
    {status.phase === "error" && <a className="support-recovery-link" href="/api/support/update">更新遇到困难？检查更新问题 →</a>}
    <details className="support-details update-technical"><summary>更新帮助与详情</summary>
      <p>当前构建：<code translate="no">{buildId}</code></p>
      {channelsEnabled && channel.target && <><p>所选通道：{targetName} · 当前运行：{runningName}</p>
        <p>通道目标：<code translate="no">{channel.target.target}</code></p><p>后端构建：<code translate="no">{channel.target.backend}</code></p></>}
      {ready && preparedBuild?.status === status && <p>已准备版本：<code>{preparedBuild.buildId.slice(0, 7)}</code></p>}
      <p>更新不会要求你清除本机数据。如果无法完成更新，可使用独立检查页面排查。</p>
      <a href="/api/support/update">检查更新问题</a>
    </details>
  </section>;
}
