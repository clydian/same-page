import { useSyncExternalStore } from "react";

export type UpdatePhase = "registering" | "checking" | "preparing" | "current" | "ready" | "applying" | "error" | "offline" | "unsupported";
export interface UpdateStatus {
  phase: UpdatePhase;
  message: string;
  deferred?: { worker: ServiceWorker; since: number };
}
let status: UpdateStatus = { phase: "registering", message: "正在准备更新检查…" };
const listeners = new Set<() => void>();
export function setUpdateStatus(next: UpdateStatus) {
  status = next;
  listeners.forEach(listener => listener());
}
export function useUpdateStatus() {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => status);
}
