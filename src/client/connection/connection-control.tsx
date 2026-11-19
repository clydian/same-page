import { useAppLocale, useMessages } from "../../i18n";
import { LoaderCircle, Wifi, WifiOff, X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { Button, Heading, Modal, ModalOverlay } from "react-aria-components";
import { Link, useLocation } from "react-router-dom";
import { connectionRoutes, type ConnectionMode } from "../../shared/connection";
import { authClient } from "../auth/auth-client";
import { useNetworkStatus } from "../platform/use-network-status";
import { Dialog } from "../navigation/overlays";
import { connections, connectionsEnabled, connectionWebsites, setConnectionMode } from "./connection";
import { observeHealth } from "./sampling";
import { routeAvailability } from "./presentation";
import { useFloatingVisibility } from "./use-floating-visibility";
import "./connection.css";

type HelpContext = { help: ReactNode; setHelp: React.Dispatch<React.SetStateAction<ReactNode>> };
const ConnectionHelpContext = createContext<HelpContext | null>(null);

export function ConnectionHelpProvider({ children }: { children: ReactNode }) {
  const [help, setHelp] = useState<ReactNode>(null);
  return <ConnectionHelpContext value={{ help, setHelp }}>{children}</ConnectionHelpContext>;
}

export function ConnectionHelp({ children }: { children?: ReactNode }) {
  const setHelp = useContext(ConnectionHelpContext)?.setHelp;
  useEffect(() => {
    if (!setHelp) return;
    setHelp(children);
    return () => setHelp(current => current === children ? null : current);
  }, [children, setHelp]);
  return null;
}

export function ConnectionControl({ children }: { children?: ReactNode } = {}) {
  const help = useContext(ConnectionHelpContext)?.help;
  const location = useLocation();
  // Available before login too; first-page loading failure still needs the
  // independently discoverable emergency website.
  return connectionsEnabled && (/^\/(?:drives|login)?$/.test(location.pathname) || /^\/choirs\/[^/]+$/.test(location.pathname)) ? <ConnectionButton>{children ?? help}</ConnectionButton> : null;
}

function ConnectionButton({ children }: { children?: ReactNode }) {
  const t = useMessages("system");
  const { locale } = useAppLocale();
  const names = { direct: t("connectionControl.direct"), backup: t("connectionControl.backup") };
  const state = useSyncExternalStore(connections.subscribe, connections.getSnapshot);
  const session = authClient.useSession();
  const browserOnline = useNetworkStatus();
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!open) return;
    const stop = observeHealth(connections, document, () => setNow(Date.now()));
    const clock = setInterval(() => { if (!document.hidden) setNow(Date.now()); }, 1000);
    return () => { stop(); clearInterval(clock); };
  }, [open, state.mode]);
  const { button, visible: scrollingVisible } = useFloatingVisibility();
  const availability = routeAvailability(state.health[state.active], state.samples[state.active].at(-1), now);
  const disconnected = availability === "unavailable";
  const attention = !browserOnline || disconnected || state.identity[state.active] === "conflict" || state.identity[state.active] === "unprepared";
  const working = state.checking || state.preparing;
  const visible = scrollingVisible || attention || working || open;
  const accessibleStatus = !browserOnline ? t("connection.browserOffline") : disconnected ? t("connectionControl.connectionIssue") : state.identity[state.active] === "conflict" ? t("connectionControl.actionRequired") : null;
  const currentStatus = !browserOnline ? t("connection.browserOfflineDetail") : disconnected ? t("connection.offlineDetail")
    : availability === "stale" || availability === "unknown" ? t("connection.pendingCheck")
    : state.identity[state.active] !== "ready" ? t("connection.pendingConfirmation") : "";
  const refetch = session.refetch;
  const needsSessionRecovery = Boolean(session.error) || !session.data?.user;
  const check = useCallback(async () => {
    const previousRoute = connections.getSnapshot().active;
    await connections.check();
    // Health alone cannot establish identity, permissions or completed writes.
    if (needsSessionRecovery || previousRoute !== connections.getSnapshot().active) await refetch();
  }, [refetch, needsSessionRecovery]);
  useEffect(() => {
    let last = 0;
    const recover = () => {
      if (document.hidden || Date.now() - last < 30_000) return;
      last = Date.now();
      void check();
    };
    window.addEventListener("online", recover);
    document.addEventListener("visibilitychange", recover);
    return () => { window.removeEventListener("online", recover); document.removeEventListener("visibilitychange", recover); };
  }, [check]);
  return <>
    <Button ref={button} className="connection-fab" aria-label={[t("connectionControl.title"), accessibleStatus, working ? t("connectionControl.checking") : null].filter(Boolean).join(locale.startsWith("zh-") ? "，" : ", ")}
      aria-haspopup="dialog" aria-expanded={open} data-visible={visible} data-attention={attention || undefined} inert={!visible}
      onPress={() => { setNow(Date.now()); setOpen(true); void check(); }}>
      {working ? <LoaderCircle className="connection-spinner" size={19} aria-hidden="true" /> : !browserOnline || disconnected ? <WifiOff size={19} aria-hidden="true" /> : <Wifi size={19} aria-hidden="true" />}
    </Button>
    <ModalOverlay className="modal-overlay" isOpen={open} onOpenChange={setOpen} isDismissable>
      <Modal className="app-modal app-modal--compact"><Dialog className="app-dialog connection-dialog" aria-label={t("connectionControl.title")}>
        <div className="connection-heading"><Heading slot="title">{t("connectionControl.title")}</Heading><Button className="icon-button" onPress={() => setOpen(false)} aria-label={t("connectionControl.close")}><X size={20} aria-hidden="true" /></Button></div>

        <p className="connection-current" role="status">{state.attempting
          ? t("connectionControl.trying", { route: names[state.attempting] }) + (!browserOnline ? t("connection.browserOfflineDetail") : "")
          : t("connectionControl.current", { route: names[state.active], status: currentStatus })}</p>
        {window.location.origin === connectionWebsites.backup && <p className="connection-origin-note">{t("connectionControl.backupSiteNote")}</p>}
        {children}
        <fieldset className="connection-modes"><legend>{t("connectionControl.selection")}</legend>
          {(["auto", "direct", "backup"] as const).map(mode => <label key={mode} data-selected={state.mode === mode}>
            <input type="radio" name="connection-mode" value={mode} checked={state.mode === mode} onChange={() => { setConnectionMode(mode as ConnectionMode); void check(); }} />
            <span className="connection-mode-label">{mode === "auto" ? <>{t("connectionControl.automatic")}<span className="connection-recommended">{t("connectionControl.recommended")}</span></> : names[mode]}</span>
          </label>)}
        </fieldset>
        <ul className="connection-routes">{connectionRoutes.map(route => {
          const samples = state.samples[route];
          const latest = samples.at(-1);
          const stale = Boolean(latest && now - latest.at > 45_000);
          const health = latest ? { state: latest.state } : { state: "unknown" };
          const age = latest ? Math.max(0, Math.floor((now - latest.at) / 1000)) : null;
          const freshness = document.hidden ? t("connectionControl.paused") : stale ? t("connectionControl.stale") : age === null ? t("connectionControl.checking") : age < 1 ? t("connectionControl.checkedNow") : t("connectionControl.checkedSecondsAgo", { seconds: age });
          const result = state.identity[route] === "conflict" ? t("connectionControl.conflictingAccount") : health.state === "reachable" ? t("connectionControl.reachable") : health.state === "unreachable" ? t("connectionControl.unreachable") : t("connectionControl.unchecked");
          const conflict = state.identity[route] === "conflict";
          return <li key={route}><div><strong>{names[route]}</strong><span className={`connection-health connection-health--${conflict ? "conflict" : stale ? "unknown" : health.state}`}>
            {stale && !conflict ? t("connectionControl.expired") : result}</span></div>
            <details className="connection-samples"><summary className="connection-observation" aria-label={t("connectionControl.sampleDetails", { route: names[route], freshness, count: samples.length })}><span className="connection-trail" aria-hidden="true">{Array.from({ length: 20 }, (_, i) => {
              const sample = samples[i - (20 - samples.length)];
              return <i key={i} data-result={sample?.state ?? "unknown"} />;
            })}</span><small>{freshness}</small></summary>
              <p>{route === "direct" ? "Cloudflare" : t("connectionControl.backupProvider")} {t("connectionControl.sampleLimits")}</p>
              <p>{t("connectionControl.sampleLegend")}</p>
              {samples.length ? <ol>{[...samples].reverse().map((sample, i) => <li key={i}><time dateTime={new Date(sample.at).toISOString()}>{new Date(sample.at).toLocaleTimeString(locale)}</time> · {sample.state === "reachable" && sample.latency !== null ? t("connectionControl.sampleReachable", { latency: sample.latency }) : t("connectionControl.sampleUnreachable")}</li>)}</ol> : <p>{t("connectionControl.noSamples")}</p>}
            </details>
          </li>;
        })}</ul>
        {(needsSessionRecovery || connectionRoutes.some(route => state.identity[route] === "conflict" || state.identity[route] === "unprepared")) && <Button className="secondary-button" isDisabled={working || session.isRefetching} onPress={() => void check()}>{working ? t("connectionControl.recovering") : t("connectionControl.restore")}</Button>}
        {connectionRoutes.some(route => state.identity[route] === "conflict") && <p role="status" className="connection-copy">{t("connectionControl.resolveConflict")}</p>}
        {state.health[state.active].state === "reachable" && !working && state.identity[state.active] === "unprepared" && <p className="connection-copy" role="status">{t("connectionControl.confirmLogin")} {!session.data?.user && t.rich("connection.relogin", { login: chunks => <Link to="/login" onClick={() => setOpen(false)}>{chunks}</Link> })}</p>}
        <details className="connection-help"><summary>{t("connectionControl.help")}</summary>
          <p>{t.rich("connection.browserOfflineHelp", { term: chunks => <strong>{chunks}</strong> })}</p>
          <p>{t.rich("connection.issueHelp", { term: chunks => <strong>{chunks}</strong> })}</p>
          <p>{t.rich("connection.identityHelp", { term: chunks => <strong>{chunks}</strong> })}</p>
          <p>{t.rich("connection.reachableHelp", { term: chunks => <strong>{chunks}</strong> })}</p>
          <p>{t("connection.statusScope")}</p>
          <p>{t("connectionControl.availabilityNote")}</p>
          <p>{t("connectionControl.troubleshooting")}</p>
        </details>
      </Dialog></Modal>
    </ModalOverlay>
  </>;
}
