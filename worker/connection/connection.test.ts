import { env } from 'cloudflare:workers';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { beforeEach, expect, it } from 'vitest';
import { makeSignature, hashPassword } from 'better-auth/crypto';
import worker from '../index';
import type { Env } from '../env';
import { connectionBoundary } from './boundary';
import { ENTRY_COOKIE, FLOW_COOKIE } from './credential';

const origins = { direct: 'https://app.same-page.test', backup: 'https://alt.same-page.test' };
const bindings: Env = { ...env, BETTER_AUTH_URL: origins.direct, CONNECTIONS_ENABLED: 'true', CONNECTION_BACKUP_ORIGIN: origins.backup };
const jars = { direct: new Map<string, string>(), backup: new Map<string, string>() };
const ctx = () => createExecutionContext();
beforeEach(() => { jars.direct.clear(); jars.backup.clear(); });
async function call(route: keyof typeof origins, path: string, body?: unknown, options: { origin?: string; cookies?: string; method?: string } = {}) {
  const headers = new Headers({ origin: options.origin ?? origins.direct });
  if (path === '/auth/sign-out') { const session = await (await call(route, '/connection/status')).json<{sessionId: string}>(); headers.set('x-same-page-session', session.sessionId); }
  headers.set('cookie', options.cookies ?? [...jars[route]].map(([name, value]) => `${name}=${value}`).join('; '));
  if (body !== undefined) headers.set('content-type', 'application/json');
  const context = ctx();
  // Simulate ESA retaining the canonical upstream Host/SNI.
  const response = await worker.fetch(new Request(`${origins.direct}/api/_entry/${route}${path}`, {
    method: options.method ?? (body === undefined ? 'GET' : 'POST'), headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }), bindings, context);
  for (const cookie of response.headers.getSetCookie()) {
    const [pair] = cookie.split(';'), index = pair.indexOf('=');
    if (/max-age=0(?:;|$)/i.test(cookie)) jars[route].delete(pair.slice(0, index));
    else jars[route].set(pair.slice(0, index), pair.slice(index + 1));
  }
  await waitOnExecutionContext(context);
  return response;
}
async function login(route: keyof typeof origins = 'direct') {
  const id = crypto.randomUUID(), sessionId = crypto.randomUUID(), token = crypto.randomUUID();
  const now = Date.now();
  await env.DB.prepare('INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)').bind(id, 'Test', `${id}@test.invalid`, now, now).run();
  await env.DB.prepare('INSERT INTO session (id, token, user_id, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').bind(sessionId, token, id, now + 60_000, now - 120_000, now).run();
  jars[route].set('__Secure-better-auth.session_token', encodeURIComponent(`${token}.${await makeSignature(token, env.BETTER_AUTH_SECRET)}`));
  return { id, sessionId, token };
}
async function issue(source: keyof typeof origins, sessionId: string) {
  const target: keyof typeof origins = source === 'direct' ? 'backup' : 'direct';
  const start = await call(target, '/connection/begin', {});
  expect(start.status).toBe(200);
  const { flow } = await start.json<{ flow: string }>();
  const issued = await call(source, '/connection/issue', { flow, sessionId });
  expect(issued.status, await issued.clone().text()).toBe(200);
  const { code } = await issued.json<{ code: string }>();
  return { target, flow, code, sessionId };
}
async function exchange(source: keyof typeof origins, sessionId: string) {
  const body = await issue(source, sessionId);
  const response = await call(body.target, '/connection/redeem', body);
  expect(response.status, await response.clone().text()).toBe(200);
  return response;
}

