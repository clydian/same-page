import { useAppLocale, useMessages } from "../../i18n";
import { ReleaseChannelMonitor, ReleaseChannelPicker } from "../updates/release-channel-picker";
import { useReleaseChannel } from "../updates/release-channel";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";

import { canAcceptUpdate, canApplyUpdate, noteUpdateInteraction, setUpdateRoute } from "../updates/update-safety";
import { useUpdateStatus } from "../updates/update-status";
import { buildId, buildVersion } from "../../shared/build";
import { UpdateCheckSchedule } from "../updates/update-check-schedule";
import { UpdateController } from "../updates/update-controller";
import { ShellRecovery } from "../updates/shell-recovery";
import { requestWorker, watchControllerChanges } from "../updates/worker-request";
import { rememberUpdateFailure } from "../updates/update-diagnostics";
import { ResourcePreparation } from "../updates/resource-preparation";
import { UpdateNotice } from "../updates/update-notice";
declare const __SAME_PAGE_RELEASE_CHANNELS__: boolean;
// Evaluate promptly after the one-second idle threshold.
const updateTickMs = 250;

export function ReloadPrompt() {
  const [attempt, setAttempt] = useState(0);
  const [schedule] = useState(() => new UpdateCheckSchedule());
  const retryRegistration = useCallback(() => setAttempt(value => value + 1), []);
  return <><PageRecovery /><RegisteredReloadPrompt key={attempt} retryRegistration={retryRegistration} schedule={schedule} /><UpdateNotice /></>;
}

function RegisteredReloadPrompt({ retryRegistration, schedule }: { retryRegistration(): void; schedule: UpdateCheckSchedule }) {
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
    const controller = new UpdateController(registration, registrationError, retryRegistration, value => { requested.current = value; }, schedule);
    controller.start();
    const visible = () => { if (document.visibilityState === "visible") { noteUpdateInteraction(); controller.foregroundCheck(); } };
    const idle = setInterval(controller.tick, updateTickMs);
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("online", controller.foregroundCheck);
    window.addEventListener("same-page-check-update", controller.check);
    window.addEventListener("same-page-apply-update", controller.apply);
    return () => {
      controller.dispose(); clearInterval(idle);
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("online", controller.foregroundCheck);
      window.removeEventListener("same-page-check-update", controller.check);
      window.removeEventListener("same-page-apply-update", controller.apply);
    };
  }, [registration, registrationError, retryRegistration, schedule]);
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
    }, updateTickMs);
    return () => { clearInterval(timer); events.forEach(event => document.removeEventListener(event, noteUpdateInteraction, true)); navigator.serviceWorker?.removeEventListener("message", probe); };
  }, []);
  return <ReleaseChannelMonitor />;
}

function PageRecovery() {
  // Page recovery belongs to this document, not to an SW registration attempt.
  // A late registration must not lose an explicitly requested, deferred reload.
  useEffect(() => {
    const recovery = new ShellRecovery(() => window.location.reload());
    const visible = () => { if (document.visibilityState === "visible") void recovery.check(); };
    const restored = (event: PageTransitionEvent) => { if (event.persisted) void recovery.check(); };
    const preloadFailed = () => { void recovery.check(); };
    const timer = setInterval(recovery.tick, updateTickMs);
    window.addEventListener("pageshow", restored);
    window.addEventListener("vite:preloadError", preloadFailed);
    window.addEventListener("same-page-recover-page", recovery.requestReload);
    document.addEventListener("visibilitychange", visible);
    return () => {
      recovery.dispose(); clearInterval(timer);
      window.removeEventListener("pageshow", restored);
      window.removeEventListener("vite:preloadError", preloadFailed);
      window.removeEventListener("same-page-recover-page", recovery.requestReload);
      document.removeEventListener("visibilitychange", visible);
    };
  }, []);
  return null;
}

