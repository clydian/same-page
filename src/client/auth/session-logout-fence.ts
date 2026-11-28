import { diagnosticScope, diagnosticErrorType } from "../diagnostics/diagnostics";
import { acceptNewSession, forgetOfflineSession } from "./logout-fence";

export class LocalSessionUnavailableError extends Error {
  constructor(cause: unknown) { super("local_session_unavailable", { cause }); this.name = "LocalSessionUnavailableError"; }
}

export async function acceptSession(response: Response, requestedAt: number) {
  const record = diagnosticScope();
  if (response.ok) {
    const body = await response.clone().json().catch(() => undefined);
    if (body?.user?.id && body?.session?.id) {
      try {
        if (!await acceptNewSession(body.user.id, body.session.id, requestedAt, Date.parse(body.session.expiresAt))) return Response.json(null);
      } catch (error) {
        record({ operation: "auth", category: "internal", stage: "prepare", errorType: diagnosticErrorType(error) });
        throw new LocalSessionUnavailableError(error);
      }
    } else if (body === null) {
      await forgetOfflineSession().catch(() => undefined);
    }
  } else if (response.status === 401 || response.status === 403) {
    await forgetOfflineSession().catch(() => undefined);
  }
  return response.clone();
}