it('prepares a host-only alternate credential, preserves the exact session and revokes both on backup logout', async () => {
  const { sessionId } = await login();
  const response = await exchange('direct', sessionId);
  const credential = response.headers.getSetCookie().find(cookie => cookie.startsWith(`${ENTRY_COOKIE}=`));
  expect(credential).toContain('Secure; HttpOnly; SameSite=Lax');
  expect(credential).not.toMatch(/domain=/i);
  expect(jars.backup.has('__Secure-better-auth.session_token')).toBe(false);
  const original = await env.DB.prepare('SELECT created_at FROM session WHERE id = ?').bind(sessionId).first<{ created_at: number }>();
  const result = await call('backup', '/auth/get-session');
  expect(result.status).toBe(200);
  const body = await result.json<{ session: { id: string; createdAt: string } }>();
  expect(body.session.id).toBe(sessionId);
  expect(new Date(body.session.createdAt).getTime()).toBe(original!.created_at);
  const renewed = await env.DB.prepare('SELECT expires_at FROM session WHERE id = ?').bind(sessionId).first<{ expires_at: number }>();
  expect(renewed!.expires_at).toBeGreaterThan(Date.now() + 179 * 86400_000);
  const staleBridge = `${ENTRY_COOKIE}=${jars.backup.get(ENTRY_COOKIE)}`;
  expect((await call('backup', '/auth/sign-out', {})).status).toBe(200);
  expect(await (await call('direct', '/auth/get-session')).json()).toBeNull();
  expect(await (await call('backup', '/auth/get-session', undefined, { cookies: staleBridge })).json()).toBeNull();
});

