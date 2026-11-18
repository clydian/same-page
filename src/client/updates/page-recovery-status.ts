import { useMemo, useSyncExternalStore } from 'react';
import { useMessages } from '../../i18n';

type RecoveryStatus = { phase: 'idle' | 'checking' | 'waiting' | 'offline' | 'reloading'; message: string; messageKey?: string };
let status: RecoveryStatus = { phase: 'idle', message: '' };
const listeners = new Set<() => void>();
export function setPageRecoveryStatus(next: RecoveryStatus) {
  if (next.phase === status.phase && next.message === status.message && next.messageKey === status.messageKey) return;
  status = next;
  listeners.forEach(listener => listener());
}
export function usePageRecoveryStatus() {
  const current = useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => status);
  const t = useMessages("system");
  return useMemo(() => current.messageKey ? { ...current, message: t(current.messageKey) } : current, [current, t]);
}
