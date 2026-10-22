import { TaskHeader } from "../components/task-header";
import { DiagnosticReportForm } from "./diagnostic-report-form";

export default function DiagnosticsPage() {
  return <div className="app-page support-page">
    <TaskHeader title="问题反馈" backTo="/help" />
    <main className="support-shell feedback-shell">

      <header className="support-intro"><p className="support-kicker">我们在这里倾听</p><h2>哪里不太顺利？</h2><p>看谱、记笔记或练习时遇到的问题，都可以告诉我们。</p></header>
      <DiagnosticReportForm />
      <details className="support-details diagnostic-help"><summary>常见问题恢复建议</summary><p>网络故障请连接网络后重试；权限拒绝请重新登录或联系云盘拥有者；笔记冲突请在阅读器处理。不要为排障清除站点数据，以免丢失未同步草稿。</p></details>

    </main>
  </div>;
}
