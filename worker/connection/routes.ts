import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { getSessionCookie } from "better-auth/cookies";
import { z } from "zod";
import { createAuth } from "../auth/create-auth";
import { readContextSession } from "../auth/context-session";
import type { AppEnvironment } from "../env";
import { consumeRateLimit, hashRateLimitIdentity } from "../security/rate-limit";
import { connectionOrigins } from "./config";
import { cookieAttributes, createEntryCredential, credentialSeconds, ENTRY_COOKIE, FLOW_COOKIE, hash, readCookie } from "./credential";

const flowBody = z.object({ flow: z.uuid() });
const issueBody = flowBody.extend({ sessionId: z.string().min(1).max(256) });
const redeemBody = flowBody.extend({ code: z.uuid(), sessionId: z.string().min(1).max(256) });
const ttl = 60_000;

export const connectionRoutes = new Hono<AppEnvironment>();
connectionRoutes.use("*", bodyLimit({ maxSize: 4096 }));
connectionRoutes.use("*", async (c, next) => {
  const origins = connectionOrigins(c.env);
  if (!origins) return c.json({ error: "not_found" }, 404);
  c.header("Cache-Control", "no-store");
  if (c.req.method !== "GET" && !origins.includes(c.req.header("Origin") ?? "")) return c.json({ error: "forbidden" }, 403);
  const key = await hashRateLimitIdentity(`connection:${c.req.header("cf-connecting-ip") ?? "unknown"}`, c.env.INVITE_SECRET);
  const limit = await consumeRateLimit(c.env.DB, key, { maxAttempts: 120, windowMs: 60_000 });
  if (!limit.allowed) return c.json({ error: "rate_limited" }, 429);
  await next();
});

connectionRoutes.get("/status", async c => {
  // Preparation is authenticated foreground activity too. Forward the normal
  // renewal cookie, so an unused entry does not silently age out while the
  // shared session remains active through the other entry.
  const session = await readContextSession(c);
  const deleted = session && await c.env.DB.prepare("SELECT 1 FROM user_lifecycle WHERE user_id = ?").bind(session.user.id).first();
  // A recovery-only native session is still a credential, but grants no
  // product access and cannot be exchanged. Lifecycle reauthentication needs
  // its exact ID without pretending it is a normal signed-in product user.
  return c.json({ sessionId: session?.session.id ?? null, userId: session?.user.id ?? null, productAccess: Boolean(session && !deleted) });
});

connectionRoutes.post("/begin", async c => {
  const flow = crypto.randomUUID(), browser = crypto.randomUUID();
  await c.env.DB.prepare("INSERT INTO connection_exchanges (id, browser_hash, target_origin, expires_at) VALUES (?, ?, ?, ?)")
    .bind(flow, await hash(browser), new URL(c.env.BETTER_AUTH_URL).origin, Date.now() + ttl).run();
  c.header("Set-Cookie", `${FLOW_COOKIE}=${browser}; Max-Age=60; ${cookieAttributes}`, { append: true });
  return c.json({ flow });
});

connectionRoutes.post("/issue", async c => {
  const body = issueBody.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "invalid_request" }, 400);
  const session = await createAuth(c.env, c.executionCtx).api.getSession({ headers: c.req.raw.headers, query: { disableRefresh: true } });
  if (!session || session.session.id !== body.data.sessionId) return c.json({ error: "session_changed" }, 409);
  const code = crypto.randomUUID();
  const result = await c.env.DB.prepare(`UPDATE connection_exchanges SET session_id = ?, code_hash = ?
    WHERE id = ? AND session_id IS NULL AND expires_at > ? AND target_origin != ?
    AND NOT EXISTS (SELECT 1 FROM user_lifecycle WHERE user_id = ?)`)
    .bind(session.session.id, await hash(code), body.data.flow, Date.now(), new URL(c.env.BETTER_AUTH_URL).origin, session.user.id).run();
  if (result.meta.changes !== 1) return c.json({ error: "exchange_unavailable" }, 409);
  return c.json({ code });
});

connectionRoutes.post("/redeem", async c => {
  const body = redeemBody.safeParse(await c.req.json().catch(() => null));
  const browser = readCookie(c.req.raw.headers, FLOW_COOKIE);
  if (!body.success || !browser) return c.json({ error: "invalid_request" }, 400);
  const native = await createAuth(c.env, c.executionCtx).api.getSession({ headers: c.req.raw.headers, query: { disableRefresh: true } });
  if (native && native.session.id !== body.data.sessionId) return c.json({ error: "entry_identity_conflict" }, 409);
  // Atomic consume with a live-session predicate. No exchange can resurrect a
  // revoked/deleted session, even if issue and redeem race with logout.
  const consumed = await c.env.DB.prepare(`DELETE FROM connection_exchanges
    WHERE id = ? AND browser_hash = ? AND code_hash = ? AND session_id = ?
      AND target_origin = ? AND expires_at > ?
      AND EXISTS (SELECT 1 FROM session WHERE id = connection_exchanges.session_id AND expires_at > ?
        AND NOT EXISTS (SELECT 1 FROM user_lifecycle WHERE user_id = session.user_id))
    RETURNING session_id`)
    .bind(body.data.flow, await hash(browser), await hash(body.data.code), body.data.sessionId, new URL(c.env.BETTER_AUTH_URL).origin, Date.now(), Date.now()).first<{ session_id: string }>();
  if (!consumed) return c.json({ error: "exchange_unavailable" }, 409);
  const credential = await createEntryCredential(consumed.session_id, new URL(c.env.BETTER_AUTH_URL).origin, getSessionCookie(c.req.raw.headers), c.env);
  // Separate from Better Auth's explicit-login cookie: a late exchange must
  // never overwrite a new login. entryRequest always prefers that native login.
  c.header("Set-Cookie", `${ENTRY_COOKIE}=${credential}; Max-Age=${credentialSeconds}; ${cookieAttributes}`, { append: true });
  c.header("Set-Cookie", `${FLOW_COOKIE}=; Max-Age=0; ${cookieAttributes}`, { append: true });
  return c.json({ ready: true, sessionId: consumed.session_id });
});
