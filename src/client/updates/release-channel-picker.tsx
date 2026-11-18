import { useMessages } from "../../i18n";
import { useEffect } from "react";
import { refreshReleaseChannel, selectReleaseChannel, useReleaseChannel } from "./release-channel";
import { useUpdateStatus } from "./update-status";
declare const __SAME_PAGE_RELEASE_CHANNELS__: boolean;
const enabled = () => typeof __SAME_PAGE_RELEASE_CHANNELS__ === "boolean" && __SAME_PAGE_RELEASE_CHANNELS__;
export function ReleaseChannelPicker() {
  const t = useMessages("system");
  const state = useReleaseChannel();
  const status = useUpdateStatus();
  const busy = state.busy || ["registering", "checking", "preparing", "applying"].includes(status.phase);
  useEffect(() => { if (enabled()) void refreshReleaseChannel().catch(() => undefined); }, []);
  if (!enabled()) return null;
  return <div className="release-channel-picker">
    <div className="release-channel-label"><h3 id="release-channel-heading">{t("releaseChannelPicker.title")}</h3><span>{t("releaseChannelPicker.browserOnly")}</span></div>
    <div className="release-channel-options" role="group" aria-labelledby="release-channel-heading">
      <button type="button" aria-pressed={state.target?.channel === "stable"} disabled={busy || !state.target}
        onClick={() => { if (state.target?.channel !== "stable") void selectReleaseChannel("stable"); }}>
        <span>{t("releaseChannelPicker.stable")}</span><small>{t("releaseChannelPicker.recommended")}</small>
      </button>
      <button type="button" aria-pressed={state.target?.channel === "beta"} disabled={busy || !state.target}
        onClick={() => { if (state.target?.channel !== "beta") void selectReleaseChannel("beta"); }}>
        <span>{t("releaseChannelPicker.beta")}</span><small>{t("releaseChannelPicker.earlyAccess")}</small>
      </button>
    </div>
    <p className="release-channel-note">{t("releaseChannelPicker.switchHelp")}</p>
    {(state.target?.channel === "beta" || state.runningChannel === "beta") && <p className="release-channel-caution">{t("releaseChannelPicker.betaCaution")}</p>}
    {state.error && <div className="release-channel-error"><p role="alert">{state.error}</p>
      <button type="button" className="support-text-button" disabled={state.busy} onClick={() => void refreshReleaseChannel().catch(() => undefined)}>{t("releaseChannelPicker.retry")}</button>
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
