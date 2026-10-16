import type { Env } from "../env";
export async function cleanupAdminXml(env: Env, now = Date.now()) {
  await env.DB.batch([
    env.DB.prepare(
      `DELETE FROM xml_candidates WHERE expires_at<=? OR (state='pending' AND created_at<=?)
      OR EXISTS(SELECT 1 FROM scores s JOIN choirs c ON c.id=s.choir_id WHERE s.id=xml_candidates.score_id AND (s.purged_at IS NOT NULL OR c.purged_at IS NOT NULL))`,
    ).bind(now, now - 3600000),
    env.DB.prepare("DELETE FROM xml_publish_staging WHERE created_at<=?").bind(
      now - 3600000,
    ),
    env.DB.prepare("DELETE FROM xml_publications WHERE created_at<=?").bind(
      now - 90 * 86400000,
    ),
    env.DB.prepare("DELETE FROM product_admin_audit WHERE created_at<=?").bind(
      now - 90 * 86400000,
    ),
  ]);
}
