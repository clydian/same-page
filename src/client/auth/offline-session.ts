import { localDatabase } from '../platform/local-database';
import { publishedQuestionFiles } from '../platform/published-question-files';

const key = 'auth:offline-session';
type OfflineSession = { userId: string; sessionId: string; expiresAt: number };

export function readOfflineSession() {
  return localDatabase.system.get(key).then(row => {
    if (!row) return null;
    try {
      const value: OfflineSession = JSON.parse(row.value);
      return typeof value.userId === 'string' && typeof value.sessionId === 'string' && Number.isFinite(value.expiresAt) ? value : null;
    } catch { return null; }
  });
}

// Called inside the logout-fence transaction. Keep only the session identity
// and its server expiry, never cookie, token or user profile data.
export async function rememberOfflineSession(next: OfflineSession | null) {
  const previous = await readOfflineSession();
  if (previous && (!next || previous.userId !== next.userId || previous.sessionId !== next.sessionId || previous.expiresAt <= Date.now())) {
    await publishedQuestionFiles(`user:${previous.userId}`).delete();
  }
  if (!next) await localDatabase.system.delete(key);
  else if (!previous || previous.userId !== next.userId || previous.sessionId !== next.sessionId || previous.expiresAt !== next.expiresAt) {
    await localDatabase.system.put({ key, value: JSON.stringify(next) });
  }
}
