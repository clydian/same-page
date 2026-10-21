import { Hono } from "hono";
import { z } from "zod";
import type { AppEnvironment } from "../env";
import { diagnosticInboxQuerySchema, diagnosticStatusSchema } from "../../src/shared/diagnostic-inbox";
import type { DiagnosticReport } from "../../src/shared/diagnostic-report";
import { diagnosticAuthority, requireDiagnosticOperator } from "./diagnostic-access";
import { limitDriveMutation } from "../security/drive-rate-limit";

export const adminDiagnosticRoutes = new Hono<AppEnvironment>();
type ReportRow = { id: string; client_build: string | null; status: string; created_at: number; expires_at: number; payload: string };
const summary = (row: ReportRow) => {
  // Keep reading historical reports even when later schemas acquire optional fields.
  const report: DiagnosticReport = JSON.parse(row.payload);
  return { id: row.id, clientBuild: row.client_build, clientVersion: report.clientVersion ?? null,
    status: row.status, createdAt: row.created_at, expiresAt: row.expires_at,
    description: report.description.slice(0, 160), categories: [...new Set(report.records.map(record => record.category))] };
};

adminDiagnosticRoutes.get("/admin/reports", async c => {
  const operator = await requireDiagnosticOperator(c);
  const parsed = diagnosticInboxQuerySchema.safeParse(c.req.query());
  if (!parsed.success) return c.json({ error: "invalid_filter" }, 400);
  const query = parsed.data;
  if (query.from !== undefined && query.until !== undefined && query.from >= query.until) return c.json({ error: "invalid_filter" }, 400);
  const where = ["expires_at>?", diagnosticAuthority()];
  const values: (string | number)[] = [Date.now(), operator.userId, operator.sessionId, Date.now()];
  const filter = (sql: string, ...parameters: (string | number)[]) => { where.push(sql); values.push(...parameters); };
  if (query.id) filter("id=?", query.id);
  if (query.status) filter("status=?", query.status);
  if (query.build) filter("(client_build=? OR json_extract(payload,'$.clientVersion')=?)", query.build, query.build);
  if (query.category) filter("EXISTS(SELECT 1 FROM json_each(payload,'$.records') r WHERE json_extract(r.value,'$.category')=?)", query.category);
  if (query.from !== undefined) filter("created_at>=?", query.from);
  if (query.until !== undefined) filter("created_at<?", query.until);
  if (query.before) {
    const [time, id] = query.before.split("_");
    filter("(created_at<? OR (created_at=? AND id<?))", Number(time), Number(time), id);
  }
  const rows = (await c.env.DB.prepare(`SELECT * FROM diagnostic_reports WHERE ${where.join(" AND ")} ORDER BY created_at DESC,id DESC LIMIT 26`).bind(...values).all<ReportRow>()).results;
  const page = rows.slice(0, 25), last = page.at(-1);
  return c.json({ reports: page.map(summary), next: rows.length > 25 && last ? `${last.created_at}_${last.id}` : null });
});

adminDiagnosticRoutes.get("/admin/reports/:id", async c => {
  const operator = await requireDiagnosticOperator(c);
  const id = z.uuidv4().safeParse(c.req.param("id"));
  if (!id.success) return c.json({ error: "report_not_found" }, 404);
  const row = await c.env.DB.prepare(`SELECT * FROM diagnostic_reports WHERE id=? AND expires_at>? AND ${diagnosticAuthority()}`)
    .bind(id.data, Date.now(), operator.userId, operator.sessionId, Date.now()).first<ReportRow>();
  if (!row) return c.json({ error: "report_not_found" }, 404);
  return c.json({ ...summary(row), report: JSON.parse(row.payload) });
});

adminDiagnosticRoutes.on(["PATCH", "DELETE"], "/admin/reports/:id", async c => {
  const deleting = c.req.method === "DELETE";
  const operator = await requireDiagnosticOperator(c, deleting);
  if (c.req.header("Origin") !== new URL(c.env.BETTER_AUTH_URL).origin) return c.json({ error: "forbidden" }, 403);
  const id = z.uuidv4().safeParse(c.req.param("id"));
  if (!id.success) return c.json({ error: "report_not_found" }, 404);
  const limited = await limitDriveMutation(c, operator.userId, "diagnostic-inbox", 60);
  if (limited) return limited;
  let action = "delete";
  if (!deleting) {
    // A status request needs only a tiny bounded JSON body.
    if (c.req.header("Content-Type")?.split(";")[0].trim() !== "application/json") return c.json({ error: "invalid_status" }, 415);
    const reader = c.req.raw.body?.getReader();
    if (!reader) return c.json({ error: "invalid_status" }, 400);
    const decoder = new TextDecoder();
    let body = "", size = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > 128) { await reader.cancel(); return c.json({ error: "invalid_status" }, 413); }
        body += decoder.decode(chunk.value, { stream: true });
      }
      body += decoder.decode();
    } finally { reader.releaseLock(); }
    const parsed = z.object({ status: diagnosticStatusSchema }).strict().safeParse((() => { try { return JSON.parse(body); } catch { return null; } })());
    if (!parsed.success) return c.json({ error: "invalid_status" }, 400);
    action = parsed.data.status;
  }
  const now = Date.now();
  const guard = `id=? AND expires_at>? AND ${diagnosticAuthority(deleting)}`;
  const values = [id.data, now, operator.userId, operator.sessionId, now];
  const statements = [c.env.DB.prepare(`INSERT INTO diagnostic_report_audit(id,operator_id,report_id,action,created_at)
    SELECT ?,?,id,?,? FROM diagnostic_reports WHERE ${guard}`)
    .bind(crypto.randomUUID(), operator.userId, action, now, ...values)];
  if (deleting) statements.push(c.env.DB.prepare(`INSERT INTO diagnostic_report_tombstones(id) SELECT id FROM diagnostic_reports WHERE ${guard} ON CONFLICT DO NOTHING`).bind(...values));
  statements.push(deleting
    ? c.env.DB.prepare(`DELETE FROM diagnostic_reports WHERE ${guard}`).bind(...values)
    : c.env.DB.prepare(`UPDATE diagnostic_reports SET status=? WHERE ${guard}`).bind(action, ...values));
  // Audit, tombstone and content mutation commit together; revocation is rechecked inside each SQL statement.
  const results = await c.env.DB.batch(statements);
  if (!results.at(-1)?.meta.changes) return c.json({ error: "report_not_found" }, 404);
  return c.json({ id: id.data });
});
