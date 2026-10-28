import { expect, it } from "vitest";
import { applicationShellReleaseLimitBytes, updateFailureReason } from "./update-diagnostics";
import { updateDiagnosticsSchema } from "./diagnostic-report";

it("distinguishes the application retention budget from browser storage quota and network failures", () => {
  expect(updateFailureReason(new Error("shell_capacity_protected"))).toBe("capacity-protected");
  expect(updateFailureReason(new DOMException("private details", "QuotaExceededError"))).toBe("quota-exceeded");
  expect(updateFailureReason(new Error("shell_integrity_mismatch"))).toBe("integrity-mismatch");
  expect(updateFailureReason(new Error("public_asset_integrity"))).toBe("integrity-mismatch");
  expect(updateFailureReason(new Error("public_asset_unavailable"))).toBe("download-failed");
  expect(updateFailureReason(new DOMException("private details", "TimeoutError"))).toBe("download-timeout");
  expect(updateFailureReason(new TypeError("private URL"))).toBe("download-failed");
  expect(updateFailureReason(new Error("private details"))).toBe("unknown");
});

it("accepts a bounded observation without allowing cache names, URLs or database records", () => {
  const value = { serverBuild: "abcdef1", registration: "ok", activeBuild: "abcdef0", waitingBuild: null, installingState: null,
    cacheStatus: "ok", shellCount: 4, shellBytes: 26400000, shellBudgetBytes: 29360128, shellsTruncated: false,
    shells: [{ buildId: "abcdef0", bytes: 6600000, complete: true, ageHours: 2 }],
    storage: { status: "ok", usage: 80000000, quota: 200000000 }, database: { status: "timeout", version: null },
    failure: { reason: "capacity-protected", buildId: "abcdef1" } };
  expect(updateDiagnosticsSchema.safeParse(value).success).toBe(true);
  expect(updateDiagnosticsSchema.safeParse({ ...value, shellBudgetBytes: null, shellPolicy: "references-v2", shellReleaseLimitBytes: applicationShellReleaseLimitBytes }).success).toBe(true);
  expect(updateDiagnosticsSchema.safeParse({ ...value, shellBudgetBytes: 112 * 1024 * 1024 }).success).toBe(false);
  expect(updateDiagnosticsSchema.safeParse({ ...value, database: { ...value.database, records: "private notes" } }).success).toBe(false);
  expect(updateDiagnosticsSchema.safeParse({ ...value, failure: { ...value.failure, message: "https://private.test" } }).success).toBe(false);
});
