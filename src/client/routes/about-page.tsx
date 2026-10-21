import { useState } from "react";
import { buildId, buildRunId, buildVersion } from "../../shared/build";
import { TaskHeader } from "../components/task-header";
import { UpdateDetails } from "../components/reload-prompt";
export default function AboutPage() {
  const [message, setMessage] = useState("");
  const information = `合谱 ${buildVersion}\n构建：${buildId}${buildRunId ? `\n流水线：${buildRunId}` : ""}`;
  async function copy() {
    try { await navigator.clipboard.writeText(information); setMessage("版本信息已复制。"); }
    catch { setMessage("无法自动复制，请选中下方版本信息手动复制。"); }
  }
  return <div className="app-page"><TaskHeader title="关于与更新" backTo="/drives" /><main className="page-shell compact-page">
    <p>合唱乐谱与排练笔记</p><h2 className="about-version">{buildVersion}</h2>
    <p>这是当前设备正在运行的版本，版本时间采用北京时间。</p>
    <button className="secondary-button" onClick={() => void copy()}>复制版本信息</button>
    {message && <p role="status">{message}</p>}
    <UpdateDetails /><details className="about-build" open={message.startsWith("无法")}><summary>技术详情</summary><pre>{information}</pre></details>
  </main></div>;
}
