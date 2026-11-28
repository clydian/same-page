import { localDatabase } from "../platform/local-database";
import { rememberOfflineSession } from "./offline-session";
const key = "auth:explicit-logout";
export type LogoutFence = { userId: string; sessionId: string | null; pending: boolean; completedAt?: number };
export function readLogoutFence() {
  return localDatabase.system.get(key).then(record => record ? JSON.parse(record.value) as LogoutFence : null);
}
export async function beginLogout(userId: string, sessionId: string | null) {
  await localDatabase.system.put({ key, value: JSON.stringify({ userId, sessionId, pending: true } satisfies LogoutFence) });
}
export async function completeLogout() {
  await localDatabase.transaction("rw", localDatabase.system, async () => {
    const fence = await readLogoutFence();
    if (fence) await localDatabase.system.put({ key, value: JSON.stringify({ ...fence, pending: false, completedAt: Date.now() }) });
  });
}
export async function cancelLogout() { await localDatabase.system.delete(key); }
export async function acceptNewSession(userId: string, sessionId: string, requestedAt = 0, expiresAt?: number) {
  return localDatabase.transaction("rw", localDatabase.system, async () => {
    const fence = await readLogoutFence();
    if (fence) {
      if (fence.pending) return false;
      if (fence.userId === userId && (fence.sessionId === sessionId || (!fence.sessionId && requestedAt <= (fence.completedAt ?? Infinity)))) return false;
      await cancelLogout();
    }
    if (expiresAt !== undefined && Number.isFinite(expiresAt)) await rememberOfflineSession({ userId, sessionId, expiresAt });
    return true;
  });
}

export async function forgetOfflineSession() {
  await localDatabase.transaction("rw", localDatabase.system, () => rememberOfflineSession(null));
}
