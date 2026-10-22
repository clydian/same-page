import { Hono, type Context } from "hono";
import type { AppEnvironment } from "../env";
import { readContextSession } from "../auth/context-session";
import { AuthorizationError } from "../auth/authorization";
import { buildId } from "../../src/shared/build";
import { releaseContract, releaseSelectionSchema, releasePromotionSchema } from "../../src/shared/release-channels";
import { channels, manifest, preference, releaseDB } from "./catalog";
export const releaseRoutes = new Hono<AppEnvironment>();
releaseRoutes.use("*", async (c, next) => { c.header("Cache-Control", "private, no-store"); await next(); });
async function operator(c: Context<AppEnvironment>) {
  const auth = await readContextSession(c);
  if (!auth) throw new AuthorizationError();
  const granted = await releaseDB(c.env).prepare("SELECT user_id FROM release_operators WHERE user_id=? AND NOT EXISTS(SELECT 1 FROM user_lifecycle WHERE user_id=?)").bind(auth.user.id, auth.user.id).first();
  if (!granted) throw new AuthorizationError();
  return auth;
}
releaseRoutes.get("/client-release", async c => {
  const pointer = await channels(c.env);
  if (!pointer) return c.json({ error: "release_unavailable" }, 503);
  const choice = preference(c.req.raw), target = pointer[choice.channel];
  if (!await manifest(c.env, target)) return c.json({ error: "release_unavailable" }, 503);
  return c.json({ ...choice, target, revision: pointer.revision, backend: buildId, contract: releaseContract });
});
releaseRoutes.post("/client-release", async c => {
  if (c.req.header("Origin") !== new URL(c.env.BETTER_AUTH_URL).origin) return c.json({ error: "forbidden" }, 403);
  const input = releaseSelectionSchema.safeParse(await c.req.json().catch(() => null));
  if (!input.success) return c.json({ error: "invalid_selection" }, 400);
  const pointer = await channels(c.env);
  if (!pointer || !await manifest(c.env, pointer[input.data.channel])) return c.json({ error: "release_unavailable" }, 503);
  c.header("Set-Cookie", `same-page-channel=${input.data.channel}.${input.data.intent}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=31536000`, { append: true });
  return c.body(null, 204);
});
releaseRoutes.get("/admin/releases", async c => {
  await operator(c);
  const pointer = await channels(c.env);
  const releases = pointer ? (await releaseDB(c.env).prepare("SELECT build_id AS buildId,published_at AS publishedAt FROM frontend_releases WHERE build_id IN (?,?) AND ready=1").bind(pointer.stable, pointer.beta).all()).results : [];
  const events = (await releaseDB(c.env).prepare("SELECT id,operator_id AS operatorId,previous_stable AS previousStable,expected_beta AS target,created_at AS createdAt FROM release_promotions ORDER BY created_at DESC,id DESC LIMIT 30").all()).results;
  return c.json({ ...pointer, releases, events });
});
releaseRoutes.post("/admin/releases/promote", async c => {
  const auth = await operator(c);
  const input = releasePromotionSchema.safeParse(await c.req.json().catch(() => null));
  if (!input.success) return c.json({ error: "invalid_promotion" }, 400);
  const d = input.data;
  const prior = await releaseDB(c.env).prepare("SELECT operator_id,expected_beta,expected_revision FROM release_promotions WHERE id=?").bind(d.id).first<{ operator_id: string; expected_beta: string; expected_revision: number }>();
  if (prior) return prior.operator_id === auth.user.id && prior.expected_beta === d.expectedBeta && prior.expected_revision === d.expectedRevision ? c.body(null, 204) : c.json({ error: "release_conflict" }, 409);
  const pointer = await channels(c.env);
  if (!pointer || !await manifest(c.env, d.expectedBeta)) return c.json({ error: "release_unavailable" }, 503);
  try {
    await releaseDB(c.env).prepare("INSERT INTO release_promotions(id,operator_id,session_id,expected_beta,expected_revision,previous_stable,created_at) VALUES(?,?,?,?,?,?,?)")
      .bind(d.id, auth.user.id, auth.session.id, d.expectedBeta, d.expectedRevision, pointer.stable, Date.now()).run();
    return c.body(null, 204);
  } catch { return c.json({ error: "release_conflict" }, 409); }
});
