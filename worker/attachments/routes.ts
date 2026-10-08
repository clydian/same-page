import { supportsMusicXml } from "./protocol";
import { Hono, type Context } from "hono";
import { z } from "zod";
import { attachmentFormat, attachmentLinkRequestSchema, attachmentNameSchema, attachmentPatchSchema, attachmentRecoveryOperationSchema } from "../../src/shared/attachments";
import { resolveContextChoirReadAccess } from "../auth/choir-read-access";
import { resolveContextPrincipal } from "../auth/context-principal";
import type { AppEnvironment } from "../env";
import { operationPredicate, requireOperation } from "../permissions/access";
import { limitDriveMutation } from "../security/drive-rate-limit";
import { serveStoredFile } from "../scores/serve-file";
import { AttachmentError, saveAttachmentFile } from "./storage";

export const attachmentRoutes = new Hono<AppEnvironment>();
const base = "/choirs/:choirId/scores/:scoreId/attachments";
const selection = `SELECT a.id, a.score_id AS scoreId, a.name, a.kind, a.url, a.revision, a.updated_at AS updatedAt,
  a.trash_expires_at AS trashExpiresAt, a.trashed_at, a.purged_at, s.file_name AS scoreName, COALESCE(f.size_bytes, 0) AS sizeBytes,
  f.object_key, f.content_type, f.etag
  FROM score_attachments a JOIN scores s ON s.id = a.score_id
  LEFT JOIN score_attachment_files f ON f.id = a.current_file_id AND f.state = 'ready' AND f.purged_at IS NULL`;
const readable = `a.purged_at IS NULL AND s.purged_at IS NULL AND s.trashed_at IS NULL AND (a.kind = 'link' OR f.id IS NOT NULL)`;
interface AttachmentRow {
  id: string; scoreId: string; name: string; kind: "link" | "audio" | "pdf" | "markdown" | "musicxml"; url: string | null;
  revision: number; updatedAt: number; trashExpiresAt: number | null; scoreName: string; sizeBytes: number;
  object_key: string | null; content_type: string | null; etag: string | null;
  trashed_at: number | null; purged_at: number | null;
}
const serialize = (row: AttachmentRow) => ({ id: row.id, scoreId: row.scoreId, name: row.name, kind: row.kind, url: row.url,
  revision: row.revision, updatedAt: row.updatedAt, trashExpiresAt: row.trashExpiresAt, scoreName: row.scoreName, sizeBytes: row.sizeBytes });

attachmentRoutes.get("/choirs/:choirId/attachments/capabilities", async context => {
  const choirId = context.req.param("choirId");
  await resolveContextChoirReadAccess(context, choirId);
  const row = await context.env.DB.prepare("SELECT musicxml_enabled FROM choirs WHERE id = ?").bind(choirId).first<{ musicxml_enabled: number }>();
  return context.json({ musicxml: row?.musicxml_enabled === 1 });
});

attachmentRoutes.get("/choirs/:choirId/attachments", async context => {
  const choirId = context.req.param("choirId");
  await resolveContextChoirReadAccess(context, choirId);
  const ids = (context.req.query("scoreIds") ?? "").split(",").filter(Boolean);
  if (!ids.length || ids.length > 100 || ids.some(id => id.length > 100)) return context.json({ error: "invalid_score_ids" }, 400);
  const rows = await context.env.DB.prepare(`${selection} WHERE a.choir_id = ? AND a.score_id IN (SELECT value FROM json_each(?))
    AND ${readable} AND a.trashed_at IS NULL ORDER BY a.created_at, a.id`).bind(choirId, JSON.stringify(ids)).all<AttachmentRow>();
  return context.json({ attachments: rows.results.filter(row => row.kind !== "musicxml" || supportsMusicXml(context)).map(serialize) });
});

attachmentRoutes.get("/choirs/:choirId/attachments/trash", async context => {
  const choirId = context.req.param("choirId");
  await requireOperation(context.env.DB, await resolveContextPrincipal(context), choirId, "trashFiles");
  const rows = await context.env.DB.prepare(`${selection} WHERE a.choir_id = ? AND ${readable}
    AND a.trashed_at IS NOT NULL AND a.trash_expires_at > ? ORDER BY a.trashed_at DESC`).bind(choirId, Date.now()).all<AttachmentRow>();
  return context.json({ attachments: rows.results.filter(row => row.kind !== "musicxml" || supportsMusicXml(context)).map(serialize) });
});

