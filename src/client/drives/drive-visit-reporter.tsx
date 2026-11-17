import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { VISIT_INTERVAL_MS } from "../../shared/drive-usage";
import { useApplicationIdentity } from "../auth/application-identity";
import { connectionFetch } from "../connection/connection";
import { useNetworkStatus } from "../platform/use-network-status";

// There is no heartbeat timer, durable queue or offline replay. A server receipt
// means a foreground route entry/resume or trusted input, not time spent reading.
export function DriveVisitReporter() {
  const { pathname, search } = useLocation();
  const choirId = /^\/choirs\/([^/]+)(?:\/scores\/[^/]+)?$/.exec(pathname)?.[1];
  if (new URLSearchParams(search).get("experience") === "1") return null;
  return choirId ? <ForegroundVisits choirId={choirId} pathname={pathname} /> : null;
}

function ForegroundVisits({ choirId, pathname }: { choirId: string; pathname: string }) {
  const identity = useApplicationIdentity();
  const online = useNetworkStatus();
  const userId = identity.authenticatedUserId;
  const sessionId = identity.authenticatedSessionId;
  useEffect(() => {
    if (!userId || !sessionId || !online) return;
    const controller = new AbortController();
    let lastAttempt = -Infinity;
    const report = () => {
      if (document.visibilityState !== "visible" || !navigator.onLine || Date.now() - lastAttempt < VISIT_INTERVAL_MS) return;
      lastAttempt = Date.now();
      void connectionFetch(`/api/choirs/${encodeURIComponent(choirId)}/visits`, {
        method: "POST", credentials: "same-origin", cache: "no-store", signal: controller.signal,
        headers: { "x-same-page-owner-user-id": userId, "x-same-page-visit": "foreground" },
      }).catch(() => { /* Optional usage metadata never blocks access or queues a retry. */ });
    };
    const interact = (event: Event) => { if (event.isTrusted) report(); };
    report();
    document.addEventListener("visibilitychange", report);
    window.addEventListener("pageshow", report);
    window.addEventListener("pointerdown", interact, { passive: true });
    window.addEventListener("keydown", interact);
    return () => {
      controller.abort();
      document.removeEventListener("visibilitychange", report);
      window.removeEventListener("pageshow", report);
      window.removeEventListener("pointerdown", interact);
      window.removeEventListener("keydown", interact);
    };
  }, [choirId, pathname, userId, sessionId, online]);
  return null;
}
