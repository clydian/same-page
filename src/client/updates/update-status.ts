import { useSyncExternalStore } from "react";
let status = { message: "后台检查更新，当前版本继续运行", ready: false, applying: false };
const listeners = new Set<() => void>();
export function setUpdateStatus(message: string, change: Partial<Omit<typeof status, "message">> = {}) {
  status = { ...status, ...change, message }; listeners.forEach(listener => listener());
}
export function useUpdateStatus() {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => status);
}