attachmentRoutes.post(base + "/links", async context => {
  const { choirId, scoreId, member } = await requireWrite(context, "uploadFiles");
  const input = attachmentLinkRequestSchema.safeParse(await context.req.json().catch(() => null));
  if (!input.success) return context.json({ error: "invalid_attachment" }, 400);
  const now = Date.now();
  const { id, url } = input.data;
  const name = input.data.name ?? new URL(url).hostname;
  const result = await context.env.DB.prepare(`INSERT INTO score_attachments (id, choir_id, score_id, kind, name, url, created_at, updated_at)
    SELECT ?, ?, ?, 'link', ?, ?, ?, ? WHERE ${operationPredicate("uploadFiles")} ON CONFLICT(id) DO NOTHING RETURNING id`)
    .bind(id, choirId, scoreId, name, url, now, now, member.id).all();
  if (result.results.length !== 1) return context.json({ error: "attachment_conflict" }, 409);
  return context.json({ attachment: { id, scoreId, name, kind: "link", url, sizeBytes: 0, revision: 1, updatedAt: now, trashExpiresAt: null } }, 201);
});

// Blob bodies let the platform supply Content-Length and avoid multipart buffering.
attachmentRoutes.on(["POST", "PUT"], base + "/:attachmentId/file", async context => {
  const creating = context.req.method === "POST";
  const { choirId, scoreId, member } = await requireWrite(context, creating ? "uploadFiles" : "modifyFiles");
  const input = z.object({ id: z.uuid(), name: attachmentNameSchema, size: z.coerce.number().int().nonnegative(),
    expectedRevision: z.coerce.number().int().positive().optional() }).safeParse({
    id: context.req.param("attachmentId"), name: context.req.query("name"), size: context.req.query("size"),
    expectedRevision: context.req.query("expectedRevision"),
  });
  if (!input.success || (!creating && input.data.expectedRevision === undefined) || (creating && input.data.expectedRevision !== undefined)) return context.json({ error: "invalid_attachment" }, 400);
  const { id, name, size, expectedRevision } = input.data;
  const declared = context.req.header("Content-Length");
  if (declared !== undefined && Number(declared) !== size) return context.json({ error: "invalid_upload_length" }, 400);
  const body = context.req.raw.body ?? new Blob([]).stream();
  const attachment = await saveAttachmentFile({ env: context.env, choirId, scoreId, attachmentId: id, membershipId: member.id, name, size, body, expectedRevision });
  return context.json({ attachment }, creating ? 201 : 200);
});

attachmentRoutes.get(base + "/:attachmentId", async context => {
  await resolveContextChoirReadAccess(context, context.req.param("choirId")!);
  const row = await loadAttachment(context);
  return row ? context.json({ attachment: serialize(row) }) : context.json({ error: "attachment_not_found" }, 404);
});

// An active-file 404 cannot distinguish an unfinished upload from a completed
// delete. Recovery checks the live parent and the permission for the original
// operation, and never exposes pending/trash metadata to ordinary readers.
attachmentRoutes.get(base + "/:attachmentId/recovery", async context => {
  const operation = attachmentRecoveryOperationSchema.safeParse(context.req.query("operation"));
  if (!operation.success) return context.json({ error: "invalid_operation" }, 400);
  const choirId = context.req.param("choirId")!;
  const scoreId = context.req.param("scoreId")!;
  const permission = { create: "uploadFiles", modify: "modifyFiles", trash: "trashFiles" } as const;
  await requireOperation(context.env.DB, await resolveContextPrincipal(context), choirId, permission[operation.data]);
  const parent = await context.env.DB.prepare("SELECT id FROM scores WHERE id = ? AND choir_id = ? AND trashed_at IS NULL AND purged_at IS NULL AND current_version_id IS NOT NULL")
    .bind(scoreId, choirId).first();
  if (!parent) return context.json({ error: "resource_deleted" }, 404);
  const row = await context.env.DB.prepare(`${selection} WHERE a.id = ? AND a.choir_id = ? AND a.score_id = ?`)
    .bind(context.req.param("attachmentId"), choirId, scoreId).first<AttachmentRow>();
  if (!row) return context.json({ state: "absent" });
  if (row.purged_at !== null || row.trashed_at !== null) {
    if (operation.data === "trash") return context.json({ state: "trashed" });
    return context.json({ error: "resource_deleted" }, 404);
  }
  if (row.kind !== "link" && !row.object_key) return context.json({ state: "pending" });
  return context.json({ state: "available", attachment: serialize(row) });
});

