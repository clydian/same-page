import { useEffect } from "react";
import { buildId } from "../../shared/build";
import { refreshReleaseChannel, selectReleaseChannel, useReleaseChannel } from "./release-channel";
export function ReleaseChannelPicker() {
  const state = useReleaseChannel();
  useEffect(() => { void refreshReleaseChannel().catch(() => undefined); }, []);
  if (!state.target) return null;
  return <section className="support-update" aria-labelledby="release-channel-heading">
    <h2 id="release-channel-heading">发布通道</h2>
    <label>此浏览器使用 <select aria-label="发布通道" disabled={state.busy} value={state.target.channel} onChange={e => void selectReleaseChannel(e.target.value === "beta" ? "beta" : "stable")}>
      <option value="stable">稳定版（默认）</option><option value="beta">测试版</option>
    </select></label>
    <p>测试版可能不稳定，仍使用真实云端数据。选择仅保存在此浏览器，不同步到其他设备。</p>
    <p>当前运行 <code>{buildId.slice(0, 7)}</code> · 目标 <code>{state.target.target.slice(0, 7)}</code>{state.target.target !== buildId ? "，将在安全时机切换。" : ""}</p>
    {state.error && <p role="alert">{state.error}</p>}
  </section>;
}
export function ReleaseChannelBadge() {
  const state = useReleaseChannel();
  useEffect(() => {
    const check = () => { void refreshReleaseChannel().catch(() => undefined); };
    check(); window.addEventListener("storage", check); window.addEventListener("online", check); window.addEventListener("focus", check);
    return () => { window.removeEventListener("storage", check); window.removeEventListener("online", check); window.removeEventListener("focus", check); };
  }, []);
  return state.target?.channel === "beta" ? <span className="release-channel-badge" title="测试通道，仍使用真实数据">测试版</span> : null;
}
