import { useSyncExternalStore } from 'react';

type RecoveryStatus = { phase: 'idle' | 'checking' | 'waiting' | 'offline' | 'reloading'; message: string };
let status: RecoveryStatus = { phase: 'idle', message: '' };
const listeners = new Set<() => void>();
export function setPageRecoveryStatus(next: RecoveryStatus) {
  if (next.phase === status.phase && next.message === status.message) return;
  status = next;
  listeners.forEach(listener => listener());
}
export function usePageRecoveryStatus() {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => status);
}
