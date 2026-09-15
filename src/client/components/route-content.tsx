import { diagnosticErrorType, recordFailure } from "../diagnostics/diagnostics";
import { ReaderLoading } from "../navigation/reader-loading";
import { Component, Suspense, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { AppHeader } from "./app-header";
import { TaskHeader } from "./task-header";
import { LoadingStatus } from "./loading-status";
import { driveSettingsTitle } from "./route-titles";

export function RouteContent({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return <RouteErrorBoundary key={pathname} fallback={<RouteFeedback failed />}>
    <Suspense fallback={<RouteFeedback />}>{children}</Suspense>
  </RouteErrorBoundary>;
}

function RouteFeedback({ failed = false }: { failed?: boolean }) {
  const { pathname } = useLocation();
  const drive = pathname.match(/^\/choirs\/([^/]+)/)?.[1];
  if (!failed && pathname.includes("/scores/") && drive) return <ReaderLoading choirId={drive} />;
  const title = pathname.includes("/scores/") ? "乐谱阅读器"
    : pathname.endsWith("/preferences") ? "阅读偏好"
    : pathname.includes("/shared-layers") ? "共享层"
    : pathname.endsWith("/memberships") ? "成员与权限"
    : pathname === "/login" ? "登录"
    : pathname === "/user/lifecycle" ? "用户删除与恢复"
    : pathname.endsWith("/me") ? "退出云盘成员身份"
    : pathname === "/user" ? "账户"
    : pathname.includes("/settings/") ? driveSettingsTitle(pathname.split("/settings/")[1])
    : pathname === "/help" ? "使用手册"
    : pathname === "/about" ? "关于合谱"
    : pathname === "/diagnostics" ? "故障诊断"
    : pathname === "/privacy" ? "隐私政策" : drive ? "乐谱云盘" : "合谱";
  const home = pathname === "/" || pathname === "/drives";
  return <div className="app-page">
    {!home && <TaskHeader title={title} backTo={drive ? `/choirs/${drive}` : "/drives"} />}
    <main className={`page-shell${home ? "" : " settings-page settings-ux"}`}>
    {home && <><AppHeader /><h1>{title}</h1></>}
    {failed ? <p role="alert">{title}加载失败，请重试。</p> : <LoadingStatus>正在加载{title}…</LoadingStatus>}
    <Link className="text-button" state={{ home: true }} to={drive && pathname !== `/choirs/${drive}` ? `/choirs/${drive}` : "/"}>{drive && pathname !== `/choirs/${drive}` ? "返回云盘" : "返回首页"}</Link>
    {failed && <Link className="secondary-link" to="/diagnostics">故障诊断</Link>}
    {failed && <button className="secondary-button" onClick={() => window.location.reload()}>重新加载页面</button>}
  </main></div>;
}

class RouteErrorBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: unknown) {
    recordFailure({ operation: "other", category: "internal", stage: "decode",
      step: "route-render", errorType: diagnosticErrorType(error) });
  }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}
