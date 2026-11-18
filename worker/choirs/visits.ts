import { Hono } from "hono";
import { VISIT_INTERVAL_MS, VISIT_RETENTION_MS } from "../../src/shared/drive-usage";
import { readContextSession } from "../auth/context-session";
import type { AppEnvironment } from "../env";

export const visitRoutes = new Hono<AppEnvironment>();
visitRoutes.post("/choirs/:choirId/visits", async c => {
  c.header("Cache-Control", "no-store");
  const auth = await readContextSession(c);
  if (!auth) return c.json({ error: "unauthorized" }, 401);
  if (c.req.header("x-same-page-owner-user-id") !== auth.user.id) return c.json({ error: "identity_changed" }, 403);
  if (c.req.header("x-same-page-visit") !== "foreground") return c.json({ error: "invalid_request" }, 400);
  const choirId = c.req.param("choirId");
  // Only this explicit foreground signal records a visit. Normal reads, sync,
  // admin APIs and their polling never write these tables. All time is server time.
  const now = Date.now();
  await c.env.DB.prepare(`INSERT INTO drive_member_visits(membership_id, choir_id, last_seen_at)
    SELECT m.id, m.choir_id, ? FROM membership_capabilities m JOIN choirs c ON c.id=m.choir_id
    WHERE m.user_id=? AND m.choir_id=? AND c.is_preview_entry=0 AND c.purged_at IS NULL
      AND EXISTS(SELECT 1 FROM session WHERE id=? AND user_id=m.user_id AND expires_at>?)
      AND NOT EXISTS(SELECT 1 FROM product_operators WHERE user_id=m.user_id)
      AND NOT EXISTS(SELECT 1 FROM diagnostic_operators WHERE user_id=m.user_id)
      AND NOT EXISTS(SELECT 1 FROM release_operators WHERE user_id=m.user_id)
    ON CONFLICT(membership_id) DO UPDATE SET last_seen_at=excluded.last_seen_at
    WHERE drive_member_visits.last_seen_at <= excluded.last_seen_at - ?`)
    .bind(now, auth.user.id, choirId, auth.session.id, now, VISIT_INTERVAL_MS).run();
  // Non-members, preview visitors and operators are deliberately no-ops. Do not
  // leak membership state or turn ordinary guest browsing into permission errors.
  return c.body(null, 204);
});

export async function cleanupDriveVisits(db: D1Database, now = Date.now()) {
  // Erase only per-membership usage metadata; never cloud content or drives.
  await db.prepare("DELETE FROM drive_member_visits WHERE last_seen_at < ?")
    .bind(now - VISIT_RETENTION_MS).run();
}
