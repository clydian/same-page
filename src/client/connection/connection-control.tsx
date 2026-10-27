import { LoaderCircle, Wifi, WifiOff, X } from "lucide-react";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { Button, Heading, Modal, ModalOverlay } from "react-aria-components";
import { Link, useLocation } from "react-router-dom";
import { connectionRoutes, type ConnectionMode } from "../../shared/connection";
import { authClient } from "../auth/auth-client";
import { Dialog } from "../navigation/overlays";
import { connections, connectionsEnabled, connectionWebsites, setConnectionMode } from "./connection";
import { useFloatingVisibility } from "./use-floating-visibility";
import "./connection.css";

const names = { direct: "直连", backup: "备用" };
const identityNames = { unknown: "尚未检查登录", ready: "登录已确认", unprepared: "尚未确认登录，请重新检测", conflict: "与当前登录不一致" };
export function ConnectionControl() {
  const location = useLocation();
  // Available before login too; first-page loading failure still needs the
  // independently discoverable emergency website.
  return connectionsEnabled && (/^\/(?:drives|login)?$/.test(location.pathname) || /^\/choirs\/[^/]+$/.test(location.pathname)) ? <ConnectionButton /> : null;
}

function ConnectionButton() {
  const state = useSyncExternalStore(connections.subscribe, connections.getSnapshot);
  const session = authClient.useSession();
  const [open, setOpen] = useState(false);
  const { button, visible: scrollingVisible } = useFloatingVisibility();
  const disconnected = state.health[state.active].state === "unreachable";
  const attention = disconnected || state.identity[state.active] === "conflict" || state.identity[state.active] === "unprepared";
  const working = state.checking || state.preparing;
  const visible = scrollingVisible || attention || working || open;
  const alternate = state.active === "direct" ? "backup" : "direct";
  const alternateReady = state.health[alternate].state === "reachable" && state.identity[alternate] === "ready";
  const manualFailure = disconnected && state.mode !== "auto";
  const loginAttention = !disconnected && (state.identity[state.active] === "conflict" || state.identity[state.active] === "unprepared");
  const fabLabel = working ? "检测中…" : disconnected ? "连接异常" : loginAttention ? "检查登录" : state.active === "backup" ? "备用" : "连接";
  const current = disconnected
    ? manualFailure ? `指定的${names[state.active]}暂时连不上` : "当前线路暂时连不上"
    : state.identity[state.active] === "conflict" ? "当前线路的登录不一致"
    : state.health[state.active].state === "reachable" && state.identity[state.active] === "unprepared" ? "当前线路需要确认登录"
    : state.health[state.active].state === "unknown" ? `当前选择${names[state.active]}线路` : `当前使用${names[state.active]}线路`;
  const guidance = working ? "正在检查线路和登录状态…"
    : manualFailure && alternateReady ? `${names[alternate]}线路可连接。你已固定${names[state.active]}，需要手动改选。`
    : disconnected ? "可重新检测，或选择其他线路；本机草稿仍保留。"
    : loginAttention ? "登录还需要确认。请先重新检测。"
    : "切换线路保留当前网页和本机草稿。";
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
    <Button ref={button} className="connection-fab" aria-label={fabLabel === "连接" ? "连接线路" : `连接线路：${fabLabel}`}
      aria-haspopup="dialog" aria-expanded={open} data-visible={visible} data-attention={attention || undefined} data-working={working || undefined} inert={!visible}
      onPress={() => { setOpen(true); void check(); }}>
      {working ? <LoaderCircle className="connection-spinner" size={19} aria-hidden="true" /> : disconnected ? <WifiOff size={19} aria-hidden="true" /> : <Wifi size={19} aria-hidden="true" />}
      <span>{fabLabel}</span>
    </Button>
    <ModalOverlay className="modal-overlay" isOpen={open} onOpenChange={setOpen} isDismissable>
      <Modal className="app-modal app-modal--compact"><Dialog className="app-dialog connection-dialog" aria-label="连接线路">
        <div className="connection-heading"><Heading slot="title">连接线路</Heading><Button className="icon-button" onPress={() => setOpen(false)} aria-label="关闭连接面板"><X size={20} aria-hidden="true" /></Button></div>
        <div className="connection-summary" data-attention={attention || undefined}>
          <span className="connection-summary-icon">{disconnected ? <WifiOff size={20} aria-hidden="true" /> : <Wifi size={20} aria-hidden="true" />}</span>
          <div><p className="connection-current" role="status">{current}</p><p className="connection-summary-copy">{guidance}</p></div>
          {manualFailure && alternateReady && !working && <Button className="secondary-button connection-recovery" onPress={() => { setConnectionMode(alternate); void check(); }}>改用{names[alternate]}线路</Button>}
        </div>
        {window.location.origin === connectionWebsites.backup && <p className="connection-origin-note">当前打开备用网站。这里的本机草稿、离线文件与原网站分开保存。</p>}
        <fieldset className="connection-modes"><legend>线路选择</legend>
          {(["auto", "direct", "backup"] as const).map(mode => <label key={mode} data-selected={state.mode === mode}>
            <input type="radio" name="connection-mode" value={mode} checked={state.mode === mode} onChange={() => { setConnectionMode(mode as ConnectionMode); void check(); }} />
            {mode === "auto" ? "自动" : names[mode]}
          </label>)}
        </fieldset>
        <p className="connection-copy">{state.mode === "auto" ? "优先直连，连接失败时尝试备用；直连通过两次检测后再切回。" : `只用${names[state.mode]}，不会自动切换。`}</p>
        <ul className="connection-routes">{connectionRoutes.map(route => {
          const health = state.health[route];
          return <li key={route}><div><strong>{names[route]}</strong><span className={`connection-health connection-health--${health.state}`}>
            {health.state === "reachable" ? "可连接" : health.state === "unreachable" ? "暂时连不上" : "尚未检测"}</span></div>
            {(session.data?.user || state.identity[route] === "conflict") && <p>{health.state === "unreachable" ? "连通后再检查登录" : identityNames[state.identity[route]]}</p>}
            <small>{health.checkedAt ? `最近检查 ${new Date(health.checkedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}${health.latency !== null ? ` · 响应 ${Math.round(health.latency)} ms` : ""}` : "打开面板时检查，不持续测速"}</small>
          </li>;
        })}</ul>
        <Button className="secondary-button" isDisabled={working || session.isRefetching} onPress={() => void check()}>{working ? "正在检测…" : "重新检测"}</Button>
        {connectionRoutes.some(route => state.identity[route] === "conflict") && <p role="status" className="connection-copy">请在另一网站核对登录，退出不同的登录后再检测。不要清除站点数据，未同步草稿仍需保留。</p>}
        {state.health[state.active].state === "reachable" && !working && state.identity[state.active] === "unprepared" && !session.data?.user && <p className="connection-copy">尚未确认此线路的登录。请先重新检测；仍无法使用时，可<Link to="/login" onClick={() => setOpen(false)}>前往登录</Link>。本机草稿仍保留。</p>}
        <details className="connection-help"><summary>页面打不开时怎么办？</summary>
          <p>自动模式恢复直连前需两次检测通过，间隔至少 10 秒；不会持续后台测速。文件是否保存成功，请以具体上传和同步提示为准。</p>
          <p>可另开<a href={connectionWebsites.backup} target="_blank" rel="noopener noreferrer">备用网站</a>。两个网址的本机草稿、离线文件和安装应用分别保存，未同步内容不会随网址搬迁。日常在当前页面切线即可。</p>
          <p>备用线路支持邮箱密码登录；Google 登录请使用原网站的直连入口，并保持 Google 服务可用。</p>
        </details>
      </Dialog></Modal>
    </ModalOverlay>
  </>;
}
