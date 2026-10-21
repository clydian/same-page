import { updateDiagnosticsSchema, type DiagnosticReport } from "../../shared/diagnostic-report";
import { diagnosticScope, subscribeDiagnosticReset } from "../diagnostics/diagnostics";

let failure: NonNullable<NonNullable<DiagnosticReport["update"]>["failure"]> | null = null;
let capturedAt = 0;
subscribeDiagnosticReset(() => { failure = null; });

export function rememberUpdateFailure(value: { reason?: unknown; buildId?: unknown }) {
  const parsed = updateDiagnosticsSchema.shape.failure.safeParse({ reason: value.reason, buildId: value.buildId });
  if (!parsed.success || !parsed.data) return;
  failure = parsed.data;
  capturedAt = Date.now();
  const storage = ["capacity-protected", "quota-exceeded", "storage-failed"].includes(failure.reason);
  const network = ["download-failed", "download-timeout"].includes(failure.reason);
  diagnosticScope()({ operation: storage ? "storage" : "other", category: network ? "network" : "internal", stage: "prepare",
    ...(failure.reason === "quota-exceeded" ? { errorType: "QuotaExceededError" as const } : failure.reason === "download-timeout" ? { errorType: "TimeoutError" as const } : {}) });
}
export function currentUpdateFailure() { return failure && Date.now() - capturedAt < 30 * 60_000 ? { ...failure } : null; }
