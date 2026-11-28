import { diagnosticScope, diagnosticErrorType } from "../diagnostics/diagnostics";
import { acceptNewSession } from "./logout-fence";
import { storeOfflineSession } from "./offline-session";

export class LocalSessionUnavailableError extends Error {
  constructor(cause: unknown) { super("local_session_unavailable", { cause }); this.name = "LocalSessionUnavailableError"; }
}

export async function acceptSession(response: Response, requestedAt: number) {
  const record = diagnosticScope();
  if (response.ok) {
    const body = await response.clone().json().catch(() => undefined);
    if (body?.user?.id && body?.session?.id) {
      try {
        if (!await acceptNewSession(body.user.id, body.session.id, requestedAt)) return Response.json(null);
      } catch (error) {
        record({ operation: "auth", category: "internal", stage: "prepare", errorType: diagnosticErrorType(error) });
        throw new LocalSessionUnavailableError(error);
      }
      const expiresAt = Date.parse(body.session.expiresAt);
      if (Number.isFinite(expiresAt)) await storeOfflineSession({ userId: body.user.id, sessionId: body.session.id, expiresAt }).catch(() => undefined);
    } else if (body === null) {
      await storeOfflineSession(null).catch(() => undefined);
    }
  } else if (response.status === 401 || response.status === 403) {
    await storeOfflineSession(null).catch(() => undefined);
  }
  return response.clone();
}
