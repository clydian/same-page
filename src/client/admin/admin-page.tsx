import { useAppNavigation } from "../navigation/navigation-context";
import { useCallback, useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { Button } from "react-aria-components";
import { useApplicationIdentity } from "../auth/application-identity";
import { loginHref } from "../auth/login-return";
import { LoadingStatus } from "../components/loading-status";
import { adminSession, AdminRequestError, type AdminCapabilities } from "./api";
import { Directory } from "./directory";
import { ScoreReview } from "./score-review";
import { Audit } from "./audit";
import "../score-library/attachments/attachments.css";
import "./admin.css";
type Capabilities = AdminCapabilities;
export default function AdminPage() {
  const identity = useApplicationIdentity();
  const location = useLocation();
  if (identity.onlineState === "checking")
    return <LoadingStatus>正在确认登录…</LoadingStatus>;
  if (
    identity.onlineState !== "authenticated" ||
    !identity.session.data?.user.id
  )
    return (
      <div className="page-shell admin-page admin-sign-in">
        <p className="eyebrow">合谱 · 内部工具</p>
        <h1>登录产品后台</h1>
        <p>使用已获后台授权的合谱邮箱或 Google 登录。</p>
        <Link className="primary-link" to={loginHref(location.pathname)}>登录</Link>
      </div>
    );
  return (
    <AdminWorkspace
      key={`${identity.session.data?.user.id}:${identity.session.data?.session.id}`}
    />
  );
}
function AdminWorkspace() {
  const identity = useApplicationIdentity();
  const navigation = useAppNavigation();
  const [cap, setCap] = useState<Capabilities | null>(null),
    [error, setError] = useState(""),
    [denied, setDenied] = useState(false),
    [audit, setAudit] = useState(false);
  const onDenied = useCallback(() => {
    setDenied(true);
    setCap(null);
  }, []);
  const report = useCallback(
    (e: unknown) => {
      if (e instanceof AdminRequestError && [401, 403].includes(e.status)) {
        onDenied();
      } else setError(e instanceof Error ? e.message : "无法完成操作。");
    },
    [onDenied],
  );
  useEffect(() => {
    const abort = new AbortController();
    const check = () => {
      void adminSession(abort.signal)
        .then((c) => {
          if (!abort.signal.aborted) setCap(c);
        })
        .catch((e) => {
          if (!abort.signal.aborted) report(e);
        });
    };
    check();
    window.addEventListener("focus", check);
    return () => {
      abort.abort();
      window.removeEventListener("focus", check);
    };
  }, [report]);
  const { scoreId } = useParams();
  return (
    <div className="app-page">
      <header className="task-header admin-header">
        <strong>合谱</strong><span>产品后台</span>
        <small className="admin-identity">{identity.session.data?.user.email}</small>
      </header>
      <main className="page-shell admin-page">
        {denied ? (
          <p role="alert">当前身份没有产品运营权限，或授权已撤销。</p>
        ) : !cap ? (
          <>
            <LoadingStatus>正在确认运营权限…</LoadingStatus>
            {error && <p role="alert">{error}</p>}
          </>
        ) : (
          <>
            <nav className="admin-nav">
              <Link className="admin-nav-item" aria-current={!audit ? "page" : undefined} to="/admin" onClick={() => setAudit(false)}>
                乐谱工作台
              </Link>
              <Button
                className="admin-nav-item"
                aria-current={audit ? "page" : undefined}
                onPress={() =>
                  navigation.afterEditing(() => setAudit((a) => !a))
                }
              >
                操作记录
              </Button>
              <span>草稿仅在后台可见</span>
            </nav>
            {audit ? (
              <Audit onError={report} />
            ) : scoreId ? (
              <ScoreReview
                key={scoreId}
                id={scoreId}
                cap={cap}
                onError={report}
                onDenied={onDenied}
              />
            ) : (
              <Directory onError={report} />
            )}
          </>
        )}
      </main>
    </div>
  );
}
