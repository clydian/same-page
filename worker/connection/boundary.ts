import { connectionPrefix, isPublicConnectionPath } from "../../src/shared/connection";
import type { Env, WaitUntilContext } from "../env";
import { connectionOrigins } from "./config";
import { createAuth } from "../auth/create-auth";
import { getSessionCookie } from "better-auth/cookies";
import { cookieAttributes, createEntryCredential, credentialSeconds, ENTRY_COOKIE, entryRequest, FLOW_COOKIE } from "./credential";

const allowedHeaders = new Set(["content-type", "range", "if-range", "if-none-match", "x-same-page-attachments", "x-same-page-owner-user-id", "x-same-page-session"]);
const methods = "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS";

export async function connectionBoundary(request: Request, env: Env, ctx: WaitUntilContext | undefined, dispatch: (request: Request, env: Env) => Promise<Response>) {
  const url = new URL(request.url);
  const origins = connectionOrigins(env);
  if (!url.pathname.startsWith(connectionPrefix)) return dispatch(request, env);
  const match = /^\/api\/_entry\/(direct|backup)(\/.*)$/.exec(url.pathname);
  if (!origins || !match || !ctx) return Response.json({ error: "not_found" }, { status: 404 });
  const audience = origins[match[1] === "direct" ? 0 : 1];
  const origin = request.headers.get("Origin");
  // Path selection is public routing information, never proxy authentication.
  // Neither X-Forwarded-Host nor a client-supplied Host grants any privileges.
  if (origin && !origins.includes(origin)) return Response.json({ error: "forbidden" }, { status: 403 });
  const headers = new Headers();
  headers.set("Vary", "Origin");
  headers.set("Cache-Control", "no-store");
  if (origin) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Credentials", "true");
    headers.set("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges, Content-Disposition, X-Score-Version, X-Attachment-Revision, X-Same-Page-Request-Id, X-Same-Page-Build, X-Same-Page-Entry-Conflict");
  }
  if (request.method === "OPTIONS") {
    const wanted = request.headers.get("Access-Control-Request-Headers")?.toLowerCase().split(",").map(value => value.trim()).filter(Boolean) ?? [];
    if (!origin || wanted.some(value => !allowedHeaders.has(value)) || !methods.split(", ").includes(request.headers.get("Access-Control-Request-Method") ?? "")) return new Response(null, { status: 403, headers });
    headers.set("Access-Control-Allow-Headers", [...allowedHeaders].join(", "));
    headers.set("Access-Control-Allow-Methods", methods);
    return new Response(null, { status: 204, headers });
  }
  if (!["GET", "HEAD"].includes(request.method) && !origin) return Response.json({ error: "forbidden" }, { status: 403, headers });
  const effective = new URL(audience);
  effective.pathname = `/api${match[2]}`;
  effective.search = url.search;
  const expectedSession = request.headers.get("X-Same-Page-Session") ?? effective.searchParams.get("_sp_session");
  effective.searchParams.delete("_sp_session");
  const routedEnv = { ...env, BETTER_AUTH_URL: audience, CONNECTION_PRIMARY_ORIGIN: origins[0],
    // Google has one registered callback. Do not advertise an unverified
    // alternate callback or silently navigate away from the current origin.
    ...(match[1] === "backup" || origin && origin !== origins[0] ? { GOOGLE_CLIENT_ID: undefined, GOOGLE_CLIENT_SECRET: undefined } : {}) };
  try {
    const routed = new Request(effective, request);
    const adapted = await entryRequest(routed, audience, routedEnv, ctx);
    const usedBridge = adapted !== routed;
    const auth = createAuth(routedEnv, ctx);
    const bridgeSession = usedBridge ? await auth.api.getSession({ headers: adapted.headers, query: { disableRefresh: true } }) : null;
    if (!isPublicConnectionPath(effective.pathname)) {
      if (!expectedSession || expectedSession.length > 256) return Response.json({ error: "entry_session_required" }, { status: 428, headers });
      const session = await createAuth(routedEnv, ctx).api.getSession({ headers: adapted.headers, query: { disableRefresh: true } });
      if ((session?.session.id ?? "none") !== expectedSession) {
        headers.set("X-Same-Page-Entry-Conflict", "1");
        return Response.json({ error: "entry_identity_conflict" }, { status: 409, headers });
      }
    }
    let response = await dispatch(adapted, routedEnv);
    // Better Auth's public JSON includes its raw session token. New entry
    // clients use HttpOnly cookies exclusively; keep that token server-side.
    if (effective.pathname.startsWith("/api/auth/") && response.ok && response.headers.get("content-type")?.includes("application/json")) {
      const body: unknown = await response.json();
      const redact = (value: unknown): unknown => {
        if (Array.isArray(value)) return value.map(redact);
        if (!value || typeof value !== "object") return value;
        return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "token").map(([key, value]) => [key, key === "session" ? redact(value) : value]));
      };
      response = Response.json(redact(body), { status: response.status, headers: response.headers });
    }
    const result = new Response(response.body, response);
    if (usedBridge) {
      // A bridge must never turn a delayed read/renewal into a native login
      // cookie that can overwrite a newer explicit login in another window.
      // New explicit sign-in cookies are preserved; renewals of the adapted
      // old token rotate only the separate entry credential.
      const { authCookies } = await auth.$context;
      const adaptedToken = getSessionCookie(adapted.headers);
      const cookies = result.headers.getSetCookie();
      let renewed = false;
      result.headers.delete("Set-Cookie");
      for (const cookie of cookies) {
        const pair = cookie.split(";", 1)[0];
        const native = pair.startsWith(`${authCookies.sessionToken.name}=`);
        const token = native ? getSessionCookie(new Headers({ Cookie: pair })) : null;
        if (native && (!token || token === adaptedToken)) { renewed ||= Boolean(token); continue; }
        result.headers.append("Set-Cookie", cookie);
      }
      if (renewed && bridgeSession) {
        const credential = await createEntryCredential(bridgeSession.session.id, audience, getSessionCookie(routed.headers), routedEnv);
        result.headers.append("Set-Cookie", `${ENTRY_COOKIE}=${credential}; Max-Age=${credentialSeconds}; ${cookieAttributes}`);
      }
    }
    for (const [key, value] of headers) {
      if (key === "vary") result.headers.append(key, value);
      else result.headers.set(key, value);
    }
    // Revoke at the common backend; residual cookies on an unreachable entry
    // no longer authorize anything. A late bridge cannot restore that session.
    if (effective.pathname === "/api/auth/sign-out" && response.ok) {
      for (const name of [ENTRY_COOKIE, FLOW_COOKIE]) result.headers.append("Set-Cookie", `${name}=; Max-Age=0; ${cookieAttributes}`);
    }
    return result;
  } catch {
    return Response.json({ error: "internal_error" }, { status: 500, headers });
  }
}
