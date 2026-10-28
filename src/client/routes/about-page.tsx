import { assetUrl } from "../../shared/asset-url";
import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { ArrowUpRight, BookOpen, ChevronRight, Globe, MessageSquare, ShieldCheck } from "lucide-react";
import { buildId, buildRunId, buildVersion } from "../../shared/build";
import { TaskHeader } from "../components/task-header";
import { UpdateDetails } from "../components/reload-prompt";
import { usePageRecoveryStatus } from "../updates/page-recovery-status";
import "../support-pages.css";

export default function AboutPage() {
  const { state } = useLocation();
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
      {state?.recoverPlayer === true && <PlaybackRecovery />}
      <UpdateDetails />
      <nav className="support-links" aria-label="帮助与产品信息">
        <Link to="/" state={{ home: true }}><Globe size={20} aria-hidden="true" /><span>产品介绍<small>了解合谱与排练功能</small></span><ChevronRight size={18} aria-hidden="true" /></Link>
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

function PlaybackRecovery() {
  const [requested, setRequested] = useState(false);
  const status = usePageRecoveryStatus();
  return <section className="support-update app-version-panel" aria-labelledby="playback-recovery-heading">
    <h2 id="playback-recovery-heading">恢复播放器</h2>
    <p>本机资源完整时可离线重新加载；资源缺失时需要联网补齐。笔记和本机内容会保留。</p>
    <button className="primary-button" type="button" disabled={requested && status.phase !== 'offline'} onClick={() => {
      setRequested(true);
      window.dispatchEvent(new Event('same-page-recover-page'));
    }}>重新加载页面</button>
    {requested && <p role="status">{status.message}</p>}
  </section>;
}
