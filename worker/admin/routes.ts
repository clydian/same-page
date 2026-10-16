import { Hono, type Context } from "hono";
import { z } from "zod";
import type { AppEnvironment } from "../env";
import {
  attachmentFormat,
  attachmentNameSchema,
} from "../../src/shared/attachments";
import { xmlPublicationSchema, xmlReviewSchema } from "../../src/shared/admin";
import {
  AttachmentError,
  validateAttachmentStream,
} from "../attachments/storage";
import { serveStoredFile } from "../scores/serve-file";
import { limitDriveMutation } from "../security/drive-rate-limit";
import { adminAuthority, requireAdmin } from "./access";
export const adminRoutes = new Hono<AppEnvironment>();
const live = `s.trashed_at IS NULL AND s.purged_at IS NULL AND c.purged_at IS NULL AND v.purged_at IS NULL AND v.state='ready' AND v.etag IS NOT NULL`;
const parents = `FROM scores s JOIN choirs c ON c.id=s.choir_id JOIN product_admin_drives d ON d.choir_id=c.id
 JOIN score_versions v ON v.id=s.current_version_id AND v.score_id=s.id AND v.choir_id=c.id`;
const scoreSelect = `SELECT s.id,s.choir_id AS choirId,c.name AS driveName,s.file_name AS fileName,s.current_version_id AS versionId,v.sha256,v.page_count AS pageCount,
 s.generated_xml_disabled AS disabled,a.id AS attachmentId,a.revision AS attachmentRevision,a.source_pdf_version_id AS publishedSource,
 r.state AS candidateState,r.review AS candidateReview,r.source_version_id AS candidateSource ${parents}
 LEFT JOIN score_attachments a ON a.score_id=s.id AND a.source='generated' AND a.trashed_at IS NULL AND a.purged_at IS NULL AND a.current_file_id IS NOT NULL
 LEFT JOIN xml_candidates r ON r.id=(SELECT id FROM xml_candidates WHERE score_id=s.id AND expires_at>cast(unixepoch('subsecond')*1000 AS INTEGER) ORDER BY created_at DESC,id DESC LIMIT 1)`;
const candidateSelect = `SELECT id,name,source_version_id AS sourceVersionId,source_sha256 AS sourceSha256,size_bytes AS sizeBytes,sha256,state,tool,parameters,
 created_at AS createdAt,expires_at AS expiresAt,review,review_revision AS reviewRevision,reviewed_by AS reviewedBy,reviewed_at AS reviewedAt,review_note AS reviewNote,technical_passed AS technicalPassed FROM xml_candidates`;
