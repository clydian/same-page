import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { z } from "zod";
import { diagnosticCategories } from "../../shared/diagnostics";
import { diagnosticReportSchema } from "../../shared/diagnostic-report";
import { diagnosticInboxItemSchema, diagnosticInboxListSchema, diagnosticStatusLabels, diagnosticStatuses } from "../../shared/diagnostic-inbox";
import { adminFetch, type AdminCapabilities } from "./api";
import { ConfirmDialog } from "../settings/confirm-dialog";
import { LoadingStatus } from "../components/loading-status";

const dateTime = (time: number) => new Date(time).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
const detailSchema = diagnosticInboxItemSchema.extend({ report: diagnosticReportSchema });
const labels: Record<typeof diagnosticCategories[number], string> = {
  permission: "权限", validation: "校验", conflict: "冲突", "not-found": "内容不可用",
  "rate-limit": "请求限流", network: "网络", internal: "内部错误",
};

export function DiagnosticInbox({ cap, onError }: { cap: AdminCapabilities; onError(error: unknown): void }) {
  const { reportId } = useParams();
  const location = useLocation();
  if (!cap.manageReports) return <p role="alert">当前身份没有问题反馈处理权限。</p>;
  return reportId ? <ReportDetail key={reportId} id={reportId} canDelete={!!cap.deleteReports} onError={onError} /> : <ReportList key={location.search} onError={onError} />;
}

function ReportList({ onError }: { onError(error: unknown): void }) {
  const location = useLocation(), navigate = useNavigate();
  const [data, setData] = useState<z.infer<typeof diagnosticInboxListSchema> | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const query = new URLSearchParams(location.search);
  useEffect(() => {
    const controller = new AbortController();
    void adminFetch(`/reports${location.search}`, { signal: controller.signal })
      .then(response => response.json()).then(value => {
        if (!controller.signal.aborted) setData(diagnosticInboxListSchema.parse(value));
      }).catch(error => { if (!controller.signal.aborted) { setError("无法读取反馈，请检查筛选条件后重试。"); onError(error); } });
    return () => controller.abort();
  }, [location.search, onError, attempt]);
  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget), next = new URLSearchParams();
    for (const field of ["id", "status", "build", "category"]) {
      const value = String(values.get(field) ?? "").trim(); if (value) next.set(field, value);
    }
    for (const field of ["from", "until"]) {
      const value = String(values.get(field) ?? "");
      if (value) next.set(field, String(Date.parse(`${value}T00:00:00+08:00`) + (field === "until" ? 86400000 : 0)));
    }
    setData(null); setError(""); setAttempt(value => value + 1); void navigate(`/admin/reports?${next}`);
  }
  const inputDate = (key: string) => {
    const time = Number(query.get(key));
    if (!query.has(key) || !Number.isFinite(time) || time < 0 || time > 8640000000000000 - 86400000) return "";
    return new Date(time + 8 * 3600000 - (key === "until" ? 86400000 : 0)).toISOString().slice(0, 10);
  };
  function page(before?: string) {
    const next = new URLSearchParams(location.search);
    if (before) next.set("before", before); else next.delete("before");
    setData(null); setError(""); void navigate(`/admin/reports?${next}`);
  }
  return <section>
    <h1 className="admin-title">问题反馈</h1>
    <p>新反馈保存 180 天；历史反馈按原到期时间清理。日期筛选采用北京时间。</p>
    <form className="admin-filters diagnostic-inbox-filters" onSubmit={search} key={location.search}>
      <label>反馈编号<input name="id" defaultValue={query.get("id") ?? ""} placeholder="完整反馈编号" /></label>
      <label>处理状态<select name="status" defaultValue={query.get("status") ?? ""}><option value="">全部状态</option>{diagnosticStatuses.map(status => <option key={status} value={status}>{diagnosticStatusLabels[status]}</option>)}</select></label>
      <label>版本或构建 SHA<input name="build" defaultValue={query.get("build") ?? ""} placeholder="v26.10.20.1830 或完整 SHA" /></label>
      <label>错误类别<select name="category" defaultValue={query.get("category") ?? ""}><option value="">全部类别</option>{diagnosticCategories.map(category => <option key={category} value={category}>{labels[category]}</option>)}</select></label>
      <label>开始日期<input type="date" name="from" defaultValue={inputDate("from")} /></label>
      <label>结束日期<input type="date" name="until" defaultValue={inputDate("until")} /></label>
      <button className="primary-button">筛选反馈</button>
      <Link className="secondary-link" to="/admin/reports" onClick={() => { setData(null); setError(""); setAttempt(value => value + 1); }}>重置筛选</Link>
    </form>
    {error ? <p role="alert">{error}</p> : !data ? <LoadingStatus>正在读取反馈…</LoadingStatus> : <>
      {data.reports.length ? <div className="admin-table diagnostic-inbox-table"><table><thead><tr><th>反馈</th><th>版本</th><th>状态</th><th>收到时间</th></tr></thead>
        <tbody>{data.reports.map(report => <tr key={report.id}><td><Link to={`/admin/reports/${report.id}${location.search}`}>{report.description || "未填写描述"}</Link><small>{report.id}</small><small>{report.categories.map(category => labels[category]).join("、") || "未记录系统错误"}</small></td>
          <td data-label="版本">{report.clientVersion ?? "历史版本"}<small>{report.clientBuild ?? "未知构建"}</small></td><td data-label="状态">{diagnosticStatusLabels[report.status]}</td><td data-label="收到时间">{dateTime(report.createdAt)}</td></tr>)}</tbody></table></div> : <p>没有符合条件的反馈。</p>}
      <div className="admin-actions">{query.has("before") && <button className="secondary-button" onClick={() => page()}>返回第一页</button>}
        {data.next && <button className="secondary-button" onClick={() => page(data.next!)}>下一页</button>}</div>
    </>}
  </section>;
}

