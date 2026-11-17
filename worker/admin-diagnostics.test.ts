import { env } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { hashPassword } from "better-auth/crypto";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import worker from "./index";
import { cleanupDiagnosticReports } from "./diagnostic-reports";
import { diagnosticReportRetentionMs, type DiagnosticReport } from "../src/shared/diagnostic-report";

const password = "diagnostic-maintainer-password", hash = await hashPassword(password);
let userId: string, cookie: string;
function report(): DiagnosticReport {
  return { id: crypto.randomUUID(), version: 1, clientBuild: "abcdef1", clientVersion: "v26.10.20.1830", retentionDays: 180,
    description: "谱面没有显示", environment: { browser: "safari", browserVersion: "18.1", system: "ios", systemVersion: null,
      viewportWidth: 390, viewportHeight: 844, standalone: true, serviceWorkerControlled: true, onlineHint: true }, reader: null,
    records: [{ id: crypto.randomUUID(), time: Date.now(), operation: "pdf", category: "network", stage: "request", serverBuild: null, requestId: null, retryable: true, count: 1 }] };
}
async function call(path: string, init: RequestInit = {}) {
  const ctx = createExecutionContext();
  const response = await worker.fetch(new Request(`https://same-page.test/api${path}`, { ...init, headers: { cookie, Origin: "https://same-page.test", ...init.headers } }), env, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}
const submit = (value: DiagnosticReport) => call("/diagnostic-reports", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) });
const mark = (id: string, status = "investigating") => call(`/admin/reports/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
async function grant() {
  await env.DB.prepare("INSERT INTO product_administrators(user_id) VALUES(?) ON CONFLICT DO NOTHING").bind(userId).run();
}
beforeEach(async () => {
  vi.restoreAllMocks(); cookie = "";
  await env.DB.batch(["DELETE FROM diagnostic_report_audit", "DELETE FROM diagnostic_report_tombstones", "DELETE FROM diagnostic_reports", "DELETE FROM product_administrators", "DELETE FROM session", "DELETE FROM user", "DELETE FROM rate_limits"].map(sql => env.DB.prepare(sql)));
  userId = crypto.randomUUID(); const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO user(id,name,email,email_verified,created_at,updated_at) VALUES(?,'维护人员','support@example.test',1,?,?)").bind(userId, now, now),
    env.DB.prepare("INSERT INTO account(id,account_id,provider_id,user_id,password,created_at,updated_at) VALUES(?,?,'credential',?,?,?,?)").bind(crypto.randomUUID(), userId, userId, hash, now, now),
  ]);
  const login = await call("/auth/sign-in/email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "support@example.test", password }) });
  expect(login.status).toBe(200); cookie = login.headers.get("set-cookie")!.split(";")[0];
});
afterEach(() => vi.restoreAllMocks());

it("uses one product role for feedback, scores and session access, with immediate revocation", async () => {
  const value = report(); expect((await submit(value)).status).toBe(201);
  for (const path of ["/admin/session", "/admin/scores", "/admin/reports", `/admin/reports/${value.id}`]) {
    expect((await call(path)).status).toBe(403);
  }
  // A cached maintenance command cannot silently create a partial/wider grant.
  for (const table of ["release_operators", "product_operators", "diagnostic_operators"]) {
    await expect(env.DB.prepare(`INSERT INTO ${table}(user_id) VALUES(?)`).bind(userId).run()).rejects.toThrow();
  }
  await grant();
  expect(await (await call("/admin/session")).json()).toEqual({ manageReleases: 1, viewScores: 1, reviewXml: 1, publishXml: 1, manageReports: 1, deleteReports: 1 });
  expect((await call("/admin/scores")).status).toBe(200);
  expect((await call(`/admin/reports/${value.id}`)).status).toBe(200);
  await env.DB.prepare("DELETE FROM product_administrators").run();
  expect((await mark(value.id)).status).toBe(403);
  await grant(); await env.DB.prepare("DELETE FROM session").run();
  expect((await call(`/admin/reports/${value.id}`, { method: "DELETE" })).status).toBe(403);
});

it("filters and paginates with a stable timestamp/id cursor, excludes expired reports and supports legacy payloads", async () => {
  await grant();
  const value = report(); expect((await submit(value)).status).toBe(201);
  const payload = JSON.stringify(value), time = Date.now();
  await env.DB.batch(Array.from({ length: 27 }, (_, i) => env.DB.prepare("INSERT INTO diagnostic_reports(id,client_build,payload,payload_hash,created_at,expires_at) VALUES(?,'abcdef1',?,'fixture',?,?)").bind(crypto.randomUUID(), payload, time + i, time + 100000)));
  const first = await (await call("/admin/reports?build=v26.10.20.1830&category=network&status=new")).json() as { reports: { id: string }[]; next: string };
  expect(first.reports).toHaveLength(25);
  const second = await (await call(`/admin/reports?before=${first.next}`)).json() as { reports: { id: string }[]; next: string | null };
  expect(second.reports).toHaveLength(3); expect(second.next).toBeNull();
  expect(new Set([...first.reports, ...second.reports].map(row => row.id)).size).toBe(28);
  expect((await call("/admin/reports?category=unknown")).status).toBe(400);
  expect((await call("/admin/reports?from=2&until=1")).status).toBe(400);
  expect((await call("/admin/reports?before=garbage")).status).toBe(400);
  await env.DB.prepare("UPDATE diagnostic_reports SET expires_at=0 WHERE id=?").bind(value.id).run();
  expect((await call(`/admin/reports/${value.id}`)).status).toBe(404);
  expect((await mark(value.id)).status).toBe(404);
});

it("marks state without extending retention, then atomically deletes content with an audit and prevents resurrection", async () => {
  await grant(); const value = report(); await submit(value);
  const original = await env.DB.prepare("SELECT created_at,expires_at FROM diagnostic_reports WHERE id=?").bind(value.id).first<{ created_at: number; expires_at: number }>();
  expect(original!.expires_at - original!.created_at).toBe(diagnosticReportRetentionMs);
  expect((await mark(value.id)).status).toBe(200);
  expect(await env.DB.prepare("SELECT status,expires_at FROM diagnostic_reports WHERE id=?").bind(value.id).first()).toEqual({ status: "investigating", expires_at: original!.expires_at });
  expect((await call(`/admin/reports/${value.id}`, { method: "DELETE", headers: { Origin: "https://bad.test" } })).status).toBe(403);
  expect((await call(`/admin/reports/${value.id}`, { method: "DELETE" })).status).toBe(200);
  expect((await call(`/admin/reports/${value.id}`)).status).toBe(404);
  expect((await submit(value)).status).toBe(410);
  // A still-running legacy Worker uses the original VALUES INSERT without the API tombstone guard.
  await env.DB.prepare("INSERT INTO diagnostic_reports(id,client_build,payload,payload_hash,created_at,expires_at) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING")
    .bind(value.id, value.clientBuild, JSON.stringify(value), "legacy", Date.now(), Date.now() + 86400000).run();
  expect(await env.DB.prepare("SELECT id FROM diagnostic_reports WHERE id=?").bind(value.id).first()).toBeNull();
  const audit = (await env.DB.prepare("SELECT action,report_id,operator_id FROM diagnostic_report_audit ORDER BY created_at").all()).results;
  expect(audit).toHaveLength(2); expect(JSON.stringify(audit)).not.toContain(value.description);
  expect(audit).toContainEqual({ action: "delete", report_id: value.id, operator_id: userId });
  await cleanupDiagnosticReports(env.DB, Date.now() + diagnosticReportRetentionMs + 1000);
  expect((await env.DB.prepare("SELECT * FROM diagnostic_report_audit").all()).results).toHaveLength(0);
  expect((await submit(value)).status).toBe(410);
});

it("preserves the old 30-day promise for cached old clients and never changes an existing expiry", async () => {
  const legacy = report(); delete legacy.retentionDays; delete legacy.clientVersion;
  await submit(legacy);
  const original = await env.DB.prepare("SELECT created_at,expires_at FROM diagnostic_reports").first<{ created_at: number; expires_at: number }>();
  expect(original!.expires_at - original!.created_at).toBe(30 * 86400000);
  await submit(legacy);
  expect(await env.DB.prepare("SELECT created_at,expires_at FROM diagnostic_reports").first()).toEqual(original);
});

it("rechecks revocation inside write statements and bounds streamed status bodies", async () => {
  await grant(); const value = report(); await submit(value);
  expect((await mark(value.id, "invalid")).status).toBe(400);
  expect((await call(`/admin/reports/${value.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: "x".repeat(129) })).status).toBe(413);
  const batch = env.DB.batch.bind(env.DB);
  vi.spyOn(env.DB, "batch").mockImplementationOnce(async statements => {
    await env.DB.prepare("DELETE FROM product_administrators").run();
    return batch(statements);
  });
  expect((await call(`/admin/reports/${value.id}`, { method: "DELETE" })).status).toBe(404);
  expect(await env.DB.prepare("SELECT id FROM diagnostic_reports").first()).toEqual({ id: value.id });
  expect((await env.DB.prepare("SELECT * FROM diagnostic_report_tombstones").all()).results).toHaveLength(0);
  expect((await env.DB.prepare("SELECT * FROM diagnostic_report_audit").all()).results).toHaveLength(0);
});

it("rolls back audit and deletion markers when deleting the report fails", async () => {
  await grant(); const value = report(); await submit(value);
  await env.DB.exec("CREATE TRIGGER diagnostic_test_failure BEFORE DELETE ON diagnostic_reports BEGIN SELECT RAISE(ABORT,'fixture'); END");
  try {
    expect((await call(`/admin/reports/${value.id}`, { method: "DELETE" })).status).toBe(500);
    expect((await env.DB.prepare("SELECT * FROM diagnostic_report_tombstones").all()).results).toHaveLength(0);
    expect((await env.DB.prepare("SELECT * FROM diagnostic_report_audit").all()).results).toHaveLength(0);
  } finally { await env.DB.exec("DROP TRIGGER diagnostic_test_failure"); }
});
