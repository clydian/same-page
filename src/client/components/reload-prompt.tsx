import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useRegisterSW } from "virtual:pwa-register/react";
import { canApplyUpdate, noteUpdateInteraction, setUpdateRoute } from "../updates/update-safety";
import { setUpdateStatus, useUpdateStatus } from "../updates/update-status";

const prepared = "新版本已准备，可在此更新并重新加载";
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
  const applying = useRef(false);
  const onNeedReload = useCallback(() => {
    reloadPending.current = true;
    // Activation may come from another window. Recheck after the worker's probe.
    if (canApplyUpdate(requested.current)) window.location.reload();
  }, []);
  const onRegisteredSW = useCallback((_url: string, value?: ServiceWorkerRegistration) => setRegistration(value), []);
  const { needRefresh: [ready] } = useRegisterSW({ onNeedReload, onRegisteredSW,
    onRegisterError: () => setUpdateStatus("应用离线资源准备失败，请稍后重试", { applying: false }),
  });
  useLayoutEffect(() => setUpdateRoute(pathname), [pathname]);
  const check = useCallback(async () => {
    if (applying.current) return;
    if (!navigator.onLine) { setUpdateStatus("当前离线，继续使用当前版本"); return; }
    if (!registration) { setUpdateStatus("正在重新准备离线资源…"); retryRegistration(); return; }
    setUpdateStatus("正在检查更新…");
    try {
      await registration.update();
      setUpdateStatus(registration.waiting ? prepared : "检查完成，当前版本继续运行", { ready: Boolean(registration.waiting) });
    } catch { setUpdateStatus("更新检查失败，请稍后重试"); }
  }, [registration, retryRegistration]);
  useEffect(() => { if (ready && !applying.current) setUpdateStatus(prepared, { ready: true }); }, [ready]);
  useEffect(() => {
    if (registration) void check();
    const visible = () => { if (document.visibilityState === "visible") void check(); };
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("same-page-check-update", check);
    return () => { document.removeEventListener("visibilitychange", visible); window.removeEventListener("same-page-check-update", check); };
  }, [registration, check]);
  useEffect(() => {
    let cancel: (() => void) | undefined;
    const apply = () => {
      if (!registration?.waiting || applying.current) return;
      if (!canApplyUpdate(true)) { setUpdateStatus("请先完成当前操作，再应用更新"); return; }
      requested.current = true; applying.current = true;
      setUpdateStatus("正在确认其他窗口是否可以更新…", { applying: true });
      const channel = new MessageChannel();
      const finish = (message: string) => {
        cancel?.(); cancel = undefined; requested.current = false; applying.current = false;
        setUpdateStatus(message, { applying: false });
      };
      const timeout = window.setTimeout(() => finish("更新未完成，当前版本继续运行；可重新尝试"), 10000);
      cancel = () => { clearTimeout(timeout); channel.port1.close(); };
      channel.port1.onmessage = event => {
        if (event.data?.safe === true) { setUpdateStatus("正在应用更新…"); return; }
        finish("新版本待应用，请先完成其他窗口中的操作，再尝试更新");
      };
      registration.waiting.postMessage({ type: "SAME_PAGE_SAFE_UPDATE", requested: true }, [channel.port2]);
    };
    window.addEventListener("same-page-apply-update", apply);
    return () => { window.removeEventListener("same-page-apply-update", apply); cancel?.(); };
  }, [registration]);
  useEffect(() => {
    const events = ["pointerdown", "pointerup", "keydown", "input", "focusin", "wheel", "scroll"] as const;
    events.forEach(event => document.addEventListener(event, noteUpdateInteraction, true));
    const probe = (event: MessageEvent) => {
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
  return <section><h2>版本更新</h2><p role="status">{status.message}</p>
    <button className="secondary-button" disabled={status.applying} onClick={() => window.dispatchEvent(new Event("same-page-check-update"))}>检查更新</button>
    {status.ready && <button className="primary-button" disabled={status.applying} onClick={() => window.dispatchEvent(new Event("same-page-apply-update"))}>更新并重新加载</button>}
  </section>;
}
