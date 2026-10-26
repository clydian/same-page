import { LoaderCircle, Wifi, WifiOff } from "lucide-react";
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
const identityNames = { unknown: "登录准备尚未检查", ready: "同一会话已就绪", unprepared: "登录尚未就绪", conflict: "另一入口有不同登录，请先处理" };
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
    <Button ref={button} className="connection-fab" aria-label={disconnected ? "无法连接合谱，查看连接线路" : "连接线路"}
      aria-haspopup="dialog" data-visible={visible} data-disconnected={disconnected || undefined} inert={!visible}
      onPress={() => { setOpen(true); void check(); }}>
      {working ? <LoaderCircle className="connection-spinner" size={25} aria-hidden="true" /> : disconnected ? <WifiOff size={25} aria-hidden="true" /> : <Wifi size={25} aria-hidden="true" />}
    </Button>
    <ModalOverlay className="modal-overlay" isOpen={open} onOpenChange={setOpen} isDismissable>
      <Modal className="app-modal app-modal--compact"><Dialog className="app-dialog connection-dialog" aria-label="连接线路">
        <div className="connection-heading"><Heading slot="title">连接线路</Heading><Button className="text-button" onPress={() => setOpen(false)} aria-label="关闭连接面板">关闭</Button></div>
        {window.location.origin === connectionWebsites.backup && <p className="connection-origin-note">当前是备用网站。本机草稿、离线文件与原网址分别保存；云端内容仍属于同一用户。</p>}
        <p className="connection-current" role="status">{disconnected ? "暂时无法连接" : `当前使用${names[state.active]}线路`}{working ? " · 正在检测与准备…" : ""}</p>
        <fieldset className="connection-modes"><legend>线路选择</legend>
          {(["auto", "direct", "backup"] as const).map(mode => <label key={mode} data-selected={state.mode === mode}>
            <input type="radio" name="connection-mode" value={mode} checked={state.mode === mode} onChange={() => { setConnectionMode(mode as ConnectionMode); void check(); }} />
            {mode === "auto" ? "自动" : names[mode]}
          </label>)}
        </fieldset>
        <p className="connection-copy">{state.mode === "auto" ? "优先直连；网络故障时尝试备用。确认直连稳定后再切回。" : `仅使用${names[state.mode]}，不会自动改选其他线路。`}</p>
        <ul className="connection-routes">{connectionRoutes.map(route => {
          const health = state.health[route];
          return <li key={route}><div><strong>{names[route]}</strong><span className={`connection-health connection-health--${health.state}`}>
            {health.state === "reachable" ? "可达" : health.state === "unreachable" ? "暂不可达" : "尚未检测"}</span></div>
            <small>{health.checkedAt ? `最近检测 ${new Date(health.checkedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}${health.latency !== null ? ` · ${Math.round(health.latency)} ms` : ""}` : "打开面板时检测，不持续测速"}</small>
            {(session.data?.user || state.identity[route] === "conflict") && <p>{identityNames[state.identity[route]]}</p>}
          </li>;
        })}</ul>
        <Button className="secondary-button" isDisabled={working || session.isRefetching} onPress={() => void check()}>{working ? "正在检测…" : "重新检测"}</Button>
        {connectionRoutes.some(route => state.identity[route] === "conflict") && <p role="status" className="connection-copy">请在另一网站核对登录，退出不同的登录后再检测。不要清除站点数据，未同步草稿仍需保留。</p>}
        {state.identity[state.active] === "unprepared" && !session.data?.user && <p className="connection-copy">当前入口登录未就绪。可重新检测，或<Link to="/login" onClick={() => setOpen(false)}>重新登录</Link>；本机内容仍然保留。</p>}
        <p className="connection-copy">线路恢复后，仍以各项操作的保存与同步结果为准。</p>
        <details className="connection-help"><summary>页面打不开时怎么办？</summary>
          <p>可另开<a href={connectionWebsites.backup} target="_blank" rel="noopener noreferrer">备用网站</a>。两个网址的本机草稿、离线文件和安装应用分别保存，未同步内容不会随网址搬迁。日常在当前页面切线即可。</p>
          <p>备用线路支持邮箱密码登录；Google 登录请使用原网站的直连入口，并保持 Google 服务可用。</p>
        </details>
      </Dialog></Modal>
    </ModalOverlay>
  </>;
}
