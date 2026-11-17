import type { Context } from "hono";
import type { AppEnvironment } from "../env";
import { readContextSession } from "../auth/context-session";
import { AuthorizationError } from "../auth/authorization";

// Bind user ID, session ID and current time at the point of each read/write.
export const adminAuthority = () => `EXISTS (
 SELECT 1 FROM product_administrators a JOIN session se ON se.user_id=a.user_id
 WHERE a.user_id=? AND se.id=? AND se.expires_at>?
 AND NOT EXISTS(SELECT 1 FROM user_lifecycle WHERE user_id=a.user_id))`;

export async function requireAdmin(context: Context<AppEnvironment>) {
  const auth = await readContextSession(context);
  if (!auth) throw new AuthorizationError();
  const granted = await context.env.DB.prepare(`SELECT 1 WHERE ${adminAuthority()}`)
    .bind(auth.user.id, auth.session.id, Date.now()).first();
  if (!granted) throw new AuthorizationError();
  context.header("Cache-Control", "private, no-store");
  return { userId: auth.user.id, sessionId: auth.session.id };
}

export async function readAdminSession(context: Context<AppEnvironment>) {
  await requireAdmin(context);
  // Keep the wire shape understood by cached clients; every field is one role.
  return { manageReleases: 1, viewScores: 1, reviewXml: 1, publishXml: 1, manageReports: 1, deleteReports: 1 };
}
