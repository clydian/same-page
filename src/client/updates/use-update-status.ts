import { useMemo, useSyncExternalStore } from "react";
import { useMessages } from "../../i18n";
import { readPageRecoveryStatus, subscribePageRecoveryStatus } from "./page-recovery-status";
import { readUpdateStatus, subscribeUpdateStatus } from "./update-status";

export function useUpdateStatus() {
  const current = useSyncExternalStore(subscribeUpdateStatus, readUpdateStatus);
  const t = useMessages("system");
  return useMemo(() => current.messageKey ? { ...current, message: t(current.messageKey) } : current, [current, t]);
}

export function usePageRecoveryStatus() {
  const current = useSyncExternalStore(subscribePageRecoveryStatus, readPageRecoveryStatus);
  const t = useMessages("system");
  return useMemo(() => current.messageKey ? { ...current, message: t(current.messageKey) } : current, [current, t]);
}
