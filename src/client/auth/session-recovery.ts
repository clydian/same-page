import { useEffect, useRef } from "react";
import { authClient } from "./auth-client";
import type { OnlineIdentityState } from "./application-identity";

let recovery: Promise<void> | null = null;
// Manual actions and the foreground recovery loop share a single attempt. Auth
// mutations still go through Better Auth and the transport generation fence.
export function recoverSession(): Promise<void> {
  if (recovery) return recovery;
  const session = authClient.$store.atoms.session.get();
  if (session.isRefetching) return Promise.resolve();
  recovery = Promise.resolve(session.refetch()).then(() => undefined).finally(() => { recovery = null; });
  return recovery;
}

const delays = [2_000, 5_000, 15_000];
export function useSessionRecovery(onlineState: OnlineIdentityState, isRefetching: boolean, status?: number) {
  const attempts = useRef(0);
  // Network errors lack an HTTP status. Do not retry permission/validation or
  // local acceptance errors. A successful settled check starts a new episode.
  const transient = onlineState === "unreachable" && (!status || status >= 500);
  useEffect(() => {
    if (isRefetching) return;
    if (onlineState === "authenticated" || onlineState === "signed-out" || onlineState === "local-unavailable") attempts.current = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      clearTimeout(timer);
      if (!transient || !navigator.onLine || document.visibilityState !== "visible" || attempts.current >= delays.length) return;
      timer = setTimeout(() => {
        attempts.current++;
        void recoverSession().catch(() => undefined);
      }, delays[attempts.current]);
    };
    const resume = () => {
      if (onlineState === "authenticated" && navigator.onLine && document.visibilityState === "visible") void recoverSession().catch(() => undefined);
      else schedule();
    };
    schedule();
    window.addEventListener("online", resume);
    window.addEventListener("offline", schedule);
    document.addEventListener("visibilitychange", resume);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("online", resume);
      window.removeEventListener("offline", schedule);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [onlineState, transient, isRefetching]);
}
