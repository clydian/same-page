import { LocalSessionUnavailableError } from "./session-logout-fence";
import { recoverSession } from "./session-recovery";
import { useLayoutEffect, useRef, useState } from "react";
import { revokeOfflinePreparationIdentity } from "../offline/offline-score";
import { readLogoutFence } from "./logout-fence";
import { useLiveQuery } from "dexie-react-hooks";
import { authClient } from "./auth-client";
import { currentLocalOwnerKey } from "../platform/local-workspace";

export type OnlineIdentityState = "checking" | "authenticated" | "signed-out" | "unreachable" | "local-unavailable";

// Local ownership is a navigation/editing boundary, never proof of a cloud session.
export function useApplicationIdentity() {
  const remoteSession = authClient.useSession();
  const fence = useLiveQuery(readLogoutFence);
  const blocked = fence && fence.userId === remoteSession.data?.user.id;
  const session = blocked && !fence!.pending ? { ...remoteSession, data: null } : remoteSession;
  const rememberedOwner = useLiveQuery(() => currentLocalOwnerKey().catch(() => null));
  const onlineState: OnlineIdentityState = session.isPending ? "checking"
    : session.error ? (session.error instanceof LocalSessionUnavailableError ? "local-unavailable" : session.error.status === 401 ? "signed-out" : "unreachable") : session.data?.user ? "authenticated" : "signed-out";
  const confirmedUserId = !blocked && onlineState === "authenticated" ? session.data!.user.id : null;
  const sessionId = session.data?.session?.id;
  const previousIdentity = useRef({ userId: confirmedUserId, sessionId });
  useLayoutEffect(() => {
    if (previousIdentity.current.userId && (previousIdentity.current.userId !== confirmedUserId || previousIdentity.current.sessionId !== sessionId)) revokeOfflinePreparationIdentity(previousIdentity.current.userId);
    previousIdentity.current = { userId: confirmedUserId, sessionId };
  }, [confirmedUserId, sessionId]);
  const observedLocalUserId = session.data?.user.id ?? (rememberedOwner?.startsWith("user:") ? rememberedOwner.slice(5) : null);
  const [previousLocalUserId, setPreviousLocalUserId] = useState(observedLocalUserId);
  // A pending IndexedDB read cannot erase an already displayed user while the
  // cloud session is temporarily unavailable. A resolved owner remains decisive.
  const localUserId = observedLocalUserId ?? (rememberedOwner === undefined ? previousLocalUserId : null);
  if (previousLocalUserId !== localUserId) setPreviousLocalUserId(localUserId);
  return {
    session: { ...session, refetch: recoverSession }, onlineState, localUserId,
    authenticatedUserId: confirmedUserId,
    authenticatedSessionId: confirmedUserId ? sessionId ?? null : null,
    restoring: !localUserId && rememberedOwner === undefined,
    showLocalEntry: onlineState !== "authenticated" && (Boolean(localUserId) || rememberedOwner === undefined || onlineState !== "signed-out"),
  };
}
export type ApplicationIdentity = ReturnType<typeof useApplicationIdentity>;

// Settings keep the local user's view while cloud identity is checked.
export function useSettingsIdentity() {
  const identity = useApplicationIdentity();
  return { userId: identity.localUserId,
    ready: !identity.restoring && (identity.onlineState === "authenticated" || identity.onlineState === "signed-out") };
}
