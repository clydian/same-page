import type { Context } from "hono";
import type { AppEnvironment } from "../env";
import { readContextSession } from "../auth/context-session";
import { AuthorizationError } from "../auth/authorization";

export function diagnosticAuthority(deleting = false) {
  return `EXISTS (SELECT 1 FROM diagnostic_operators o JOIN session se ON se.user_id=o.user_id
    WHERE o.user_id=? AND se.id=? AND se.expires_at>?
    ${deleting ? "AND o.can_delete=1" : ""}
    AND NOT EXISTS(SELECT 1 FROM user_lifecycle WHERE user_id=o.user_id))`;
}

export async function requireDiagnosticOperator(context: Context<AppEnvironment>, deleting = false) {
  const auth = await readContextSession(context);
  if (!auth) throw new AuthorizationError();
  const row = await context.env.DB.prepare(`SELECT can_delete AS canDelete FROM diagnostic_operators WHERE user_id=? AND ${diagnosticAuthority(deleting)}`)
    .bind(auth.user.id, auth.user.id, auth.session.id, Date.now()).first<{ canDelete: number }>();
  if (!row) throw new AuthorizationError();
  return { userId: auth.user.id, sessionId: auth.session.id, canDelete: row.canDelete };
}

// The shared shell admits either independently granted purpose; business endpoints keep their own gates.
export async function readAdminSession(context: Context<AppEnvironment>) {
  const auth = await readContextSession(context);
  if (!auth) throw new AuthorizationError();
  const row = await context.env.DB.prepare(`SELECT
    EXISTS(SELECT 1 FROM release_operators WHERE user_id=se.user_id) AS manageReleases,
    COALESCE((SELECT view_scores FROM product_operators WHERE user_id=se.user_id),0) AS viewScores,
    COALESCE((SELECT review_xml FROM product_operators WHERE user_id=se.user_id AND view_scores=1),0) AS reviewXml,
    COALESCE((SELECT publish_xml FROM product_operators WHERE user_id=se.user_id AND view_scores=1),0) AS publishXml,
    EXISTS(SELECT 1 FROM diagnostic_operators WHERE user_id=se.user_id) AS manageReports,
    COALESCE((SELECT can_delete FROM diagnostic_operators WHERE user_id=se.user_id),0) AS deleteReports
    FROM session se WHERE se.id=? AND se.user_id=? AND se.expires_at>?
    AND NOT EXISTS(SELECT 1 FROM user_lifecycle WHERE user_id=se.user_id)`)
    .bind(auth.session.id, auth.user.id, Date.now())
    .first<{ manageReleases: number; viewScores: number; reviewXml: number; publishXml: number; manageReports: number; deleteReports: number }>();
  if (!row || (!row.viewScores && !row.manageReports && !row.manageReleases)) throw new AuthorizationError();
  if (row.manageReleases) return row;
  const legacy = { viewScores: row.viewScores, reviewXml: row.reviewXml, publishXml: row.publishXml, manageReports: row.manageReports, deleteReports: row.deleteReports };
  return legacy;
}
