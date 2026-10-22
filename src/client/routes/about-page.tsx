import { ReleaseChannelPicker } from "../updates/release-channel-picker";
import { assetUrl } from "../../shared/asset-url";
import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, BookOpen, ChevronRight, MessageSquare, ShieldCheck } from "lucide-react";
import { buildId, buildRunId, buildVersion } from "../../shared/build";
import { TaskHeader } from "../components/task-header";
import { UpdateDetails } from "../components/reload-prompt";
import "../support-pages.css";

export default function AboutPage() {
  const [message, setMessage] = useState("");
  const information = `合谱 ${buildVersion}\n构建：${buildId}${buildRunId ? `\n流水线：${buildRunId}` : ""}`;
  async function copy() {
    try { await navigator.clipboard.writeText(information); setMessage("版本信息已复制。"); }
    catch { setMessage("无法自动复制，请选中下方版本信息手动复制。"); }
  }
  return <div className="app-page support-page"><TaskHeader title="关于合谱" backTo="/drives" />
    <main className="support-shell about-shell">
      <header className="about-identity">
        <img src={assetUrl("icon-192.png")} width="72" height="72" alt="" />
        <div><p className="support-kicker">SAME PAGE</p><h2>合谱</h2></div>
        <p className="about-tagline">同一份乐谱，一起练好每一段。</p>
        <p className="support-muted">合唱乐谱与排练笔记</p>
      </header>
      <UpdateDetails />
      <ReleaseChannelPicker />
      <nav className="support-links" aria-label="帮助与产品信息">
        <Link to="/help"><BookOpen size={20} aria-hidden="true" /><span>使用手册<small>了解看谱、笔记与练习</small></span><ChevronRight size={18} aria-hidden="true" /></Link>
        <Link to="/diagnostics"><MessageSquare size={20} aria-hidden="true" /><span>问题反馈<small>把遇到的问题告诉我们</small></span><ArrowUpRight size={18} aria-hidden="true" /></Link>
        <Link to="/privacy"><ShieldCheck size={20} aria-hidden="true" /><span>隐私政策</span><ChevronRight size={18} aria-hidden="true" /></Link>
      </nav>
      <details className="support-details about-build" open={message.startsWith("无法")}>
        <summary>版本与技术信息</summary>
        <p className="support-muted">当前设备运行 {buildVersion}，版本时间采用北京时间。</p>
        <pre>{information}</pre>
        <button className="support-text-button" onClick={() => void copy()}>复制版本信息</button>
        {message && <p role="status">{message}</p>}
      </details>
    </main>
  </div>;
}
