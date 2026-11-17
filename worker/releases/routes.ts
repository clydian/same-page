import { Hono } from "hono";
import type { AppEnvironment } from "../env";
import { requireAdmin } from "../admin/access";
import { buildId } from "../../src/shared/build";
import { releaseContract, releaseSelectionSchema, releasePromotionSchema } from "../../src/shared/release-channels";
import { channels, manifest, preference, releaseDB, compatibilityReady, releaseVersion, extendedVerification, stableStorageBaseline } from "./catalog";
export const releaseRoutes = new Hono<AppEnvironment>();
releaseRoutes.use("*", async (c, next) => { c.header("Cache-Control", "private, no-store"); await next(); });
releaseRoutes.get("/release-storage-baseline", async c => {
  // Missing/corrupt data is 503, never the absent-route 404 used by the bridge.
  const baseline = await stableStorageBaseline(c.env).catch(() => null);
  return baseline ? c.json(baseline) : c.json({ error: "release_unavailable" }, 503);
});
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
  await requireAdmin(c);
  const pointer = await channels(c.env);
  const events = (await releaseDB(c.env).prepare("SELECT id,operator_id AS operatorId,previous_stable AS previousStable,expected_beta AS target,created_at AS createdAt FROM release_promotions ORDER BY created_at DESC,id DESC LIMIT 30").all<{ id: string; operatorId: string; previousStable: string; target: string; createdAt: number }>()).results;
  const ids = [...new Set([...(pointer ? [pointer.stable, pointer.beta] : []), ...events.flatMap(event => [event.previousStable, event.target])])];
  const rows = ids.length ? (await releaseDB(c.env).prepare(`SELECT build_id AS buildId,published_at AS publishedAt FROM frontend_releases WHERE build_id IN (${ids.map(() => "?").join(",")}) AND ready=1`).bind(...ids).all<{ buildId: string; publishedAt: number }>()).results : [];
  const releases = await Promise.all(rows.map(async release => ({ ...release, version: await releaseVersion(c.env, release.buildId) })));
  const [verification, storageCompatible] = pointer ? await Promise.all([
    extendedVerification(c.env, pointer.beta),
    compatibilityReady(c.env, pointer.stable, pointer.beta).catch(() => false),
  ]) : [null, false];
  return c.json({ ...pointer, releases, events, verification, storageCompatible });
});
releaseRoutes.post("/admin/releases/promote", async c => {
  const auth = await requireAdmin(c);
  const input = releasePromotionSchema.safeParse(await c.req.json().catch(() => null));
  if (!input.success) return c.json({ error: "invalid_promotion" }, 400);
  const d = input.data;
  const prior = await releaseDB(c.env).prepare("SELECT operator_id,expected_beta,expected_revision FROM release_promotions WHERE id=?").bind(d.id).first<{ operator_id: string; expected_beta: string; expected_revision: number }>();
  if (prior) return prior.operator_id === auth.userId && prior.expected_beta === d.expectedBeta && prior.expected_revision === d.expectedRevision ? c.body(null, 204) : c.json({ error: "release_conflict" }, 409);
  const pointer = await channels(c.env);
  if (!pointer || !await manifest(c.env, d.expectedBeta) || !await compatibilityReady(c.env,pointer.stable,d.expectedBeta)) return c.json({ error: "release_unavailable" }, 503);
  try {
    await releaseDB(c.env).prepare("INSERT INTO release_promotions(id,operator_id,session_id,expected_beta,expected_revision,previous_stable,created_at) VALUES(?,?,?,?,?,?,?)")
      .bind(d.id, auth.userId, auth.sessionId, d.expectedBeta, d.expectedRevision, pointer.stable, Date.now()).run();
    return c.body(null, 204);
  } catch { return c.json({ error: "release_conflict" }, 409); }
});
