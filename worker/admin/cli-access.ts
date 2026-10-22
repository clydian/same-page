import type { Context } from "hono";
import { AuthorizationError } from "../auth/authorization";
import type { AppEnvironment } from "../env";

export async function hashCliToken(token: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))),
    (byte) => byte.toString(16).padStart(2, "0")).join("");
}

// Bearer credentials never enter account, member, review, publication, or token-management routes.
export function allowsCliBearer(method: string, path: string) {
  if (method === "GET" && /^\/api\/admin\/(drives|scores(?:\/[^/]+)?)$/.test(path)) return true;
  if (["GET", "HEAD"].includes(method) && /^\/api\/admin\/scores\/[^/]+\/(pdf|published|candidates\/[^/]+\/file)$/.test(path)) return true;
  return method === "POST" && /^\/api\/admin\/scores\/[^/]+\/candidates\/[^/]+$/.test(path);
}

export async function readCliAccess(context: Context<AppEnvironment>, upload: boolean) {
  const match = /^Bearer (sp_cli_[a-f0-9]{64})$/.exec(context.req.header("Authorization") ?? "");
  if (!match) throw new AuthorizationError();
  const now = Date.now();
  const row = await context.env.DB.prepare(`SELECT t.id,t.user_id AS userId,t.drive_ids AS driveIds,
    o.view_scores AS viewScores,o.review_xml AS reviewXml,o.publish_xml AS publishXml
    FROM admin_cli_tokens t JOIN product_operators o ON o.user_id=t.user_id
    WHERE t.token_hash=? AND t.revoked_at IS NULL AND t.expires_at>? AND o.view_scores=1
    AND (?=0 OR (t.can_upload=1 AND o.review_xml=1))
    AND NOT EXISTS(SELECT 1 FROM user_lifecycle WHERE user_id=t.user_id)`)
    .bind(await hashCliToken(match[1]), now, upload ? 1 : 0)
    .first<{ id: string; userId: string; driveIds: string; viewScores: number; reviewXml: number; publishXml: number }>();
  if (!row) throw new AuthorizationError();
  const credential = { id: row.id, userId: row.userId, driveIds: JSON.parse(row.driveIds) as string[] };
  context.set("adminCliToken", credential);
  await context.env.DB.prepare("UPDATE admin_cli_tokens SET last_used_at=? WHERE id=? AND revoked_at IS NULL")
    .bind(now, row.id).run();
  context.header("Cache-Control", "no-store");
  return { userId: row.userId, sessionId: null, viewScores: row.viewScores, reviewXml: row.reviewXml, publishXml: row.publishXml };
}

export function cliDriveScope(context: Context<AppEnvironment>) {
  const credential = context.get("adminCliToken");
  return credential ? JSON.stringify(credential.driveIds) : null;
}

// Recheck at both reservation and commit; revocation during upload cannot publish a ready candidate.
export const cliUploadAuthority = `EXISTS (SELECT 1 FROM admin_cli_tokens t JOIN product_operators o ON o.user_id=t.user_id
  JOIN product_admin_drives d ON d.choir_id=?
  WHERE t.id=? AND t.user_id=? AND t.revoked_at IS NULL AND t.expires_at>?
  AND t.can_upload=1 AND o.view_scores=1 AND o.review_xml=1
  AND EXISTS(SELECT 1 FROM json_each(t.drive_ids) WHERE value=d.choir_id)
  AND NOT EXISTS(SELECT 1 FROM user_lifecycle WHERE user_id=t.user_id))`;
