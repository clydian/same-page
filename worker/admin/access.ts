import type { Context } from "hono";
import type { AppEnvironment } from "../env";
import { readContextSession } from "../auth/context-session";
import { AuthorizationError } from "../auth/authorization";
export type AdminCapability = "view_scores" | "review_xml" | "publish_xml";
export const adminAuthority = (
  capability: AdminCapability,
) => `EXISTS (SELECT 1 FROM product_operators o JOIN session se ON se.user_id=o.user_id
 WHERE o.user_id=? AND o.view_scores=1 AND o.${capability}=1 AND se.id=? AND se.expires_at>?
 AND NOT EXISTS(SELECT 1 FROM user_lifecycle WHERE user_id=o.user_id))`;
export async function requireAdmin(
  context: Context<AppEnvironment>,
  capability: AdminCapability = "view_scores",
) {
  const auth = await readContextSession(context);
  if (!auth) throw new AuthorizationError();
  const row = await context.env.DB.prepare(
    `SELECT view_scores AS viewScores,review_xml AS reviewXml,publish_xml AS publishXml
    FROM product_operators WHERE user_id=? AND ${adminAuthority(capability)}`,
  )
    .bind(auth.user.id, auth.user.id, auth.session.id, Date.now())
    .first<{ viewScores: number; reviewXml: number; publishXml: number }>();
  if (!row) throw new AuthorizationError();
  context.header("Cache-Control", "no-store");
  return { userId: auth.user.id, sessionId: auth.session.id, ...row };
}
