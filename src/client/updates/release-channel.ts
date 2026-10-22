import { useSyncExternalStore } from "react";
import { releaseTargetSchema, type ReleaseTarget, type ReleaseChannel } from "../../shared/release-channels";
import { holdUpdate } from "./update-safety";
const key = "same-page-release-intent-v1";
let state: { target: ReleaseTarget | null; busy: boolean; error: string } = { target: null, busy: false, error: "" };
const listeners = new Set<() => void>();
function update(patch: Partial<typeof state>) { state = { ...state, ...patch }; listeners.forEach(fn => fn()); }
export function useReleaseChannel() { return useSyncExternalStore(fn => { listeners.add(fn); return () => { listeners.delete(fn); }; }, () => state); }
export async function refreshReleaseChannel() {
  const response = await fetch("/api/client-release", { credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error("发布通道暂不可用，请联网后重试。");
  const target = releaseTargetSchema.parse(await response.json());
  update({ target, error: "" });
  return target;
}
export async function selectReleaseChannel(channel: ReleaseChannel) {
  if (!navigator.locks || !navigator.onLine) { update({ error: "请联网并在支持安全切换的浏览器中重试。" }); return; }
  update({ busy: true, error: "" });
  const release = holdUpdate();
  try {
    await navigator.locks.request("same-page-release-selection", async () => {
      const intent = crypto.randomUUID();
      localStorage.setItem(key, JSON.stringify({ pending: { channel, intent } }));
      const response = await fetch("/api/client-release", { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ channel, intent }), signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error("无法保存通道选择，请重试。");
      const target = await refreshReleaseChannel();
      if (target.channel !== channel || target.intent !== intent) throw new Error("通道选择尚未确认，请重试。");
      localStorage.setItem(key, JSON.stringify({ confirmed: target }));
      window.dispatchEvent(new Event("same-page-check-update"));
    });
  } catch (error) { update({ error: error instanceof Error ? error.message : "切换未完成，当前版本继续运行。" }); }
  finally { release(); update({ busy: false }); }
}

export function releaseChannelDiagnostics() { return state.target ? { channel: state.target.channel, target: state.target.target, backend: state.target.backend } : null; }
