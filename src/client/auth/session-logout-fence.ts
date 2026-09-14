import { diagnosticScope, diagnosticErrorType } from "../diagnostics/diagnostics";
import { acceptNewSession } from "./logout-fence";

export class LocalSessionUnavailableError extends Error {
  constructor(cause: unknown) { super("local_session_unavailable", { cause }); this.name = "LocalSessionUnavailableError"; }
}

export async function acceptSession(response: Response, requestedAt: number) {
  const record = diagnosticScope();
  if (response.ok) {
    const body = await response.clone().json().catch(() => null);
    if (body?.user?.id && body?.session?.id) {
      try {
        if (!await acceptNewSession(body.user.id, body.session.id, requestedAt)) return Response.json(null);
      } catch (error) {
        record({ operation: "auth", category: "internal", stage: "prepare", errorType: diagnosticErrorType(error) });
        throw new LocalSessionUnavailableError(error);
      }
    }
  }
  return response.clone();
}
