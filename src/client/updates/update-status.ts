import type { InstallProgress } from '../../shared/update-progress';

export type UpdatePhase = "registering" | "checking" | "preparing" | "current" | "ready" | "applying" | "error" | "offline" | "unsupported";
export interface UpdateStatus {
  phase: UpdatePhase;
  message: string;
  messageKey?: string;
  initialInstall?: boolean;
  progress?: InstallProgress;
  deferred?: { worker: ServiceWorker; since: number };
}
let status: UpdateStatus = { phase: "registering", message: "", messageKey: "updateController.registering" };
const listeners = new Set<() => void>();
export function setUpdateStatus(next: UpdateStatus) {
  status = next;
  listeners.forEach(listener => listener());
}
export function subscribeUpdateStatus(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function readUpdateStatus() {
  return status;
}
