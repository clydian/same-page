import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useRegisterSW } from "virtual:pwa-register/react";
import { canApplyUpdate, noteUpdateInteraction, setUpdateRoute } from "../updates/update-safety";
import { useUpdateStatus } from "../updates/update-status";
import { buildId } from "../../shared/build";
import { UpdateController } from "../updates/update-controller";
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
    reloadPending.current = true;
    // Activation may come from another window. Recheck after the worker's probe.
    if (canApplyUpdate(requested.current)) window.location.reload();
  }, []);
  const onRegisteredSW = useCallback((_url: string, value?: ServiceWorkerRegistration) => setRegistration(value), []);
  useRegisterSW({ onNeedReload, onRegisteredSW,
    onRegisterError: () => setRegistrationError(true),
  });
  useLayoutEffect(() => setUpdateRoute(pathname), [pathname]);
  useEffect(() => {
    const controller = new UpdateController(registration, registrationError, retryRegistration, value => { requested.current = value; });
    controller.start();
    const visible = () => { if (document.visibilityState === "visible") controller.foregroundCheck(); };
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("same-page-check-update", controller.check);
    window.addEventListener("same-page-apply-update", controller.apply);
    return () => {
      controller.dispose();
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
      if (event.data?.type === "SAME_PAGE_UPDATE_PROBE") event.ports[0]?.postMessage(event.data.requested === true && canApplyUpdate(requested.current));
    };
    navigator.serviceWorker?.addEventListener("message", probe);
    // Only complete an already-authorized handover; idle time never starts one.
    const timer = window.setInterval(() => {
      if (reloadPending.current && canApplyUpdate()) window.location.reload();
    }, 1000);
    return () => { clearInterval(timer); events.forEach(event => document.removeEventListener(event, noteUpdateInteraction, true)); navigator.serviceWorker?.removeEventListener("message", probe); };
  }, []);
  return null;
}

export function UpdateDetails() {
  const status = useUpdateStatus();
  const busy = ["registering", "checking", "preparing", "applying"].includes(status.phase);
  const ready = status.phase === "ready";
  const labels: Partial<Record<typeof status.phase, string>> = { registering: "准备中…", checking: "检查中…", preparing: "准备中…", applying: "更新中…" };
  const label = labels[status.phase];
  return <section><h2>版本更新</h2><p role="status" aria-live="polite" aria-atomic="true">{status.message}</p>
    <button className={ready ? "primary-button" : "secondary-button"} disabled={busy || status.phase === "unsupported"}
      onClick={() => window.dispatchEvent(new Event(ready ? "same-page-apply-update" : "same-page-check-update"))}>
      {label ?? (ready ? "重新加载并更新" : status.phase === "error" || status.phase === "offline" ? "重试检查更新" : "检查更新")}
    </button>
    <p><a href="/api/support/update">更新失败？打开独立更新诊断</a></p>
  </section>;
}
