import { LoaderCircle, Wifi, WifiOff, X } from "lucide-react";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { Button, Heading, Modal, ModalOverlay } from "react-aria-components";
import { Link, useLocation } from "react-router-dom";
import { connectionRoutes, type ConnectionMode } from "../../shared/connection";
import { authClient } from "../auth/auth-client";
import { Dialog } from "../navigation/overlays";
import { connections, connectionsEnabled, connectionWebsites, setConnectionMode } from "./connection";
import { observeHealth } from "./sampling";
import { routeAvailability } from "./presentation";
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
  const attention = disconnected || state.identity[state.active] === "conflict" || state.identity[state.active] === "unprepared";
  const working = state.checking || state.preparing;
  const visible = scrollingVisible || attention || working || open;
  const fabLabel = disconnected ? "连接异常" : state.identity[state.active] === "conflict" ? "需处理" : null;
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
    <Button ref={button} className="connection-fab" aria-label={["连接线路", fabLabel, working ? "正在检测…" : null].filter(Boolean).join("，")}
      aria-haspopup="dialog" aria-expanded={open} data-visible={visible} data-attention={attention || undefined} data-has-label={Boolean(fabLabel) || undefined} inert={!visible}
      onPress={() => { setNow(Date.now()); setOpen(true); void check(); }}>
      {working ? <LoaderCircle className="connection-spinner" size={19} aria-hidden="true" /> : disconnected ? <WifiOff size={19} aria-hidden="true" /> : <Wifi size={19} aria-hidden="true" />}
      {fabLabel && <span>{fabLabel}</span>}
    </Button>
    <ModalOverlay className="modal-overlay" isOpen={open} onOpenChange={setOpen} isDismissable>
      <Modal className="app-modal app-modal--compact"><Dialog className="app-dialog connection-dialog" aria-label="连接线路">
        <div className="connection-heading"><Heading slot="title">连接线路</Heading><Button className="icon-button" onPress={() => setOpen(false)} aria-label="关闭连接面板"><X size={20} aria-hidden="true" /></Button></div>
        <p className="connection-current" role="status">{state.attempting ? `正在尝试${names[state.attempting]}…` : `当前线路：${names[state.active]}${disconnected ? "（暂时连不上）" : availability === "stale" || availability === "unknown" ? "（待检测）" : state.identity[state.active] !== "ready" ? "（待确认）" : ""}`}</p>
        {window.location.origin === connectionWebsites.backup && <p className="connection-origin-note">当前为备用网站，本机草稿与原网站分开保存。</p>}
        <fieldset className="connection-modes"><legend>线路选择</legend>
          {(["auto", "direct", "backup"] as const).map(mode => <label key={mode} data-selected={state.mode === mode}>
            <input type="radio" name="connection-mode" value={mode} checked={state.mode === mode} onChange={() => { setConnectionMode(mode as ConnectionMode); void check(); }} />
            <span className="connection-mode-label">{mode === "auto" ? <>自动<span className="connection-recommended">推荐</span></> : names[mode]}</span>
          </label>)}
        </fieldset>
        <ul className="connection-routes">{connectionRoutes.map(route => {
          const samples = state.samples[route];
          const latest = samples.at(-1);
          const stale = Boolean(latest && now - latest.at > 45_000);
          const health = latest ? { state: latest.state } : { state: "unknown" };
          const age = latest ? Math.max(0, Math.floor((now - latest.at) / 1000)) : null;
          const freshness = document.hidden ? "检测已暂停" : stale ? "检测已过期" : age === null ? "正在检测…" : age < 1 ? "刚刚检测" : `${age} 秒前检测`;
          const result = state.identity[route] === "conflict" ? "登录不一致" : health.state === "reachable" ? "可连接" : health.state === "unreachable" ? "暂时连不上" : "尚未检测";
          const conflict = state.identity[route] === "conflict";
          return <li key={route}><div><strong>{names[route]}</strong><span className={`connection-health connection-health--${conflict ? "conflict" : stale ? "unknown" : health.state}`}>
            {stale && !conflict ? "结果已过期" : result}</span></div>
            <details className="connection-samples"><summary className="connection-observation" aria-label={`${names[route]}检测详情，${freshness}，${samples.length} 次采样`}><span className="connection-trail" aria-hidden="true">{Array.from({ length: 20 }, (_, i) => {
              const sample = samples[i - (20 - samples.length)];
              return <i key={i} data-result={sample?.state ?? "unknown"} />;
            })}</span><small>{freshness}</small></summary>
              <p>{route === "direct" ? "Cloudflare" : "阿里云 ESA（境外节点）"} · 仅代表各次检测，不代表持续可用。</p>
              <p>实点为成功，空心点为失败或超时，灰点为尚未检测；按检测先后排列，间隔不等。</p>
              {samples.length ? <ol>{[...samples].reverse().map((sample, i) => <li key={i}><time dateTime={new Date(sample.at).toISOString()}>{new Date(sample.at).toLocaleTimeString()}</time> · {sample.state === "reachable" ? `可连接 · ${sample.latency} ms` : "暂时连不上（失败或超时）"}</li>)}</ol> : <p>尚未完成检测。</p>}
            </details>
          </li>;
        })}</ul>
        {(needsSessionRecovery || connectionRoutes.some(route => state.identity[route] === "conflict" || state.identity[route] === "unprepared")) && <Button className="secondary-button" isDisabled={working || session.isRefetching} onPress={() => void check()}>{working ? "正在恢复…" : "恢复连接"}</Button>}
        {connectionRoutes.some(route => state.identity[route] === "conflict") && <p role="status" className="connection-copy">请在另一网站核对登录，退出不同的登录后恢复连接。不要清除站点数据，未同步草稿仍需保留。</p>}
        {state.health[state.active].state === "reachable" && !working && state.identity[state.active] === "unprepared" && <p className="connection-copy" role="status">此线路暂时无法确认登录，请点击“恢复连接”。{!session.data?.user && <>仍无法使用时，可<Link to="/login" onClick={() => setOpen(false)}>前往登录</Link>。</>}</p>}
        <details className="connection-help"><summary>两条线路都连不上怎么办？</summary>
          <p>两条线路均不保证中国大陆境内访问稳定。</p>
          <p>可尝试切换 Wi-Fi 或移动网络；如果已有可用的 VPN，也可以尝试开启。面板打开时会自动检测；需要重新确认登录时，可点击“恢复连接”。</p>
        </details>
      </Dialog></Modal>
    </ModalOverlay>
  </>;
}
