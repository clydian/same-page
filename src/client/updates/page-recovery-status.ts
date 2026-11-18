type RecoveryStatus = { phase: 'idle' | 'checking' | 'waiting' | 'offline' | 'reloading'; message: string; messageKey?: string };
let status: RecoveryStatus = { phase: 'idle', message: '' };
const listeners = new Set<() => void>();
export function setPageRecoveryStatus(next: RecoveryStatus) {
  if (next.phase === status.phase && next.message === status.message && next.messageKey === status.messageKey) return;
  status = next;
  listeners.forEach(listener => listener());
}
export function subscribePageRecoveryStatus(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function readPageRecoveryStatus() {
  return status;
}
