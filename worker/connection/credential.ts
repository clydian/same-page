import { getSessionCookie } from "better-auth/cookies";
import { makeSignature } from "better-auth/crypto";
import { createAuth } from "../auth/create-auth";
import type { Env, WaitUntilContext } from "../env";
import { decodeBase64Url, decodeUtf8Base64Url, encodeBase64Url, encodeUtf8Base64Url, signHmac, verifyHmac } from "../security/crypto";

export const ENTRY_COOKIE = "__Host-same_page_entry";
export const FLOW_COOKIE = "__Host-same_page_exchange";
export const credentialSeconds = 180 * 24 * 60 * 60;
export const cookieAttributes = "Path=/; Secure; HttpOnly; SameSite=Lax";

export function readCookie(headers: Headers, name: string) {
  return headers.get("cookie")?.split(";").map(part => part.trim()).find(part => part.startsWith(`${name}=`))?.slice(name.length + 1) ?? null;
}

export async function hash(value: string) {
  return encodeBase64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
}

export async function createEntryCredential(sessionId: string, audience: string, nativeCookie: string | null, env: Env) {
  const payload = encodeUtf8Base64Url(JSON.stringify({ sessionId, audience, nativeCookieHash: await hash(nativeCookie ?? ""), expiresAt: Date.now() + credentialSeconds * 1000 }));
  return `${payload}.${encodeBase64Url(await signHmac(env.BETTER_AUTH_SECRET, "entry-session-v1", payload))}`;
}

async function credentialSessionId(token: string, audience: string, nativeCookie: string | null, env: Env) {
  const [payload, signature, extra] = token.split(".");
  const bytes = signature && decodeBase64Url(signature);
  if (!payload || !bytes || extra || !await verifyHmac(env.BETTER_AUTH_SECRET, "entry-session-v1", payload, bytes)) return null;
  try {
    const claims: unknown = JSON.parse(decodeUtf8Base64Url(payload) ?? "null");
    if (!claims || typeof claims !== "object" || !("sessionId" in claims) || typeof claims.sessionId !== "string" || !("audience" in claims) || claims.audience !== audience || !("expiresAt" in claims) || typeof claims.expiresAt !== "number" || claims.expiresAt <= Date.now() || !("nativeCookieHash" in claims) || claims.nativeCookieHash !== await hash(nativeCookie ?? "")) return null;
    return claims.sessionId;
  } catch { return null; }
}

// Adapt once, ahead of every auth/principal/lifecycle/admin caller. The bridge
// proves an existing session; it never creates one or changes its createdAt.
export async function entryRequest(request: Request, audience: string, env: Env, ctx: WaitUntilContext) {
  const token = readCookie(request.headers, ENTRY_COOKIE);
  if (!token) return request;
  // A subsequent explicit login always wins over a late exchange cookie.
  const auth = createAuth(env, ctx);
  const nativeCookie = getSessionCookie(request.headers);
  if (nativeCookie && await auth.api.getSession({ headers: request.headers, query: { disableRefresh: true } })) return request;
  const sessionId = await credentialSessionId(token, audience, nativeCookie, env);
  if (!sessionId) return request;
  const session = await env.DB.prepare(`SELECT token FROM session WHERE id = ? AND expires_at > ?
    AND NOT EXISTS (SELECT 1 FROM user_lifecycle WHERE user_id = session.user_id)`)
    .bind(sessionId, Date.now()).first<{ token: string }>();
  if (!session) return request;
  const { authCookies } = await auth.$context;
  const signed = encodeURIComponent(`${session.token}.${await makeSignature(session.token, env.BETTER_AUTH_SECRET)}`);
  const headers = new Headers(request.headers);
  const cookies = (headers.get("cookie") ?? "").split(";").filter(part => !/^(?:__Secure-|__Host-)?better-auth\.session_token=/.test(part.trim()));
  cookies.push(`${authCookies.sessionToken.name}=${signed}`);
  headers.set("cookie", cookies.filter(Boolean).join("; "));
  return new Request(request, { headers });
}
