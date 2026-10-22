import { CheckCircle2, Send } from "lucide-react";
import "../support-pages.css";
import { useEffect, useState, useSyncExternalStore } from "react";
import { diagnosticReportRetentionDays, type DiagnosticReader } from "../../shared/diagnostic-report";
import { clearDiagnostics, exportDiagnostics, subscribeDiagnosticReset } from "./diagnostics";
import { captureDiagnosticReport, getDiagnosticSubmission, resetDiagnosticSubmission, sendDiagnosticReport,
  setDiagnosticDescription, subscribeDiagnosticSubmission } from "./diagnostic-submission";

export function DiagnosticReportForm({ reader = null }: { reader?: DiagnosticReader | null }) {
  const submission = useSyncExternalStore(subscribeDiagnosticSubmission, getDiagnosticSubmission);
  const [previewId] = useState(() => crypto.randomUUID());
  const [preview, setPreview] = useState(exportDiagnostics);
  const [message, setMessage] = useState("");
  useEffect(() => {
    const refresh = () => { setPreview(exportDiagnostics()); setMessage(""); };
    const unsubscribe = subscribeDiagnosticReset(refresh);
    const timer = setInterval(() => setPreview(exportDiagnostics()), 1000);
    return () => { unsubscribe(); clearInterval(timer); };
  }, []);
  // Preview the complete payload (including optional text) without freezing the incident until Send.
  let current = preview;
  try { current = JSON.stringify(submission.report ?? captureDiagnosticReport(submission.description, reader, previewId), null, 2); }
  catch { /* Copying existing diagnostic categories remains available. */ }
  const copy = async (value: string, success: string) => {
    try { await navigator.clipboard.writeText(value); setMessage(success); }
    catch { setMessage("无法自动复制，请选中诊断信息或反馈编号手动复制。"); }
  };
  return <div className="diagnostic-report-form">
    <label htmlFor="diagnostic-description">刚才遇到了什么问题？（选填）</label>
    <textarea id="diagnostic-description" rows={5} maxLength={1000} placeholder="例如：打开乐谱后，翻到第二页时一直显示加载中…" autoComplete="off" value={submission.description}
      readOnly={submission.report !== null} aria-describedby="diagnostic-description-hint"
      onChange={event => setDiagnosticDescription(event.target.value)} />
    <p id="diagnostic-description-hint" className="diagnostic-hint">可以描述操作步骤和看到的现象。请勿填写密码、验证码、邀请码或私人内容。</p>
    <p className="diagnostic-privacy-note">发送时会附带设备与错误信息，帮助排查。不自动上传乐谱、笔记或登录凭据；没有错误记录也可以发送。</p>
    <div className="diagnostics-actions">
      <button className="diagnostic-send" type="button" disabled={submission.phase === "sending" || submission.phase === "sent"}
        onClick={() => { setMessage(""); void sendDiagnosticReport(reader); }}>
        <Send size={16} aria-hidden="true" />
        {submission.phase === "sending" ? "正在发送…" : submission.phase === "sent" ? "已发送" : submission.phase === "failed" ? "重试发送" : "发送反馈"}
      </button>
      {submission.report && submission.phase !== "sending" && <button type="button" onClick={() => { resetDiagnosticSubmission(); setMessage(""); }}>填写另一份反馈</button>}
    </div>
    {submission.phase === "sent" && submission.report && <div className="diagnostic-receipt">
      <CheckCircle2 size={24} aria-hidden="true" /><h3>反馈已收到，谢谢你</h3>
      <p>维护人员会结合诊断信息排查。此页面暂不支持查看处理进度或接收回复。</p>
      <p>反馈编号：<code>{submission.report.id}</code></p>
      <button className="secondary-button" type="button" onClick={() => void copy(submission.report!.id, "已复制反馈编号。")}>复制反馈编号</button>
      <p>如需通过已有渠道联系维护人员，可提供此编号，便于查找。</p>
    </div>}
    <p role="status">{message || submission.message}</p>
    <p className="diagnostic-hint">发送前请保持此页面打开，刷新或关闭网页会清空待发送内容。发送失败可重试，不影响乐谱与本机草稿。</p>
    <details className="support-details diagnostic-details">
      <summary>诊断信息与隐私说明</summary>
      <p>点击“发送反馈”后，问题描述及诊断信息会发送给合谱维护人员，最多保存 {diagnosticReportRetentionDays} 天；维护人员也可提前删除。</p>
      <p>包含最近 30 分钟最多 50 条错误、应用版本、浏览器与系统版本、窗口尺寸和网络/PWA 状态；阅读器内反馈还包含显示方式、编辑状态及待同步/冲突数量。未知信息留空，联网提示不代表服务可达。</p>
      {!reader && <p>新版更新安装器还会提供失败分类。旧版应用更新失败时，可打开<a href="/api/support/update">独立更新诊断</a>检查本机缓存与数据库响应。</p>}
      <label htmlFor="diagnostic-report">可发送给维护人员的诊断信息</label>
      <textarea id="diagnostic-report" readOnly value={current} rows={12} />
      <div className="diagnostics-actions diagnostic-utilities">
      <button type="button" onClick={() => void copy(current, "已复制诊断信息。")}>复制诊断信息</button>
      <button type="button" onClick={() => { clearDiagnostics(); setMessage("已清空本机会话诊断信息，不影响乐谱与草稿，也不会撤回已发送的报告。"); }}>清空诊断信息</button>
      </div>
    </details>

  </div>;
}