function ReportDetail({ id, canDelete, onError }: { id: string; canDelete: boolean; onError(error: unknown): void }) {
  const location = useLocation(), navigate = useNavigate();
  const [data, setData] = useState<z.infer<typeof detailSchema> | null>(null);
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [confirmDelete, setConfirmDelete] = useState(false);
  const [revision, setRevision] = useState(0);
  const mutation = useRef<AbortController | null>(null);
  useEffect(() => () => mutation.current?.abort(), []);
  useEffect(() => {
    const controller = new AbortController();
    void adminFetch(`/reports/${id}`, { signal: controller.signal }).then(response => response.json()).then(value => {
      if (!controller.signal.aborted) setData(detailSchema.parse(value));
    }).catch(error => { if (!controller.signal.aborted) { setError("无法读取反馈，报告可能已经到期或删除。"); onError(error); } });
    return () => controller.abort();
  }, [id, revision, onError]);
  async function mutate(status?: string) {
    const controller = new AbortController();
    mutation.current?.abort(); mutation.current = controller;
    setBusy(true); setError("");
    try {
      await adminFetch(`/reports/${id}`, { ...(status ? { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) } : { method: "DELETE" }), signal: controller.signal });
      if (controller.signal.aborted) return;
      if (!status) { void navigate(`/admin/reports${location.search}`, { replace: true }); return; }
      setRevision(value => value + 1);
    } catch (error) { if (!controller.signal.aborted) { setError("操作未完成，请重新读取后重试。"); onError(error); } }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  return <section>
    <Link className="admin-back-link" to={`/admin/reports${location.search}`}>返回反馈列表</Link>
    <h1 className="admin-title">反馈详情</h1>
    {error && <p role="alert">{error}</p>}
    {!data ? !error && <LoadingStatus>正在读取反馈…</LoadingStatus> : <>
      <p className="diagnostic-inbox-id">{data.id}</p>
      <div className="diagnostic-inbox-description">{data.report.description || "未填写描述"}</div>
      <dl className="diagnostic-inbox-facts"><div><dt>当前状态</dt><dd>{diagnosticStatusLabels[data.status]}</dd></div>
        <div><dt>收到时间</dt><dd>{dateTime(data.createdAt)}</dd></div><div><dt>自动删除时间</dt><dd>{dateTime(data.expiresAt)}</dd></div>
        <div><dt>应用版本</dt><dd>{data.clientVersion ?? "未提供展示版本"}</dd></div><div><dt>构建 SHA</dt><dd>{data.clientBuild ?? "未知"}</dd></div>
        <div><dt>设备环境</dt><dd>{data.report.environment.browser} {data.report.environment.browserVersion} / {data.report.environment.system} {data.report.environment.systemVersion}</dd></div>
        <div><dt>运行方式</dt><dd>{data.report.environment.standalone ? "独立应用" : "浏览器"} · {data.report.environment.viewportWidth} × {data.report.environment.viewportHeight}</dd></div>
      </dl>
      <div className="admin-actions">{diagnosticStatuses.map(status => <button key={status} className="secondary-button" disabled={busy || data.status === status} onClick={() => void mutate(status)}>标记为{diagnosticStatusLabels[status]}</button>)}
        {canDelete && <button className="secondary-button destructive-button" disabled={busy} onClick={() => setConfirmDelete(true)}>删除反馈</button>}
      </div>
      <h2>诊断信息</h2><p>共 {data.report.records.length} 条错误记录。以下内容由用户主动提交。</p>
      <details><summary>查看完整报告</summary><pre className="diagnostic-inbox-payload">{JSON.stringify(data.report, null, 2)}</pre></details>
      <ConfirmDialog busy={busy} onClose={() => setConfirmDelete(false)} confirmation={confirmDelete ? { title: "删除这份反馈？", message: "报告正文和问题描述将永久删除，无法恢复。处理记录仅保留反馈编号、操作人和时间。", action: "确认删除", destructive: true, onConfirm: () => mutate() } : null} />
    </>}
  </section>;
}
