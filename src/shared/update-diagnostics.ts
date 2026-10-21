// Historical total ceiling is retained only to read already-sent diagnostics.
export const applicationShellBudgetBytes = 4 * 7 * 1024 * 1024;
export const applicationShellReleaseLimitBytes = 7 * 1024 * 1024;
export const updateFailureReasons = ["release-too-large", "capacity-protected", "quota-exceeded", "integrity-mismatch", "download-timeout", "download-failed", "storage-failed", "unknown"] as const;

export function updateFailureReason(error: unknown): typeof updateFailureReasons[number] {
  const name = error && typeof error === "object" && "name" in error ? error.name : null;
  const message = error instanceof Error ? error.message : null;
  if (message === "shell_release_too_large") return "release-too-large";
  if (message === "shell_capacity_protected") return "capacity-protected";
  if (name === "QuotaExceededError") return "quota-exceeded";
  if (message === "shell_integrity_mismatch" || message === "shell_version_mismatch") return "integrity-mismatch";
  if (name === "TimeoutError") return "download-timeout";
  if (name === "TypeError") return "download-failed";
  if (["UnknownError", "InvalidStateError", "SecurityError"].includes(String(name))) return "storage-failed";
  return "unknown";
}
