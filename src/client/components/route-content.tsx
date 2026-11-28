import { useMessages } from "../../i18n";
import { diagnosticErrorType, recordFailure } from "../diagnostics/diagnostics";
import { ReaderLoading } from "../navigation/reader-loading";
import { PitchMonitorRouteFeedback } from "../pitch-monitor/pitch-monitor-shell";
import { Component, Suspense, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { DrivePage } from "../score-library/drive-page";
import { AppHeader } from "./app-header";
import { BottomNavigation } from "./bottom-navigation";
import { TaskHeader } from "./task-header";
import { LoadingStatus } from "./loading-status";
import { driveSettingsTitleKey } from "./route-titles";

export function RouteContent({ children, showHeader = true }: { children: ReactNode; showHeader?: boolean }) {
  const { pathname } = useLocation();
  return <RouteErrorBoundary key={pathname} fallback={<RouteFeedback failed showHeader={showHeader} />}>
    <Suspense fallback={<RouteFeedback showHeader={showHeader} />}>{children}</Suspense>
  </RouteErrorBoundary>;
}

function RouteFeedback({ failed = false, showHeader = true }: { failed?: boolean; showHeader?: boolean }) {
  const t = useMessages("common");
  const practice = useMessages("practice");
  const { pathname } = useLocation();
  const drive = pathname.match(/^\/choirs\/([^/]+)/)?.[1];
  const tab = /\/tools\/?$/.test(pathname) ? "tools" : /\/mine\/?$/.test(pathname) ? "mine" : undefined;
  if (/\/tools\/pitch-monitor\/?$/.test(pathname)) return <PitchMonitorRouteFeedback failed={failed} />;
  if (!failed && drive && pathname === `/choirs/${drive}`) return <DrivePage choirId={drive} />;
  if (!failed && pathname.includes("/scores/") && drive) return <ReaderLoading choirId={drive} />;
  const title = tab ? t(tab)
    : pathname.includes("/scores/") ? t("reader")
    : pathname.endsWith("/settings") ? t("driveSettings")
    : pathname.endsWith("/preferences") ? t("readingPreferences")
    : pathname.includes("/shared-layers") ? t("sharedLayers")
    : pathname.endsWith("/memberships") ? t("membership")
    : pathname === "/login" ? t("signIn")
    : pathname === "/user/lifecycle" ? t("accountLifecycle")
    : pathname.endsWith("/sight-singing") ? practice("sightPractice")
    : pathname.endsWith("/rhythm") ? practice("rhythmPractice")
    : pathname.endsWith("/me") ? t("driveIdentity")
    : pathname === "/appearance" ? t("appearance")
    : pathname === "/user" ? t("account")
    : pathname.includes("/settings/") ? t(driveSettingsTitleKey(pathname.split("/settings/")[1]))
    : pathname === "/help" ? t("help")
    : pathname === "/about" ? t("about")
    : pathname === "/diagnostics" ? t("feedback")
    : pathname === "/privacy" ? t("privacy") : drive ? t("scoreDrive") : t("brandShort");
  const home = pathname === "/" || pathname === "/drives";
  return <div className="app-page">
    {!home && !tab && showHeader && <TaskHeader title={title} backTo={drive ? `/choirs/${drive}` : "/drives"} />}
    <main className={`page-shell${home ? "" : " settings-page settings-ux"}`}>
    {home && <><AppHeader /><h1>{title}</h1></>}
    {tab && <h1 className="visually-hidden">{title}</h1>}
    {failed ? <p role="alert">{t("routeFailed", { title })}</p> : <LoadingStatus>{t("routeLoading", { title })}</LoadingStatus>}
    <Link className="text-button" state={{ home: true }} to={drive && pathname !== `/choirs/${drive}` ? `/choirs/${drive}` : "/"}>{drive && pathname !== `/choirs/${drive}` ? t("backToDrive") : t("backHome")}</Link>
    {failed && <Link className="secondary-link" to="/diagnostics">{t("reportProblem")}</Link>}
    {failed && <button className="secondary-button" onClick={() => window.location.reload()}>{t("reload")}</button>}
    </main>
    {tab && <BottomNavigation choirId={drive} active={tab} />}
  </div>;
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
