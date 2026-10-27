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
  const fabLabel = disconnected ? "连接异常" : state.identity[state.active] === "conflict" ? "需处理" : null;
  const current = disconnected
    ? manualFailure ? `指定的${names[state.active]}暂时连不上` : "当前线路暂时连不上"
    : state.identity[state.active] === "conflict" ? "当前线路的登录不一致"
    : state.health[state.active].state === "reachable" && state.identity[state.active] === "unprepared" ? "当前线路需要确认登录"
    : state.health[state.active].state === "unknown" ? `当前选择${names[state.active]}线路` : `当前使用${names[state.active]}线路`;
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
    <Button ref={button} className="connection-fab" aria-label={working ? "连接线路：正在检测…" : fabLabel ? `连接线路：${fabLabel}` : "连接线路"}
      aria-haspopup="dialog" aria-expanded={open} data-visible={visible} data-attention={attention || undefined} data-has-label={Boolean(fabLabel) || undefined} inert={!visible}
      onPress={() => { setOpen(true); void check(); }}>
      {working ? <LoaderCircle className="connection-spinner" size={19} aria-hidden="true" /> : disconnected ? <WifiOff size={19} aria-hidden="true" /> : <Wifi size={19} aria-hidden="true" />}
      {fabLabel && <span>{fabLabel}</span>}
    </Button>
    <ModalOverlay className="modal-overlay" isOpen={open} onOpenChange={setOpen} isDismissable>
      <Modal className="app-modal app-modal--compact"><Dialog className="app-dialog connection-dialog" aria-label="连接线路">
        <div className="connection-heading"><Heading slot="title">连接线路</Heading><Button className="icon-button" onPress={() => setOpen(false)} aria-label="关闭连接面板"><X size={20} aria-hidden="true" /></Button></div>
        <div className="connection-summary">
          <p className="connection-current" role="status">{current}</p>
          {manualFailure && alternateReady && !working && <Button className="secondary-button connection-recovery" onPress={() => { setConnectionMode(alternate); void check(); }}>改用{names[alternate]}线路</Button>}
        </div>
        {window.location.origin === connectionWebsites.backup && <p className="connection-origin-note">当前为备用网站，本机草稿与原网站分开保存。</p>}
        <fieldset className="connection-modes"><legend>线路选择</legend>
          {(["auto", "direct", "backup"] as const).map(mode => <label key={mode} data-selected={state.mode === mode}>
            <input type="radio" name="connection-mode" value={mode} checked={state.mode === mode} onChange={() => { setConnectionMode(mode as ConnectionMode); void check(); }} />
            <span className="connection-mode-label">{mode === "auto" ? <>自动<span className="connection-recommended">推荐</span></> : names[mode]}</span>
          </label>)}
        </fieldset>
        <ul className="connection-routes">{connectionRoutes.map(route => {
          const health = state.health[route];
          const conflict = health.state === "reachable" && state.identity[route] === "conflict";
          return <li key={route}><div><strong>{names[route]}</strong><span className={`connection-health connection-health--${conflict ? "conflict" : health.state}`}>
            {conflict ? "登录不一致" : health.state === "reachable" ? "可连接" : health.state === "unreachable" ? "暂时连不上" : "尚未检测"}</span></div>
            <small>{route === "direct" ? "Cloudflare" : "阿里云 ESA（境外节点）"}</small>
          </li>;
        })}</ul>
        <Button className="secondary-button" isDisabled={working || session.isRefetching} onPress={() => void check()}>{working ? "正在检测…" : "重新检测"}</Button>
        {connectionRoutes.some(route => state.identity[route] === "conflict") && <p role="status" className="connection-copy">请在另一网站核对登录，退出不同的登录后再检测。不要清除站点数据，未同步草稿仍需保留。</p>}
        {state.health[state.active].state === "reachable" && !working && state.identity[state.active] === "unprepared" && !session.data?.user && <p className="connection-copy">尚未确认此线路的登录。请先重新检测；仍无法使用时，可<Link to="/login" onClick={() => setOpen(false)}>前往登录</Link>。本机草稿仍保留。</p>}
        <p className="connection-notice">两条线路均不保证中国大陆境内访问稳定。连接不畅时，可尝试切换 Wi-Fi 或移动网络。</p>
      </Dialog></Modal>
    </ModalOverlay>
  </>;
}
