import { Hono } from "hono";
import { z } from "zod";
import type { AppEnvironment } from "../env";
import { requireAdmin } from "./access";
import type { DriveUsage } from "../../src/shared/drive-usage";

export const driveUsageRoutes = new Hono<AppEnvironment>();
driveUsageRoutes.get("/admin/drive-usage", async c => {
  await requireAdmin(c);
  const query = z.object({ q: z.string().max(100).default(""), after: z.string().max(100).default("") }).safeParse(c.req.query());
  if (!query.success) return c.json({ error: "invalid_query" }, 400);
  const now = Date.now();
  const [collection, rows] = await c.env.DB.batch([
    c.env.DB.prepare("SELECT started_at AS startedAt FROM drive_visit_collection WHERE id=1"),
    c.env.DB.prepare(`WITH page AS (
      SELECT * FROM choirs WHERE purged_at IS NULL AND id>? AND instr(lower(name),lower(?))>0 ORDER BY id LIMIT 31
    ) SELECT c.id,c.name,c.plan,c.created_at AS createdAt,c.is_preview_entry AS isPreviewEntry,
      c.storage_used_bytes AS usedBytes,c.storage_limit_bytes AS limitBytes,c.score_limit AS scoreLimit,c.member_limit AS memberLimit,
      c.last_member_visit_at AS lastMemberVisitAt,
      (SELECT count(*) FROM scores WHERE choir_id=c.id AND trashed_at IS NULL AND purged_at IS NULL) AS scoreCount,
      (SELECT count(*) FROM membership_capabilities WHERE choir_id=c.id) AS memberCount,
      (SELECT count(*) FROM drive_member_visits v JOIN membership_capabilities m ON m.id=v.membership_id
        WHERE v.choir_id=c.id AND v.last_seen_at>=? AND v.last_seen_at<=?) AS visitors7d,
      (SELECT count(*) FROM drive_member_visits v JOIN membership_capabilities m ON m.id=v.membership_id
        WHERE v.choir_id=c.id AND v.last_seen_at>=? AND v.last_seen_at<=?) AS visitors30d
      FROM page c ORDER BY c.id`)
      .bind(query.data.after, query.data.q, now - 7 * 86400000, now, now - 30 * 86400000, now),
  ]);
  return c.json({ drives: (rows.results as DriveUsage[]).slice(0, 30), next: rows.results.length > 30 ? (rows.results[29] as DriveUsage).id : null,
    collectionStartedAt: (collection.results[0] as { startedAt: number }).startedAt, asOf: now });
});
