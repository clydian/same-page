import { getSessionCookie } from "better-auth/cookies";
import { Hono } from "hono";
import { createCliTokenSchema, type CliTokenCredential } from "../../src/shared/cli-tokens";
import { AuthorizationError } from "../auth/authorization";
import type { AppEnvironment } from "../env";
import { requireAdmin } from "./access";
import { hashCliToken } from "./cli-access";

export const cliTokenRoutes = new Hono<AppEnvironment>();
type TokenRow = Omit<CliTokenCredential, "canUpload" | "driveIds"> & { canUpload: number; driveIds: string };
const fields = `id,name,can_upload AS canUpload,drive_ids AS driveIds,created_at AS createdAt,
  expires_at AS expiresAt,revoked_at AS revokedAt,last_used_at AS lastUsedAt`;
const credential = (row: TokenRow): CliTokenCredential => ({ ...row, canUpload: row.canUpload === 1, driveIds: JSON.parse(row.driveIds) as string[] });

cliTokenRoutes.use("/admin/cli-tokens*", async (c, next) => {
  if (c.req.raw.headers.has("Authorization") || !getSessionCookie(c.req.raw.headers)) throw new AuthorizationError();
  if (c.req.method !== "GET" && c.req.header("Origin") !== new URL(c.env.BETTER_AUTH_URL).origin) throw new AuthorizationError();
  await next();
});

cliTokenRoutes.get("/admin/cli-tokens", async (c) => {
  const actor = await requireAdmin(c);
  const rows = await c.env.DB.prepare(`SELECT ${fields} FROM admin_cli_tokens WHERE user_id=? ORDER BY created_at DESC,id DESC`)
    .bind(actor.userId).all<TokenRow>();
  return c.json({ tokens: rows.results.map(credential) });
});

cliTokenRoutes.post("/admin/cli-tokens", async (c) => {
  const input = createCliTokenSchema.safeParse(await c.req.json().catch(() => null));
  if (!input.success) return c.json({ error: "invalid_cli_token" }, 400);
  const data = input.data;
  const actor = await requireAdmin(c, data.canUpload ? "review_xml" : "view_scores");
  const scopes = JSON.stringify(data.driveIds);
  const now = Date.now();
  const id = crypto.randomUUID();
  const token = "sp_cli_" + Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const expiresAt = now + data.expiresInDays * 86400000;
  const inserted = await c.env.DB.prepare(`INSERT INTO admin_cli_tokens(id,user_id,name,token_hash,can_upload,drive_ids,created_at,expires_at)
    SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM product_operators o JOIN session se ON se.user_id=o.user_id
      WHERE o.user_id=? AND se.id=? AND se.expires_at>? AND o.view_scores=1 AND (?=0 OR o.review_xml=1)
      AND NOT EXISTS(SELECT 1 FROM user_lifecycle WHERE user_id=o.user_id))
    AND NOT EXISTS(SELECT 1 FROM json_each(?) scope WHERE NOT EXISTS(
      SELECT 1 FROM product_admin_drives d JOIN choirs c ON c.id=d.choir_id WHERE d.choir_id=scope.value AND c.purged_at IS NULL))`)
    .bind(id, actor.userId, data.name, await hashCliToken(token), data.canUpload ? 1 : 0, scopes, now, expiresAt,
      actor.userId, actor.sessionId, now, data.canUpload ? 1 : 0, scopes).run();
  if (inserted.meta.changes !== 1) throw new AuthorizationError();
  return c.json({ token, credential: { id, name: data.name, canUpload: data.canUpload, driveIds: data.driveIds,
    createdAt: now, expiresAt, revokedAt: null, lastUsedAt: null } }, 201);
});

cliTokenRoutes.delete("/admin/cli-tokens/:id", async (c) => {
  const actor = await requireAdmin(c);
  await c.env.DB.prepare("UPDATE admin_cli_tokens SET revoked_at=COALESCE(revoked_at,?) WHERE id=? AND user_id=?")
    .bind(Date.now(), c.req.param("id"), actor.userId).run();
  return c.body(null, 204);
});