export function UpdateDetails() {
  const t = useMessages("system");
  const { locale } = useAppLocale();
  const supportUrl = `/api/support/update?lang=${locale}`;
  const status = useUpdateStatus();
  const channel = useReleaseChannel();
  const channelsEnabled = typeof __SAME_PAGE_RELEASE_CHANNELS__ === "boolean" && __SAME_PAGE_RELEASE_CHANNELS__;
  const switching = channelsEnabled && channel.target !== null && channel.target.target !== buildId
    && channel.runningChannel !== null && channel.target.channel !== channel.runningChannel;
  const targetName = channel.target?.channel === "beta" ? t("reloadPrompt.beta") : t("reloadPrompt.stable");
  const runningName = channel.runningChannel === "beta" ? t("reloadPrompt.beta") : channel.runningChannel === "stable" ? t("reloadPrompt.stable") : t("reloadPrompt.previousVersion");
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
  const labels: Partial<Record<typeof status.phase, string>> = { registering: t("reloadPrompt.preparing"), checking: t("reloadPrompt.checking"), preparing: t("reloadPrompt.preparing"), applying: t("reloadPrompt.updating") };
  const label = channelsEnabled && channel.busy ? t("reloadPrompt.saving") : labels[status.phase];
  const titles: Record<typeof status.phase, string> = {
    registering: t("reloadPrompt.connecting"), checking: t("reloadPrompt.checkingForUpdates"), preparing: t("reloadPrompt.preparingNewVersion"),
    current: t("reloadPrompt.checked"), ready: t("reloadPrompt.newVersionReady"), applying: t("reloadPrompt.applying"),
    error: t("reloadPrompt.unavailable"), offline: t("reloadPrompt.goOnlineToCheck"), unsupported: t("reloadPrompt.reopenToUpdate"),
  };
  let title = status.initialInstall && status.phase === "preparing" ? t("reloadPrompt.preparingOffline") : titles[status.phase], message = status.message;
  if (channelsEnabled && channel.busy) {
    title = t("reloadPrompt.savingSelection");
    message = t("reloadPrompt.savingCurrentVersion", { current: runningName });
  } else if (switching) {
    title = status.phase === "ready" ? t("reloadPrompt.waitingToSwitch", { target: targetName })
      : status.phase === "applying" ? t("reloadPrompt.switching", { target: targetName })
      : status.phase === "error" ? t("reloadPrompt.switchFailed")
      : status.phase === "offline" ? t("reloadPrompt.goOnlineToSwitch")
      : status.phase === "current" ? t("reloadPrompt.selected", { target: targetName }) : t("reloadPrompt.preparingVersion", { target: targetName });
    const progress = status.phase === "ready" && (!status.messageKey || status.messageKey === "updateController.prepared") ? t("reloadPrompt.preparedVersion")
      : status.phase === "current" ? t("reloadPrompt.selectionPending") : status.message;
    message = t("reloadPrompt.runningVersion", { current: runningName, progress });
  } else if (channelsEnabled && channel.target && status.phase === "current") {
    title = t("reloadPrompt.currentVersion", { target: targetName });
  }
  return <section className="support-update app-version-panel" aria-labelledby="update-heading">
    <div className="app-version-heading"><h2 id="update-heading">{t("reloadPrompt.appVersion")}</h2><span translate="no">{buildVersion}</span></div>
    <ReleaseChannelPicker />
    <div className="app-version-status">
      <h3>{title}</h3>
      <p className="support-update-message" role="status" aria-live="polite" aria-atomic="true">{message}</p>
      <ResourcePreparation />
      <button type="button" className={ready ? "primary-button" : "secondary-button"} disabled={busy || status.phase === "unsupported"}
        onClick={() => window.dispatchEvent(new Event(ready ? "same-page-apply-update" : "same-page-check-update"))}>
        {label ?? (ready ? switching ? t("reloadPrompt.switchTo", { target: targetName }) : t("reloadPrompt.reloadAndUpdate") : status.phase === "error" || status.phase === "offline" ? t("reloadPrompt.retryCheck") : t("reloadPrompt.check"))}
      </button>
      <p className="support-update-hint">{switching ? t("reloadPrompt.switchAdvice") : ready ? t("reloadPrompt.readyAdvice") : t("reloadPrompt.checkAdvice")}</p>
      {status.deferred && <p className="support-update-hint">{t("reloadPrompt.otherWindowsAdvice")}</p>}
    </div>
    {status.phase === "error" && <a className="support-recovery-link" href={supportUrl}>{t("reloadPrompt.resolveUpdateProblem")}</a>}
    <details className="support-details update-technical"><summary>{t("reloadPrompt.details")}</summary>
      <p>{t.rich("update.currentBuild", { build: buildId, value: chunks => <code translate="no">{chunks}</code> })}</p>
      {channelsEnabled && channel.target && <><p>{t("update.selectedChannel", { target: targetName, running: runningName })}</p>
        <p>{t.rich("update.channelTarget", { build: channel.target.target, value: chunks => <code translate="no">{chunks}</code> })}</p>
        <p>{t.rich("update.backendBuild", { build: channel.target.backend, value: chunks => <code translate="no">{chunks}</code> })}</p></>}
      {ready && preparedBuild?.status === status && <p>{t.rich("update.preparedBuild", { build: preparedBuild.buildId.slice(0, 7), value: chunks => <code translate="no">{chunks}</code> })}</p>}
      <p>{t("reloadPrompt.safeRecoveryAdvice")}</p>
      <a href={supportUrl}>{t("reloadPrompt.resolveProblem")}</a>
    </details>
  </section>;
}
