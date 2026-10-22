import { useSyncExternalStore } from "react";
import { buildId } from "../../shared/build";
import { releaseTargetSchema, type ReleaseTarget, type ReleaseChannel } from "../../shared/release-channels";
import { readReleaseReceipt, writeReleaseReceipt, releaseSelectionLock } from "../../shared/release-receipt";
import { holdUpdate } from "./update-safety";
let state: { target: ReleaseTarget | null; runningChannel: ReleaseChannel | null; busy: boolean; error: string } = { target: null, runningChannel: null, busy: false, error: "" };
const listeners = new Set<() => void>();
function update(patch: Partial<typeof state>) { state = { ...state, ...patch }; listeners.forEach(fn => fn()); }
export function useReleaseChannel() { return useSyncExternalStore(fn => { listeners.add(fn); return () => { listeners.delete(fn); }; }, () => state); }
async function reconcileSelection() {
  const receipt = await readReleaseReceipt(location.origin);
  // The permitted running build can be identified offline; selection authority stays online.
  update({ runningChannel: receipt.permitted?.target === buildId ? receipt.permitted.channel : null });
  const response = await fetch("/api/client-release", { credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error("发布通道暂不可用，请联网后重试。");
  const target = releaseTargetSchema.parse(await response.json());
  // Handles a crash before POST, lost POST response and crash before confirmation.
  // Never restores a beta Cookie from local metadata; online readback is authoritative.
  await writeReleaseReceipt(location.origin, { confirmed: target, ...(receipt.permitted ? { permitted: receipt.permitted } : {}) });
  update({ target, runningChannel: receipt.permitted?.target === buildId ? receipt.permitted.channel : target.target === buildId ? target.channel : null, error: "" });
  return target;
}
export async function refreshReleaseChannel() {
  return navigator.locks ? navigator.locks.request(releaseSelectionLock, reconcileSelection) : reconcileSelection();
}
export async function selectReleaseChannel(channel: ReleaseChannel) {
  if (!navigator.locks || !navigator.onLine) { update({ error: "请联网并在支持安全切换的浏览器中重试。" }); return; }
  update({ busy: true, error: "" });
  const release = holdUpdate();
  try {
    await navigator.locks.request(releaseSelectionLock, async () => {
      const intent = crypto.randomUUID(), receipt = await readReleaseReceipt(location.origin);
      await writeReleaseReceipt(location.origin, { ...receipt, pending: { channel, intent } });
      const response = await fetch("/api/client-release", { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ channel, intent }), signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error("无法保存通道选择，请重试。");
      const target = await reconcileSelection();
      if (target.channel !== channel || target.intent !== intent) throw new Error("通道选择尚未确认，请重试。");
      window.dispatchEvent(new Event("same-page-check-update"));
    });
  } catch (error) { update({ error: error instanceof Error ? error.message : "切换未完成，当前版本继续运行。" }); }
  finally { release(); update({ busy: false }); }
}
export function releaseChannelDiagnostics() { return state.target ? { channel: state.target.channel, target: state.target.target, backend: state.target.backend } : null; }
