import { Hono } from "hono";
import { z } from "zod";
import { scoreFileNameKey, scoreFileNameSchema } from "../../src/shared/scores";
import { resolveContextPrincipal } from "../auth/context-principal";
import { AuthorizationError } from "../auth/authorization";
import { requireOperation, readPermissionMember } from "../permissions/access";
import { limitDriveMutation } from "../security/drive-rate-limit";
import type { AppEnvironment } from "../env";
import { isFilenameConflictError } from "./storage";

export const pdfTrashRoutes = new Hono<AppEnvironment>();
const base = "/choirs/:choirId/pdf-trash";
// Retain the original score relationship until restore; no copies or extra quota.
const recoverable = `v.purged_at IS NULL AND v.state = 'ready' AND v.candidate_expires_at IS NULL
  AND v.retention_expires_at > ? AND v.replaced_at IS NOT NULL AND v.id <> s.current_version_id
  AND s.purged_at IS NULL AND s.trashed_at IS NULL`;

pdfTrashRoutes.get(base, async context => {
  const choirId = context.req.param("choirId");
  await requireOperation(context.env.DB, await resolveContextPrincipal(context), choirId, "trashFiles");
  const result = await context.env.DB.prepare(`SELECT v.id, v.score_id AS scoreId,
    v.replaced_file_name AS fileName, v.size_bytes AS sizeBytes, v.page_count AS pageCount,
    v.replaced_at AS replacedAt, v.retention_expires_at AS trashExpiresAt
    FROM score_versions v JOIN scores s ON s.id = v.score_id
    WHERE v.choir_id = ? AND ${recoverable} ORDER BY v.replaced_at DESC, v.id`)
    .bind(choirId, Date.now()).all();
  context.header("Cache-Control", "no-store");
  return context.json({ files: result.results });
});

// A retry uses the same new score identity and cannot create duplicate files.
pdfTrashRoutes.post(base + "/:versionId/restore", async context => {
  const choirId = context.req.param("choirId")!;
  const versionId = context.req.param("versionId")!;
  const member = await requireOperation(context.env.DB, await resolveContextPrincipal(context), choirId, "trashFiles");
  const input = z.object({ fileName: scoreFileNameSchema, expectedReplacedAt: z.number().int() }).safeParse(await context.req.json().catch(() => null));
  if (!input.success) return context.json({ error: "invalid_file_name" }, 400);
  const limited = await limitDriveMutation(context, member.userId, "pdf-trash-restore", 30);
  if (limited) return limited;
  const now = Date.now();
  const targetId = `restored-pdf-${versionId}-${input.data.expectedReplacedAt}`;
  const retry = await context.env.DB.prepare(`SELECT id FROM scores
    WHERE id = ? AND choir_id = ? AND purged_at IS NULL AND trashed_at IS NULL`)
    .bind(targetId, choirId).first();
  if (retry) return context.json({ scoreId: targetId });
  try {
    const result = await context.env.DB.batch([
      context.env.DB.prepare(`INSERT INTO scores (id, choir_id, file_name, file_name_key,
        current_version_id, last_version_number, created_at, updated_at)
        SELECT ?, v.choir_id, ?, ?, NULL, v.version_number, ?, ?
        FROM score_versions v JOIN scores s ON s.id = v.score_id
        WHERE v.id = ? AND v.choir_id = ? AND v.replaced_at = ? AND ${recoverable}
          AND EXISTS (SELECT 1 FROM membership_capabilities WHERE id = ? AND trashFiles = 1)
        ON CONFLICT(id) DO NOTHING RETURNING id`)
        .bind(targetId, input.data.fileName, scoreFileNameKey(input.data.fileName), now, now, versionId, choirId, input.data.expectedReplacedAt, now, member.id),
      context.env.DB.prepare(`UPDATE score_versions SET score_id = ?, retention_expires_at = NULL,
        replaced_at = NULL, replaced_file_name = NULL
        WHERE id = ? AND choir_id = ? AND replaced_at = ? AND retention_expires_at > ?
          AND EXISTS (SELECT 1 FROM scores WHERE id = ? AND choir_id = ? AND current_version_id IS NULL)
          AND EXISTS (SELECT 1 FROM membership_capabilities WHERE id = ? AND trashFiles = 1)`)
        .bind(targetId, versionId, choirId, input.data.expectedReplacedAt, now, targetId, choirId, member.id),
      context.env.DB.prepare(`UPDATE scores SET current_version_id = ? WHERE id = ? AND choir_id = ?
        AND current_version_id IS NULL AND EXISTS (SELECT 1 FROM score_versions WHERE id = ? AND score_id = ?)`)
        .bind(versionId, targetId, choirId, versionId, targetId),
      context.env.DB.prepare(`INSERT INTO annotation_layers
        (id, choir_id, score_id, kind, default_slot, name, sort_order, default_color, created_by_membership_id, created_at, updated_at)
        SELECT lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-8' || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))), s.choir_id, s.id, 'shared', settings.slot,
          settings.name, settings.sort_order, settings.default_color, ?, ?, ?
        FROM scores s JOIN choir_shared_layer_settings settings ON settings.choir_id = s.choir_id
        WHERE s.id = ? AND s.current_version_id = ?
        ON CONFLICT(score_id, default_slot) WHERE default_slot IS NOT NULL DO NOTHING`)
        .bind(member.id, now, now, targetId, versionId),
    ]);
    if (!result[0].results.length) {
      const restored = await context.env.DB.prepare("SELECT id FROM scores WHERE id = ? AND choir_id = ? AND current_version_id = ? AND purged_at IS NULL AND trashed_at IS NULL")
        .bind(targetId, choirId, versionId).first();
      if (!restored) return context.json({ error: "pdf_not_found" }, 404);
    }
    return context.json({ scoreId: targetId });
  } catch (error) {
    if (isFilenameConflictError(error)) return context.json({ error: "filename_conflict" }, 409);
    throw error;
  }
});

pdfTrashRoutes.post(base + "/:versionId/purge", async context => {
  const choirId = context.req.param("choirId")!;
  const versionId = context.req.param("versionId")!;
  const member = await readPermissionMember(context.env.DB, await resolveContextPrincipal(context), choirId);
  if (!member.isOwner || (context.req.header("x-same-page-owner-user-id") && context.req.header("x-same-page-owner-user-id") !== member.userId)) throw new AuthorizationError();
  if (!z.object({ confirm: z.literal(true) }).safeParse(await context.req.json().catch(() => null)).success) return context.json({ error: "confirmation_required" }, 400);
  const limited = await limitDriveMutation(context, member.userId, "purge", 20);
  if (limited) return limited;
  const now = Date.now();
  const result = await context.env.DB.prepare(`UPDATE score_versions SET purged_at = ?
    WHERE id = ? AND choir_id = ? AND purged_at IS NULL AND replaced_at IS NOT NULL AND retention_expires_at > ?
      AND EXISTS (SELECT 1 FROM scores WHERE id = score_versions.score_id AND purged_at IS NULL AND trashed_at IS NULL AND current_version_id <> score_versions.id)
      AND EXISTS (SELECT 1 FROM membership_capabilities WHERE id = ? AND is_owner = 1) RETURNING id`)
    .bind(now, versionId, choirId, now, member.id).all();
  return result.results.length ? context.body(null, 204) : context.json({ error: "pdf_not_found" }, 404);
});
