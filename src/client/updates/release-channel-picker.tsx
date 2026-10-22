import { useEffect } from "react";
import { refreshReleaseChannel, selectReleaseChannel, useReleaseChannel } from "./release-channel";
import { useUpdateStatus } from "./update-status";
declare const __SAME_PAGE_RELEASE_CHANNELS__: boolean;
const enabled = () => typeof __SAME_PAGE_RELEASE_CHANNELS__ === "boolean" && __SAME_PAGE_RELEASE_CHANNELS__;
export function ReleaseChannelPicker() {
  const state = useReleaseChannel();
  const status = useUpdateStatus();
  const busy = state.busy || ["registering", "checking", "preparing", "applying"].includes(status.phase);
  useEffect(() => { if (enabled()) void refreshReleaseChannel().catch(() => undefined); }, []);
  if (!enabled()) return null;
  return <div className="release-channel-picker">
    <div className="release-channel-label"><h3 id="release-channel-heading">更新通道</h3><span>仅此浏览器</span></div>
    <div className="release-channel-options" role="group" aria-labelledby="release-channel-heading">
      <button type="button" aria-pressed={state.target?.channel === "stable"} disabled={busy || !state.target}
        onClick={() => { if (state.target?.channel !== "stable") void selectReleaseChannel("stable"); }}>
        <span>稳定版</span><small>日常推荐</small>
      </button>
      <button type="button" aria-pressed={state.target?.channel === "beta"} disabled={busy || !state.target}
        onClick={() => { if (state.target?.channel !== "beta") void selectReleaseChannel("beta"); }}>
        <span>测试版</span><small>提前体验</small>
      </button>
    </div>
    <p className="release-channel-note">切换会保留笔记与离线内容，选择不同步到其他设备。</p>
    {(state.target?.channel === "beta" || state.runningChannel === "beta") && <p className="release-channel-caution">测试版可能不稳定，仍使用真实云端数据。</p>}
    {state.error && <div className="release-channel-error"><p role="alert">{state.error}</p>
      <button type="button" className="support-text-button" disabled={state.busy} onClick={() => void refreshReleaseChannel().catch(() => undefined)}>重试版本信息</button>
    </div>}
  </div>;
}
// Keep cross-window and foreground authority readback without a global visual label.
export function ReleaseChannelMonitor() {
  useEffect(() => {
    if (!enabled()) return;
    const check = () => { void refreshReleaseChannel().catch(() => undefined); };
    check(); window.addEventListener("storage", check); window.addEventListener("online", check); window.addEventListener("focus", check);
    return () => { window.removeEventListener("storage", check); window.removeEventListener("online", check); window.removeEventListener("focus", check); };
  }, []);
  return null;
}