attachmentRoutes.on(["GET", "HEAD"], base + "/:attachmentId/file", async context => {
  await resolveContextChoirReadAccess(context, context.req.param("choirId")!);
  const row = await loadAttachment(context);
  if (!row || !row.object_key || !row.etag || !row.content_type) return context.json({ error: "attachment_not_found" }, 404);
  const revision = context.req.query("revision");
  if (revision && Number(revision) !== row.revision) return context.json({ error: "attachment_conflict" }, 409);
  const disposition = context.req.query("download") === "1" ? "attachment" : "inline";
  return serveStoredFile(context, { objectKey: row.object_key, sizeBytes: row.sizeBytes, etag: row.etag, contentType: row.content_type,
    headers: { "X-Attachment-Revision": String(row.revision), "Content-Disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(row.name).replace(/'/g, "%27")}` } });
});

attachmentRoutes.patch(base + "/:attachmentId", async context => {
  const { choirId, scoreId, member } = await requireWrite(context, "modifyFiles");
  const input = attachmentPatchSchema.safeParse(await context.req.json().catch(() => null));
  const row = await loadAttachment(context);
  if (!row) return context.json({ error: "attachment_not_found" }, 404);
  if (!input.success) return context.json({ error: "invalid_attachment" }, 400);
  const { name, url, expectedRevision } = input.data;
  if (row.kind !== "link" && (url || attachmentFormat(name)?.extension !== attachmentFormat(row.name)?.extension)) return context.json({ error: "attachment_type_unsupported" }, 415);
  const result = await context.env.DB.prepare(`UPDATE score_attachments SET name = ?, url = ?, revision = revision + 1, updated_at = ?
    WHERE id = ? AND choir_id = ? AND score_id = ? AND revision = ? AND trashed_at IS NULL AND purged_at IS NULL
    AND EXISTS (SELECT 1 FROM scores WHERE id = ? AND trashed_at IS NULL AND purged_at IS NULL) AND ${operationPredicate("modifyFiles")} RETURNING id`)
    .bind(name, row.kind === "link" ? url ?? row.url : null, Date.now(), row.id, choirId, scoreId, expectedRevision, scoreId, member.id).all();
  return result.results.length === 1 ? context.body(null, 204) : context.json({ error: "attachment_conflict" }, 409);
});

attachmentRoutes.delete(base + "/:attachmentId", async context => {
  const { choirId, scoreId, member } = await requireWrite(context, "trashFiles");
  const revision = Number(context.req.query("expectedRevision"));
  if (!Number.isSafeInteger(revision) || revision < 1) return context.json({ error: "invalid_revision" }, 400);
  const now = Date.now();
  const result = await context.env.DB.prepare(`UPDATE score_attachments SET trashed_at = ?, trash_expires_at = ?, revision = revision + 1, updated_at = ?
    WHERE id = ? AND choir_id = ? AND score_id = ? AND revision = ? AND trashed_at IS NULL AND purged_at IS NULL
    AND EXISTS (SELECT 1 FROM scores WHERE id = ? AND trashed_at IS NULL AND purged_at IS NULL) AND ${operationPredicate("trashFiles")} RETURNING id`)
    .bind(now, now + 30 * 86400000, now, context.req.param("attachmentId"), choirId, scoreId, revision, scoreId, member.id).all();
  return result.results.length === 1 ? context.body(null, 204) : context.json({ error: "attachment_conflict" }, 409);
});

attachmentRoutes.post(base + "/:attachmentId/restore", async context => {
  const { choirId, scoreId, member } = await requireWrite(context, "trashFiles");
  const result = await context.env.DB.prepare(`UPDATE score_attachments SET trashed_at = NULL, trash_expires_at = NULL, revision = revision + 1, updated_at = ?
    WHERE id = ? AND choir_id = ? AND score_id = ? AND trashed_at IS NOT NULL AND trash_expires_at > ? AND purged_at IS NULL
    AND EXISTS (SELECT 1 FROM scores WHERE id = ? AND trashed_at IS NULL AND purged_at IS NULL) AND ${operationPredicate("trashFiles")} RETURNING id`)
    .bind(Date.now(), context.req.param("attachmentId"), choirId, scoreId, Date.now(), scoreId, member.id).all();
  return result.results.length === 1 ? context.body(null, 204) : context.json({ error: "attachment_not_found" }, 404);
});

async function loadAttachment(context: Context<AppEnvironment>) {
  return context.env.DB.prepare(`${selection} WHERE a.id = ? AND a.choir_id = ? AND a.score_id = ? AND ${readable} AND a.trashed_at IS NULL`)
    .bind(context.req.param("attachmentId"), context.req.param("choirId"), context.req.param("scoreId")).first<AttachmentRow>();
}
async function requireWrite(context: Context<AppEnvironment>, operation: "uploadFiles" | "modifyFiles" | "trashFiles") {
  const choirId = context.req.param("choirId")!;
  const scoreId = context.req.param("scoreId")!;
  const principal = await resolveContextPrincipal(context);
  const member = await requireOperation(context.env.DB, principal, choirId, operation);
  const limited = await limitDriveMutation(context, member.userId, "attachment-write", 120);
  if (limited) throw new AttachmentError("rate_limited", 409);
  return { choirId, scoreId, member };
}