it('supports first password login through backup and reverse preparation without direct authentication', async () => {
  const id = crypto.randomUUID(), now = Date.now(), email = `${id}@test.invalid`, password = 'correct horse battery staple';
  await env.DB.prepare('INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)').bind(id, 'Test', email, now, now).run();
  await env.DB.prepare('INSERT INTO account (id, account_id, provider_id, user_id, password, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), id, 'credential', id, await hashPassword(password), now, now).run();
  const result = await call('backup', '/auth/sign-in/email', { email, password }, { origin: origins.backup });
  expect(result.status, await result.clone().text()).toBe(200);
  const body = await (await call('backup', '/auth/get-session')).json<{ session: { id: string } }>();
  await exchange('backup', body.session.id);
  const direct = await (await call('direct', '/auth/get-session')).json<{ session: { id: string }; user: { id: string } }>();
  expect(direct.session.id).toBe(body.session.id);
  expect(direct.user.id).toBe(id);
  const method = await env.DB.prepare('SELECT method FROM session_auth_methods WHERE session_id = ?').bind(body.session.id).first<{ method: string }>();
  expect(method!.method).toBe('credential');
  const providers = await (await call('backup', '/auth/social-providers')).json();
  expect(providers).toEqual({ providers: [] });
});

it('binds one-use redemption to its browser, exact session and audience, including simultaneous requests', async () => {
  const { sessionId } = await login();
  const body = await issue('direct', sessionId);
  expect((await call('backup', '/connection/redeem', body, { cookies: '' })).status).toBe(400);
  expect((await call('direct', '/connection/redeem', body, { cookies: `${FLOW_COOKIE}=${jars.backup.get(FLOW_COOKIE)}` })).status).toBe(409);
  expect((await call('backup', '/connection/redeem', { ...body, sessionId: 'wrong' })).status).toBe(409);
  const cookie = `${FLOW_COOKIE}=${jars.backup.get(FLOW_COOKIE)}`;
  const results = await Promise.all([call('backup', '/connection/redeem', body, { cookies: cookie }), call('backup', '/connection/redeem', body, { cookies: cookie })]);
  expect(results.map(response => response.status).sort()).toEqual([200, 409]);
  expect((await call('backup', '/connection/redeem', body, { cookies: cookie })).status).toBe(409);
});

it('rejects an expired exchange and a session revoked between issue and redemption', async () => {
  const { sessionId } = await login();
  const expired = await issue('direct', sessionId);
  await env.DB.prepare('UPDATE connection_exchanges SET expires_at = 0 WHERE id = ?').bind(expired.flow).run();
  expect((await call('backup', '/connection/redeem', expired)).status).toBe(409);
  const revoked = await issue('direct', sessionId);
  await env.DB.prepare('DELETE FROM session WHERE id = ?').bind(sessionId).run();
  expect((await call('backup', '/connection/redeem', revoked)).status).toBe(409);
});

it('does not replace an existing different login, even if a stale bridge cookie arrives later', async () => {
  const first = await login();
  await exchange('direct', first.sessionId);
  const stale = jars.backup.get(ENTRY_COOKIE)!;
  const second = await login('backup');
  jars.backup.set(ENTRY_COOKIE, stale);
  const body = await issue('direct', first.sessionId);
  expect((await call('backup', '/connection/redeem', body)).status).toBe(409);
  const session = await (await call('backup', '/auth/get-session')).json<{ user: { id: string } }>();
  expect(session.user.id).toBe(second.id);
});

it('has credentialed exact-origin CORS, rejects missing/untrusted mutation origins and keeps range bodies streaming', async () => {
  const request = new Request(`${origins.direct}/api/_entry/backup/health`, { method: 'OPTIONS', headers: {
    origin: origins.direct, 'access-control-request-method': 'GET', 'access-control-request-headers': 'Range, X-Same-Page-Attachments',
  } });
  const response = await worker.fetch(request, bindings, ctx());
  expect(response.status).toBe(204);
  expect(response.headers.get('access-control-allow-origin')).toBe(origins.direct);
  expect(response.headers.get('access-control-allow-credentials')).toBe('true');
  expect((await call('backup', '/connection/begin', {}, { origin: 'https://evil.same-page.test' })).status).toBe(403);
  expect((await worker.fetch(new Request(`${origins.direct}/api/_entry/backup/connection/begin`, { method: 'POST' }), bindings, ctx())).status).toBe(403);
  const range = new Request(`${origins.direct}/api/_entry/backup/choirs/id/file`, { headers: { range: 'bytes=0-127', origin: origins.direct, 'x-same-page-session': 'none' } });
  const streamed = await connectionBoundary(range, bindings, ctx(), async adapted => {
    expect(adapted.url).toBe(`${origins.backup}/api/choirs/id/file`);
    expect(adapted.headers.get('range')).toBe('bytes=0-127');
    return new Response(new Uint8Array(128), { status: 206, headers: { 'content-range': 'bytes 0-127/1000', 'x-score-version': 'version' } });
  });
  expect(streamed.status).toBe(206);
  expect(streamed.headers.get('access-control-expose-headers')).toContain('X-Score-Version');
  expect((await streamed.arrayBuffer()).byteLength).toBe(128);
  expect((await worker.fetch(request, { ...bindings, CONNECTIONS_ENABLED: 'false' }, ctx())).status).toBe(404);
});

it('guards every business request against a target cookie changed by another window', async () => {
  const first = await login();
  await exchange('direct', first.sessionId);
  await login('backup');
  const context = ctx();
  const cookie = [...jars.backup].map(([name, value]) => `${name}=${value}`).join('; ');
  const response = await worker.fetch(new Request(`${origins.direct}/api/_entry/backup/choirs`, { headers: {
    origin: origins.direct, cookie, 'x-same-page-session': first.sessionId,
  } }), bindings, context);
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ error: 'entry_identity_conflict' });
  const file = await worker.fetch(new Request(`${origins.direct}/api/_entry/backup/choirs/id/file?_sp_session=${first.sessionId}`, { headers: { origin: origins.direct, cookie } }), bindings, ctx());
  expect(file.status).toBe(409);
  expect((await worker.fetch(new Request(`${origins.direct}/api/_entry/backup/choirs`, { headers: { origin: origins.direct, cookie } }), bindings, ctx())).status).toBe(428);
  const ownSession = await (await call('backup', '/auth/get-session')).json<{ session: Record<string, unknown> }>();
  expect(ownSession.session).not.toHaveProperty('token');
});