async function score(context: Context<AppEnvironment>) {
  const row = await context.env.DB.prepare(
    `${scoreSelect} WHERE s.id=? AND ${live}`,
  )
    .bind(context.req.param("scoreId"))
    .first<{
      id: string;
      choirId: string;
      fileName: string;
      versionId: string;
      sha256: string;
      disabled: number;
      attachmentId: string | null;
      attachmentRevision: number | null;
    }>();
  if (!row) throw new AttachmentError("score_not_found", 404);
  return row;
}
async function candidate(context: Context<AppEnvironment>) {
  const parent = await score(context);
  const row = await context.env.DB.prepare(
    `SELECT * FROM xml_candidates WHERE id=? AND score_id=? AND choir_id=? AND expires_at>?`,
  )
    .bind(
      context.req.param("candidateId"),
      parent.id,
      parent.choirId,
      Date.now(),
    )
    .first<{
      id: string;
      object_key: string;
      name: string;
      size_bytes: number;
      state: string;
      etag: string;
      sha256: string;
      source_version_id: string;
      review_revision: number;
    }>();
  if (!row) throw new AttachmentError("candidate_unavailable", 404);
  return { parent, row };
}
async function audit(
  context: Context<AppEnvironment>,
  userId: string,
  action: string,
  scoreId: string | null = null,
  choirId: string | null = null,
  candidateId: string | null = null,
) {
  await context.env.DB.prepare(
    "INSERT INTO product_admin_audit(id,operator_id,choir_id,score_id,candidate_id,action,created_at) VALUES(?,?,?,?,?,?,?)",
  )
    .bind(
      crypto.randomUUID(),
      userId,
      choirId,
      scoreId,
      candidateId,
      action,
      Date.now(),
    )
    .run();
}
adminRoutes.get("/admin/session", async (c) => {
  const a = await requireAdmin(c);
  return c.json({
    viewScores: a.viewScores,
    reviewXml: a.reviewXml,
    publishXml: a.publishXml,
  });
});
adminRoutes.get("/admin/drives", async (c) => {
  await requireAdmin(c);
  return c.json({
    drives: (
      await c.env.DB.prepare(
        "SELECT c.id,c.name FROM choirs c JOIN product_admin_drives d ON d.choir_id=c.id WHERE c.purged_at IS NULL ORDER BY c.name,c.id",
      ).all()
    ).results,
  });
});
adminRoutes.get("/admin/scores", async (c) => {
  const a = await requireAdmin(c);
  const query = z
    .object({
      q: z.string().max(200).default(""),
      drive: z.string().max(100).default(""),
      after: z.string().max(100).default(""),
      filter: z
        .enum(["all", "missing", "review", "stale", "failed", "disabled"])
        .default("all"),
    })
    .safeParse(c.req.query());
  if (!query.success) return c.json({ error: "invalid_query" }, 400);
  const { q, drive, after, filter } = query.data;
  const conditions = {
    all: "1",
    missing: "a.id IS NULL AND s.generated_xml_disabled=0",
    review: "r.state='ready' AND r.review='pending'",
    stale:
      "(r.source_version_id<>s.current_version_id OR a.source_pdf_version_id<>s.current_version_id)",
    failed: "r.state='failed'",
    disabled: "s.generated_xml_disabled=1",
  };
  const rows = await c.env.DB.prepare(
    `${scoreSelect} WHERE ${live} AND s.id>? AND (?='' OR s.choir_id=?) AND instr(lower(s.file_name||' '||c.name),lower(?))>0 AND ${conditions[filter]} ORDER BY s.id LIMIT 31`,
  )
    .bind(after, drive, drive, q)
    .all<{ id: string }>();
  await audit(c, a.userId, "list-scores");
  return c.json({
    scores: rows.results.slice(0, 30),
    next: rows.results.length > 30 ? rows.results[29].id : null,
  });
});
adminRoutes.get("/admin/scores/:scoreId", async (c) => {
  const a = await requireAdmin(c);
  const s = await score(c);
  const cursor = z
    .string()
    .regex(/^\d+:[^:]{1,100}$/)
    .optional()
    .safeParse(c.req.query("before"));
  if (!cursor.success) return c.json({ error: "invalid_query" }, 400);
  const [time = "0", lastId = ""] = cursor.data?.split(":") ?? [];
  const rows = await c.env.DB.prepare(
    `${candidateSelect} WHERE score_id=? AND choir_id=? AND expires_at>? AND (?=0 OR created_at<? OR (created_at=? AND id<?)) ORDER BY created_at DESC,id DESC LIMIT 101`,
  )
    .bind(
      s.id,
      s.choirId,
      Date.now(),
      Number(time),
      Number(time),
      Number(time),
      lastId,
    )
    .all<{ id: string; createdAt: number }>();
  const last = rows.results[99];
  await audit(c, a.userId, "view-score", s.id, s.choirId);
  return c.json({
    score: s,
    candidates: rows.results.slice(0, 100),
    nextBefore:
      rows.results.length > 100 ? `${last.createdAt}:${last.id}` : null,
  });
});
adminRoutes.on(["GET", "HEAD"], "/admin/scores/:scoreId/pdf", async (c) => {
  const a = await requireAdmin(c);
  const s = await score(c);
  const version = c.req.query("versionId") || s.versionId;
  const now = Date.now();
  const file = await c.env.DB.prepare(
    `SELECT object_key,size_bytes,etag FROM score_versions WHERE id=? AND score_id=? AND choir_id=? AND state='ready' AND purged_at IS NULL
 AND (id=? OR (retention_expires_at>? AND EXISTS(SELECT 1 FROM xml_candidates WHERE score_id=? AND source_version_id=? AND expires_at>?)))`,
  )
    .bind(version, s.id, s.choirId, s.versionId, now, s.id, version, now)
    .first<{ object_key: string; size_bytes: number; etag: string }>();
  if (!file) return c.json({ error: "source_unavailable" }, 404);
  await audit(c, a.userId, "read-pdf", s.id, s.choirId);
  return serveStoredFile(c, {
    objectKey: file.object_key,
    sizeBytes: file.size_bytes,
    etag: file.etag,
    contentType: "application/pdf",
    headers: { "Cache-Control": "no-store" },
  });
});
adminRoutes.on(
  ["GET", "HEAD"],
  "/admin/scores/:scoreId/published",
  async (c) => {
    const a = await requireAdmin(c);
    const s = await score(c);
    const file = await c.env.DB.prepare(
      `SELECT f.object_key,f.size_bytes,f.etag,f.content_type FROM score_attachments a JOIN score_attachment_files f ON f.id=a.current_file_id
 WHERE a.id=? AND a.score_id=? AND a.choir_id=? AND a.source='generated' AND a.revision=? AND a.trashed_at IS NULL AND a.purged_at IS NULL AND f.state='ready' AND f.purged_at IS NULL`,
    )
      .bind(s.attachmentId, s.id, s.choirId, Number(c.req.query("revision")))
      .first<{
        object_key: string;
        size_bytes: number;
        etag: string;
        content_type: string;
      }>();
    if (!file) return c.json({ error: "attachment_conflict" }, 409);
    await audit(c, a.userId, "read-published", s.id, s.choirId);
    return serveStoredFile(c, {
      objectKey: file.object_key,
      sizeBytes: file.size_bytes,
      etag: file.etag,
      contentType: file.content_type,
      headers: { "Cache-Control": "no-store" },
    });
  },
);
adminRoutes.on(
  ["GET", "HEAD"],
  "/admin/scores/:scoreId/candidates/:candidateId/file",
  async (c) => {
    const a = await requireAdmin(c);
    const { parent, row } = await candidate(c);
    if (row.state !== "ready")
      return c.json({ error: "candidate_unavailable" }, 409);
    await audit(
      c,
      a.userId,
      "read-candidate",
      parent.id,
      parent.choirId,
      row.id,
    );
    return serveStoredFile(c, {
      objectKey: row.object_key,
      sizeBytes: row.size_bytes,
      etag: row.etag,
      contentType: attachmentFormat(row.name)!.contentType,
      headers: { "Cache-Control": "no-store" },
    });
  },
);
const importQuery = z.object({
  name: attachmentNameSchema,
  size: z.coerce.number().int().positive().max(20971520),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  sourceVersionId: z.uuid(),
  tool: z.string().max(200).default(""),
  parameters: z.string().max(1000).default(""),
});
adminRoutes.post(
  "/admin/scores/:scoreId/candidates/:candidateId",
  async (c) => {
    const a = await requireAdmin(c, "review_xml");
    const limited = await limitDriveMutation(c, a.userId, "admin-import", 20);
    if (limited) return limited;
    const s = await score(c);
    const input = importQuery.safeParse(c.req.query());
    const id = z.uuid().safeParse(c.req.param("candidateId"));
    if (!input.success || !id.success)
      return c.json({ error: "invalid_import" }, 400);
    const data = input.data;
    const format = attachmentFormat(data.name);
    if (format?.kind !== "musicxml")
      return c.json({ error: "attachment_type_unsupported" }, 415);
    const previous = await c.env.DB.prepare(
      "SELECT * FROM xml_candidates WHERE id=?",
    )
      .bind(id.data)
      .first<{
        score_id: string;
        source_version_id: string;
        sha256: string;
        name: string;
        state: string;
        imported_by: string;
        expires_at: number;
      }>();
    if (previous) {
      if (
        previous.score_id === s.id &&
        previous.source_version_id === data.sourceVersionId &&
        previous.sha256 === data.sha256 &&
        previous.name === data.name &&
        previous.imported_by === a.userId &&
        previous.state === "ready" &&
        previous.expires_at > Date.now()
      )
        return c.json({ id: id.data }, 200);
      return c.json({ error: "import_conflict" }, 409);
    }
    if (data.sourceVersionId !== s.versionId || s.disabled)
      return c.json({ error: "xml_publication_conflict" }, 409);
    const now = Date.now(),
      key = `admin/xml/${id.data}/${crypto.randomUUID()}`;
    const reserved = await c.env.DB.prepare(
      `INSERT INTO xml_candidates(id,choir_id,score_id,source_version_id,source_sha256,name,size_bytes,sha256,object_key,tool,parameters,imported_by,created_at,expires_at)
 SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE ${adminAuthority("review_xml")} AND EXISTS(SELECT 1 ${parents} WHERE s.id=? AND ${live} AND s.current_version_id=? AND s.generated_xml_disabled=0)`,
    )
      .bind(
        id.data,
        s.choirId,
        s.id,
        s.versionId,
        s.sha256,
        data.name,
        data.size,
        data.sha256,
        key,
        data.tool,
        data.parameters,
        a.userId,
        now,
        now + 30 * 86400000,
        a.userId,
        a.sessionId,
        now,
        s.id,
        s.versionId,
      )
      .run();
    if (reserved.meta.changes !== 1)
      return c.json({ error: "xml_publication_conflict" }, 409);
    try {
      const chunks: Uint8Array[] = [];
      let size = 0;
      const reader = c.req.raw.body
        ?.pipeThrough(validateAttachmentStream(format.extension))
        .getReader();
      if (!reader) throw new AttachmentError("invalid_musicxml", 422);
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.length;
          if (size > data.size)
            throw new AttachmentError("invalid_upload_length", 400);
          chunks.push(part.value);
        }
      } finally {
        await reader.cancel().catch(() => undefined);
      }
      if (size !== data.size)
        throw new AttachmentError("invalid_upload_length", 400);
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      const hash = Array.from(
        new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
        (b) => b.toString(16).padStart(2, "0"),
      ).join("");
      if (hash !== data.sha256)
        throw new AttachmentError("checksum_mismatch", 422);
      const object = await c.env.SCORES_BUCKET.put(key, bytes, {
        httpMetadata: { contentType: format.contentType },
      });
      if (!object) throw new Error("upload_failed");
      const committed = await c.env.DB.prepare(
        `UPDATE xml_candidates SET state='ready',etag=? WHERE id=? AND state='pending' AND expires_at>? AND ${adminAuthority("review_xml")}
   AND EXISTS(SELECT 1 ${parents} WHERE s.id=? AND ${live} AND s.current_version_id=? AND s.generated_xml_disabled=0) RETURNING id`,
      )
        .bind(
          object.httpEtag,
          id.data,
          Date.now(),
          a.userId,
          a.sessionId,
          Date.now(),
          s.id,
          s.versionId,
        )
        .all();
      if (committed.results.length !== 1)
        throw new AttachmentError("xml_publication_conflict");
      return c.json({ id: id.data }, 201);
    } catch (error) {
      await c.env.DB.batch([
        c.env.DB.prepare(
          "UPDATE xml_candidates SET state='failed' WHERE id=? AND state='pending'",
        ).bind(id.data),
        c.env.DB.prepare(
          `INSERT INTO score_object_deletions(id,object_key,platform_bytes) SELECT ?,?,0 WHERE NOT EXISTS(SELECT 1 FROM xml_candidates WHERE id=? AND state='ready') ON CONFLICT(object_key) DO UPDATE SET id=excluded.id`,
        ).bind(crypto.randomUUID(), key, id.data),
      ]);
      throw error;
    }
  },
);
adminRoutes.post(
  "/admin/scores/:scoreId/candidates/:candidateId/review",
  async (c) => {
    const a = await requireAdmin(c, "review_xml");
    const { parent, row } = await candidate(c);
    const input = xmlReviewSchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (
      !input.success ||
      (input.data.decision === "approved" && !input.data.technicalPassed)
    )
      return c.json({ error: "invalid_review" }, 400);
    const d = input.data,
      now = Date.now();
    const r = await c.env.DB.prepare(
      `UPDATE xml_candidates SET review=?,review_revision=review_revision+1,review_note=?,technical_passed=?,reviewed_by=?,reviewed_at=?
 WHERE id=? AND state='ready' AND review_revision=? AND expires_at>? AND ${adminAuthority("review_xml")}
 AND EXISTS(SELECT 1 ${parents} WHERE s.id=? AND ${live}) RETURNING id`,
    )
      .bind(
        d.decision,
        d.note,
        d.technicalPassed ? 1 : 0,
        a.userId,
        now,
        row.id,
        d.expectedRevision,
        now,
        a.userId,
        a.sessionId,
        now,
        parent.id,
      )
      .all();
    if (r.results.length !== 1)
      return c.json({ error: "review_conflict" }, 409);
    return c.body(null, 204);
  },
);
adminRoutes.post(
  "/admin/scores/:scoreId/candidates/:candidateId/publish",
  async (c) => {
    const a = await requireAdmin(c, "publish_xml");
    const { parent, row } = await candidate(c);
    const parsed = xmlPublicationSchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!parsed.success) return c.json({ error: "invalid_publication" }, 400);
    const d = parsed.data;
    const prior = await c.env.DB.prepare(
      "SELECT candidate_id,operator_id,attachment_id,expected_attachment_revision,expected_review_revision FROM xml_publications WHERE id=?",
    )
      .bind(d.id)
      .first<{
        candidate_id: string;
        operator_id: string;
        attachment_id: string;
        expected_attachment_revision: number;
        expected_review_revision: number;
      }>();
    if (prior)
      return prior.candidate_id === row.id &&
        prior.operator_id === a.userId &&
        prior.attachment_id === d.attachmentId &&
        prior.expected_attachment_revision === d.expectedAttachmentRevision &&
        prior.expected_review_revision === d.expectedReviewRevision
        ? c.body(null, 204)
        : c.json({ error: "publication_conflict" }, 409);
    const limited = await limitDriveMutation(c, a.userId, "admin-publish", 30);
    if (limited) return limited;
    if (row.state !== "ready")
      return c.json({ error: "candidate_unavailable" }, 409);
    const fileId = crypto.randomUUID(),
      key = `choirs/${parent.choirId}/scores/${parent.id}/attachments/${d.attachmentId}/${fileId}`;
    await c.env.DB.prepare(
      "INSERT INTO xml_publish_staging(id,object_key,size_bytes,created_at) VALUES(?,?,?,?)",
    )
      .bind(fileId, key, row.size_bytes, Date.now())
      .run();
    try {
      const source = await c.env.SCORES_BUCKET.get(row.object_key);
      if (!source) throw new AttachmentError("candidate_unavailable", 404);
      const stored = await c.env.SCORES_BUCKET.put(key, source.body, {
        httpMetadata: source.httpMetadata,
      });
      if (!stored) throw new Error("upload_failed");
      await c.env.DB.prepare(
        `INSERT INTO xml_publications(id,candidate_id,choir_id,score_id,source_version_id,operator_id,session_id,attachment_id,expected_attachment_revision,expected_review_revision,file_id,etag,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
        .bind(
          d.id,
          row.id,
          parent.choirId,
          parent.id,
          row.source_version_id,
          a.userId,
          a.sessionId,
          d.attachmentId,
          d.expectedAttachmentRevision,
          d.expectedReviewRevision,
          fileId,
          stored.httpEtag,
          Date.now(),
        )
        .run();
      return c.body(null, 204);
    } catch (error) {
      await c.env.DB.batch([
        c.env.DB.prepare(
          `INSERT INTO score_object_deletions(id,object_key,platform_bytes) SELECT ?,?,0 WHERE NOT EXISTS(SELECT 1 FROM score_attachment_files WHERE object_key=?) ON CONFLICT(object_key) DO UPDATE SET id=excluded.id`,
        ).bind(crypto.randomUUID(), key, key),
        c.env.DB.prepare("DELETE FROM xml_publish_staging WHERE id=?").bind(
          fileId,
        ),
      ]);
      const winner = await c.env.DB.prepare(
        "SELECT id FROM xml_publications WHERE id=? AND candidate_id=? AND operator_id=? AND attachment_id=? AND expected_attachment_revision=? AND expected_review_revision=?",
      )
        .bind(
          d.id,
          row.id,
          a.userId,
          d.attachmentId,
          d.expectedAttachmentRevision,
          d.expectedReviewRevision,
        )
        .first();
      if (winner) return c.body(null, 204);
      throw error;
    }
  },
);
adminRoutes.get("/admin/audit", async (c) => {
  await requireAdmin(c);
  const rows = await c.env.DB.prepare(
    `SELECT id,operator_id AS operatorId,choir_id AS choirId,score_id AS scoreId,candidate_id AS candidateId,action,created_at AS createdAt FROM product_admin_audit ORDER BY created_at DESC,id DESC LIMIT 100`,
  ).all();
  return c.json({ events: rows.results });
});
