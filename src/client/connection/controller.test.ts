import { expect, it, vi } from 'vitest';
import { ConnectionController, EntryIdentityConflictError } from './controller';

const origins = { direct: 'https://same-page.test', backup: 'https://alt.same-page.test' };
const requestPath = (input: RequestInfo | URL) => new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
const make = (send: typeof fetch, extra: Partial<ConstructorParameters<typeof ConnectionController>[0]> = {}) => new ConnectionController({ origins, pageOrigin: origins.direct, send, random: () => .5, ...extra });

it('fails over only a safe read after network failure, shares cooldown and remains on backup', async () => {
  const send = vi.fn<typeof fetch>(async input => {
    if (requestPath(input).pathname.includes('/direct/')) throw new TypeError('Failed to fetch');
    return Response.json(requestPath(input).pathname.endsWith('/status') ? { sessionId: null } : { saved: true });
  });
  const controller = make(send);
  expect((await controller.fetch('/api/choirs')).status).toBe(200);
  expect(controller.getSnapshot().active).toBe('backup');
  await controller.fetch('/api/choirs/another');
  expect(send.mock.calls.map(([input]) => requestPath(input).pathname).filter(path => !path.endsWith('/status'))).toEqual(['/api/_entry/direct/choirs', '/api/_entry/backup/choirs', '/api/_entry/backup/choirs/another']);
  expect(send.mock.calls[1][1]).toMatchObject({ credentials: 'include', redirect: 'error' });
});

it.each([401, 403, 404, 409, 429, 500, 503])('does not change route for an HTTP %s response', async status => {
  const send = vi.fn<typeof fetch>(async () => new Response(null, { status }));
  const controller = make(send);
  expect((await controller.fetch('/api/choirs')).status).toBe(status);
  expect(send).toHaveBeenCalledTimes(1);
  expect(controller.getSnapshot().active).toBe('direct');
});

it('never resubmits a write after the backend committed but the response was lost', async () => {
  let committed = 0;
  const send = vi.fn<typeof fetch>(async () => { committed++; throw new TypeError('Failed to fetch'); });
  const controller = make(send);
  await expect(controller.fetch('/api/choirs', { method: 'POST', body: '{"name":"Drive"}' })).rejects.toBeInstanceOf(TypeError);
  expect(committed).toBe(1);
  expect(send).toHaveBeenCalledTimes(1);
});

it('keeps manual choice strict even when the other route is healthy', async () => {
  const send = vi.fn<typeof fetch>(async input => {
    if (requestPath(input).pathname.includes('/direct/')) throw new TypeError('Failed to fetch');
    return Response.json(requestPath(input).pathname.endsWith('/status') ? { sessionId: null } : { status: 'ok' });
  });
  const controller = make(send);
  controller.setMode('direct');
  await controller.check();
  expect(controller.getSnapshot().health.backup.state).toBe('reachable');
  await expect(controller.fetch('/api/choirs')).rejects.toBeInstanceOf(TypeError);
  expect(controller.getSnapshot().active).toBe('direct');
  controller.setMode('backup');
  expect((await controller.fetch('/api/choirs')).status).toBe(200);
});

it('requires two separated foreground confirmations to return to direct', async () => {
  let now = 1000;
  const controller = make(async input => Response.json(requestPath(input).pathname.endsWith('/status') ? { sessionId: null } : { status: 'ok' }), { now: () => now });
  controller.reportFailure('direct');
  controller.setMode('auto');
  expect(controller.getSnapshot().active).toBe('backup');
  await controller.check();
  expect(controller.getSnapshot().active).toBe('backup');
  now += 1000;
  await controller.check();
  expect(controller.getSnapshot().active).toBe('backup');
  now += 10_000;
  await controller.check();
  expect(controller.getSnapshot().active).toBe('direct');
});

it('does not retry caller cancellation or let a response from an old identity reach its reader', async () => {
  const aborted = new AbortController(); aborted.abort();
  const send = vi.fn<typeof fetch>();
  const controller = make(send);
  await expect(controller.fetch('/api/choirs', { signal: aborted.signal })).rejects.toMatchObject({ name: 'AbortError' });
  expect(send).not.toHaveBeenCalled();
  let finish!: (response: Response) => void;
  send.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const read = controller.fetch('/api/choirs');
  controller.invalidateIdentity('new-session');
  finish(Response.json({ private: 'old-user' }));
  await expect(read).rejects.toMatchObject({ name: 'AbortError' });
});

it('prepares a missing target cookie with memory-only POST exchange, and refuses another target identity', async () => {
  let target: string | null = null;
  const send = vi.fn<typeof fetch>(async (input, init) => {
    const path = requestPath(input).pathname;
    if (path.endsWith('/status')) return Response.json({ sessionId: path.includes('/backup/') ? target : 'original' });
    if (path.endsWith('/begin')) return Response.json({ flow: 'flow' });
    if (path.endsWith('/issue')) return Response.json({ code: 'code' });
    if (path.endsWith('/redeem')) { expect(JSON.parse(init!.body as string)).toEqual({ flow: 'flow', code: 'code', sessionId: 'original' }); target = 'original'; return Response.json({ ready: true }); }
    throw new Error('unexpected request');
  });
  const controller = make(send, { sessionId: 'original' });
  await controller.prepare('direct');
  expect(controller.getSnapshot().identity.backup).toBe('ready');
  expect(send.mock.calls.every(([input]) => !requestPath(input).search)).toBe(true);
  target = 'different'; controller.invalidateIdentity('original'); send.mockClear();
  await controller.prepare('direct');
  expect(controller.getSnapshot().identity.backup).toBe('conflict');
  expect(send).toHaveBeenCalledTimes(1);
  controller.setMode('backup');
  await expect(controller.fetch('/api/choirs')).rejects.toBeInstanceOf(EntryIdentityConflictError);
});

it('restores the expected session from backup when the first host cookie is absent', async () => {
  const send = vi.fn<typeof fetch>(async input => {
    const path = requestPath(input).pathname;
    if (path.endsWith('/get-session')) return Response.json(path.includes('/backup/') ? { user: { id: 'user' }, session: { id: 'expected' } } : null);
    return Response.json({ sessionId: path.includes('/backup/') ? 'expected' : null });
  });
  const controller = make(send, { sessionId: 'expected' });
  const body = await (await controller.fetch('/api/auth/get-session')).json();
  expect(body.session.id).toBe('expected');
  expect(controller.getSnapshot().active).toBe('backup');
  await controller.prepare('backup');
});

it('supports both routes from an alternate page without changing the page URL', async () => {
  const controller = make(async () => Response.json({ status: 'ok' }), { pageOrigin: origins.backup });
  expect(controller.endpoint('/api/health', 'direct')).toBe(`${origins.direct}/api/_entry/direct/health`);
  expect(controller.endpoint('/api/health', 'backup')).toBe(`${origins.backup}/api/_entry/backup/health`);
  expect(controller.endpoint('https://outside.test/api/file')).toBe('https://outside.test/api/file');
});

it('fails over a stalled connection but disarms setup timers after headers for a slow file body', async () => {
  vi.useFakeTimers();
  try {
    let bodySignal: AbortSignal | null | undefined;
    const controller = make(async (input, init) => {
      const path = requestPath(input).pathname;
      if (path.includes('/direct/')) return new Promise((_resolve, reject) => init!.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }));
      if (path.endsWith('/status')) return Response.json({ sessionId: null });
      bodySignal = init?.signal;
      return new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1])); } }));
    });
    const result = controller.fetch('/api/file');
    await vi.advanceTimersByTimeAsync(4001);
    const response = await result;
    expect(controller.getSnapshot().active).toBe('backup');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(bodySignal?.aborted).toBe(false);
    await response.body!.cancel();
  } finally { vi.useRealTimers(); }
});

it('carries an exact-session guard even after cached readiness, and surfaces a changed target cookie', async () => {
  const send = vi.fn<typeof fetch>(async (input, init) => {
    if (requestPath(input).pathname.endsWith('/status')) return Response.json({ sessionId: 'expected' });
    expect(new Headers(init?.headers).get('X-Same-Page-Session')).toBe('expected');
    return Response.json({ error: 'entry_identity_conflict' }, { status: 409, headers: { 'X-Same-Page-Entry-Conflict': '1' } });
  });
  const controller = make(send, { sessionId: 'expected' });
  // A native file uses the same non-secret guard; it is not an auth token.
  expect(controller.nativeEndpoint('/api/file')).toContain('/connection/unprepared');
  expect((await controller.fetch('/api/choirs')).status).toBe(409);
  expect(controller.getSnapshot().identity.direct).toBe('conflict');
});

it('can recover an expired common session by password or social login without clearing local storage', async () => {
  const changedIdentity = vi.fn();
  const send = vi.fn<typeof fetch>(async input => {
    const path = requestPath(input).pathname;
    if (path.endsWith('/flow')) return Response.json({ flow: 'sign-in' });
    if (path.endsWith('/sign-in/email') || path.endsWith('/sign-in/social')) return Response.json({ url: 'https://accounts.google.test/' });
    if (path.endsWith('/get-session')) return Response.json({ user: { id: 'user' }, session: { id: 'fresh' } });
    throw new Error('old session must not authorize a new login');
  });
  const controller = make(send, { sessionId: 'expired', changedIdentity });
  controller.setMode('backup');
  expect((await controller.fetch('/api/auth/flow', { method: 'POST' })).ok).toBe(true);
  expect((await controller.fetch('/api/auth/sign-in/email', { method: 'POST' })).ok).toBe(true);
  expect(changedIdentity).toHaveBeenCalledWith(null);
  expect((await (await controller.fetch('/api/auth/get-session')).json()).session.id).toBe('fresh');
  controller.invalidateIdentity('previous-google-session');
  expect((await controller.fetch('/api/auth/sign-in/social', { method: 'POST' })).ok).toBe(true);
  expect((await (await controller.fetch('/api/auth/get-session')).json()).session.id).toBe('fresh');
});

it('does not automatically restore a prepared route whose cookie changed to another session', async () => {
  let now = 1_000;
  let direct = 'original';
  const controller = make(async input => {
    const path = requestPath(input).pathname;
    return path.endsWith('/health') ? Response.json({ status: 'ok' }) : Response.json({ sessionId: path.includes('/direct/') ? direct : 'original' });
  }, { sessionId: 'original', now: () => now });
  await controller.prepare('backup');
  controller.reportFailure('direct'); controller.setMode('auto');
  direct = 'another-user';
  await controller.check(); now += 20_000; await controller.check();
  expect(controller.getSnapshot().active).toBe('backup');
  expect(controller.getSnapshot().identity.direct).toBe('conflict');
});

it('reverse-prepares from a valid backup after pinning an unprepared direct route', async () => {
  const sessions: Record<string, string | null> = { direct: null, backup: 'original' };
  const controller = make(async input => {
    const path = requestPath(input).pathname, route = path.includes('/direct/') ? 'direct' : 'backup';
    if (path.endsWith('/health')) return Response.json({ status: 'ok' });
    if (path.endsWith('/status')) return Response.json({ sessionId: sessions[route] });
    if (path.endsWith('/get-session')) return Response.json(sessions[route] ? { session: { id: sessions[route] } } : null);
    if (path.endsWith('/begin')) return Response.json({ flow: 'flow' });
    if (path.endsWith('/issue')) return Response.json({ code: 'code' });
    if (path.endsWith('/redeem')) { sessions[route] = 'original'; return Response.json({ ready: true }); }
    throw new Error('unexpected');
  }, { sessionId: 'original' });
  controller.setMode('direct');
  expect((await controller.fetch('/api/auth/get-session')).status).toBe(503);
  await controller.check();
  expect(controller.getSnapshot().mode).toBe('direct');
  expect(controller.getSnapshot().active).toBe('direct');
  expect(controller.getSnapshot().identity.direct).toBe('ready');
  expect((await (await controller.fetch('/api/auth/get-session')).json()).session.id).toBe('original');
});

it.each(['/api/auth/social-providers', '/api/guest/session', '/api/android-release', '/api/diagnostic-reports'])('keeps public recovery path %s available after common-session expiry', async path => {
  const send = vi.fn<typeof fetch>(async () => Response.json({ ok: true }));
  const controller = make(send, { sessionId: 'expired' });
  controller.setMode('backup');
  const init = path.endsWith('/diagnostic-reports') ? { method: 'POST', credentials: 'omit' as const } : undefined;
  expect((await controller.fetch(path, init)).ok).toBe(true);
  expect(send).toHaveBeenCalledTimes(1);
  if (init) { expect(send.mock.calls[0][1]?.credentials).toBe('omit'); expect(new Headers(send.mock.calls[0][1]?.headers).has('X-Same-Page-Session')).toBe(false); }
});

it('clears an obsolete expected ID only after both absent sessions, then reads admitted guest files', async () => {
  const changedIdentity = vi.fn();
  const controller = make(async (input, init) => {
    const path = requestPath(input).pathname;
    if (path.endsWith('/get-session')) return Response.json(null);
    if (path.endsWith('/status')) return Response.json({ sessionId: null });
    if (path.endsWith('/guest/session')) return Response.json({ choir: { id: 'preview', name: 'Preview', guestAdmissionMode: 'open' }, entryKind: 'preview' });
    expect(new Headers(init?.headers).get('X-Same-Page-Session')).toBe('none');
    return Response.json({ scores: [] });
  }, { sessionId: 'expired', changedIdentity });
  expect(await (await controller.fetch('/api/auth/get-session')).json()).toBeNull();
  expect(changedIdentity).toHaveBeenCalledWith(null);
  await controller.fetch('/api/guest/session', { method: 'POST', body: '{"admission":"open","choirId":"preview"}' });
  expect((await controller.fetch('/api/choirs/preview/bootstrap')).ok).toBe(true);
  expect(new URL(controller.nativeEndpoint('/api/choirs/preview/pdf')).searchParams.get('_sp_session')).toBe('none');
});

it('preserves a recovery-only credential while product get-session is intentionally null', async () => {
  const controller = make(async (input, init) => {
    const path = requestPath(input).pathname;
    if (path.endsWith('/sign-in/email')) return Response.json({ user: { id: 'recovering-user' } });
    if (path.endsWith('/status')) return Response.json({ sessionId: 'recovery-session', productAccess: false });
    if (path.endsWith('/get-session')) return Response.json(null);
    expect(new Headers(init?.headers).get('X-Same-Page-Session')).toBe('recovery-session');
    return Response.json({ deletion: { deletionId: 'deletion' } });
  }, { sessionId: 'old' });
  controller.setMode('backup');
  await controller.fetch('/api/auth/sign-in/email', { method: 'POST' });
  expect(await (await controller.fetch('/api/auth/get-session')).json()).toBeNull();
  expect((await controller.fetch('/api/user/lifecycle')).ok).toBe(true);
});

it('prepares a cold native file URL through bounded HEAD failover before exposing it to PDF.js', async () => {
  const controller = make(async (input, init) => {
    const path = requestPath(input).pathname;
    if (path.includes('/direct/')) throw new TypeError('Failed to fetch');
    if (path.endsWith('/status')) return Response.json({ sessionId: 'expected' });
    expect(init?.method).toBe('HEAD');
    return new Response(null, { headers: { 'Content-Length': '100' } });
  }, { sessionId: 'expected' });
  const url = await controller.readEndpoint('/api/choirs/drive/versions/version/pdf', new AbortController().signal);
  expect(url).toContain('/_entry/backup/choirs/drive/versions/version/pdf');
  expect(new URL(url).searchParams.get('_sp_session')).toBe('expected');
});

it('rejects a late absent-session probe without clearing a newer identity', async () => {
  let finish!: (response: Response) => void;
  const changedIdentity = vi.fn();
  const controller = make(async input => {
    const path = requestPath(input).pathname;
    if (path.endsWith('/get-session')) return Response.json(null);
    if (path.includes('/direct/')) return Response.json({ sessionId: null });
    return new Promise(resolve => { finish = resolve; });
  }, { sessionId: 'old', changedIdentity });
  const request = controller.fetch('/api/auth/get-session');
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  controller.invalidateIdentity('new-user-session');
  finish(Response.json({ sessionId: null }));
  await expect(request).rejects.toMatchObject({ name: 'AbortError' });
  expect(changedIdentity).not.toHaveBeenCalledWith(null);
});

it('cancels an old stateless admission confirmation without preparing its cookie after a new login', async () => {
  let finish!: (response: Response) => void;
  const send = vi.fn<typeof fetch>(async input => {
    if (requestPath(input).pathname.endsWith('/guest/session')) return Response.json({ choir: { id: 'guest-drive', name: 'Guest', guestAdmissionMode: 'open' }, entryKind: 'admission' });
    return new Promise(resolve => { finish = resolve; });
  });
  const changedIdentity = vi.fn();
  const controller = make(send, { sessionId: 'old', changedIdentity });
  const request = controller.fetch('/api/guest/session', { method: 'POST', body: '{}' });
  const outcome = request.then(response => ({ response, error: null }), error => ({ response: null, error }));
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  controller.invalidateIdentity('new-user-session');
  finish(Response.json({ sessionId: null }));
  expect((await outcome).error).toMatchObject({ name: 'AbortError' });
  expect(controller.getSnapshot().identity).toEqual({ direct: 'unknown', backup: 'unknown' });
  expect(changedIdentity).not.toHaveBeenCalledWith(null);
  expect(send.mock.calls.filter(([input]) => requestPath(input).pathname.endsWith('/guest/session'))).toHaveLength(1);
});

it('distinguishes a fallback attempt from a confirmed route and clears attempts after both routes fail', async () => {
  let finish!: (response: Response) => void;
  const send = vi.fn<typeof fetch>(async input => {
    const path = requestPath(input).pathname;
    if (path.includes('/direct/')) throw new TypeError('offline');
    if (path.endsWith('/status')) return Response.json({ sessionId: null });
    return new Promise(resolve => { finish = resolve; });
  });
  const controller = make(send);
  const request = controller.fetch('/api/choirs');
  await vi.waitFor(() => expect(controller.getSnapshot().attempting).toBe('backup'));
  expect(controller.getSnapshot().active).toBe('direct');
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  finish(Response.json({ ok: true })); await request;
  expect(controller.getSnapshot()).toMatchObject({ active: 'backup', attempting: null });
  send.mockRejectedValue(new TypeError('offline'));
  await expect(controller.fetch('/api/choirs')).rejects.toThrow();
  expect(controller.getSnapshot()).toMatchObject({ attempting: null, health: { backup: { state: 'unreachable' } } });
});

it('does not let superseded check failures overwrite a new identity', async () => {
  const failures: ((reason: Error) => void)[] = [];
  const send = vi.fn<typeof fetch>(async input => {
    if (requestPath(input).pathname.endsWith('/health')) return Response.json({ status: 'ok' });
    return new Promise((_resolve, reject) => { failures.push(reject); });
  });
  const controller = make(send);
  const check = controller.check();
  await vi.waitFor(() => expect(failures).toHaveLength(2));
  controller.invalidateIdentity('new');
  failures.forEach(fail => fail(new TypeError('late failure')));
  await check;
  expect(controller.getSnapshot().identity).toEqual({ direct: 'unknown', backup: 'unknown' });
});

it('does not let delayed write preparation replace a newer confirmed route in the same identity generation', async () => {
  let finish!: (response: Response) => void;
  const controller = make(async input => requestPath(input).pathname.endsWith('/status')
    ? new Promise(resolve => { finish = resolve; }) : Response.json({ ok: true }));
  controller.reportFailure('direct');
  const write = controller.writeEndpoint('/api/choirs/x/scores', new AbortController().signal);
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  await controller.fetch('/api/health');
  expect(controller.getSnapshot().active).toBe('backup');
  finish(Response.json({ sessionId: null }));
  await expect(write).rejects.toMatchObject({ name: 'AbortError' });
  expect(controller.getSnapshot().active).toBe('backup');
});

it('does not let delayed media recovery replace a newer route confirmation', async () => {
  let finish!: (response: Response) => void;
  const controller = make(async input => requestPath(input).pathname.endsWith('/status')
    ? new Promise(resolve => { finish = resolve; }) : Response.json({ ok: true }));
  const recovery = controller.recoverMedia('direct');
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  await controller.fetch('/api/health');
  finish(Response.json({ sessionId: null }));
  expect(await recovery).toBe(false);
  expect(controller.getSnapshot().active).toBe('backup');
});

it('requires fresh consecutive confirmations after a temporary success is interrupted by identity conflict', async () => {
  let now = 1000, conflict = false;
  const controller = make(async input => Response.json(requestPath(input).pathname.endsWith('/status')
    ? { sessionId: conflict && requestPath(input).pathname.includes('/direct/') ? 'someone-else' : null }
    : { status: 'ok' }), { now: () => now });
  controller.reportFailure('direct'); controller.setMode('auto');
  await controller.check(); expect(controller.getSnapshot().active).toBe('backup');
  now += 11_000; conflict = true; await controller.check();
  now += 11_000; conflict = false; await controller.check();
  expect(controller.getSnapshot().active).toBe('backup');
  now += 11_000; await controller.check(); expect(controller.getSnapshot().active).toBe('direct');
});

it.each([
  [0, 'success'], [1, 'success'], [0, 'failure'], [1, 'failure'], [0, 'cancel'], [1, 'cancel'],
] as const)('confirmation from concurrent fallback %s stays visible while the other request ends with %s', async (first, ending) => {
  const pending = new Map<string, { resolve: (response: Response) => void; reject: (reason: unknown) => void }>();
  const controller = make(async (input, init) => {
    const path = requestPath(input).pathname;
    if (path.endsWith('/status')) return Response.json({ sessionId: null });
    if (path.includes('/direct/')) throw new TypeError('offline');
    return new Promise((resolve, reject) => {
      pending.set(path.at(-1)!, { resolve, reject });
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
    });
  });
  const impossibleStates: unknown[] = [];
  const unsubscribe = controller.subscribe(() => {
    const state = controller.getSnapshot();
    if (state.active === 'backup' && state.attempting === 'backup') impossibleStates.push(state);
  });
  const aborts = [new AbortController(), new AbortController()];
  const reads = aborts.map((abort, i) => controller.fetch(`/api/choirs/${i}`, { signal: abort.signal }).catch(error => error));
  await vi.waitFor(() => expect(pending.size).toBe(2));
  expect(controller.getSnapshot()).toMatchObject({ active: 'direct', attempting: 'backup' });
  pending.get(String(first))!.resolve(Response.json({ ok: true }));
  expect(await reads[first]).toBeInstanceOf(Response);
  expect(controller.getSnapshot()).toMatchObject({ active: 'backup', attempting: null });
  const second = 1 - first;
  if (ending === 'success') pending.get(String(second))!.resolve(Response.json({ ok: true }));
  else if (ending === 'failure') pending.get(String(second))!.reject(new TypeError('offline'));
  else aborts[second].abort();
  const result = await reads[second];
  expect(result).toBeInstanceOf(ending === 'success' ? Response : Error);
  expect(controller.getSnapshot()).toMatchObject({ active: 'backup', attempting: null });
  expect(impossibleStates).toEqual([]);
  unsubscribe();
});

it('does not clear a newer different-target attempt when an older concurrent fallback finishes', async () => {
  const pending = new Map<string, (response: Response) => void>();
  let finishDirect!: (response: Response) => void;
  const controller = make(async input => {
    const path = requestPath(input).pathname;
    if (path.endsWith('/status')) return path.includes('/direct/')
      ? new Promise(resolve => { finishDirect = resolve; }) : Response.json({ sessionId: null });
    if (path.includes('/direct/')) throw new TypeError('offline');
    return new Promise(resolve => { pending.set(path.at(-1)!, resolve); });
  });
  const first = controller.fetch('/api/choirs/a'), second = controller.fetch('/api/choirs/b');
  await vi.waitFor(() => expect(pending.size).toBe(2));
  pending.get('a')!(Response.json({ ok: true })); await first;
  expect(controller.getSnapshot()).toMatchObject({ active: 'backup', attempting: null });
  const media = controller.recoverMedia('backup');
  await vi.waitFor(() => expect(finishDirect).toBeTypeOf('function'));
  expect(controller.getSnapshot().attempting).toBe('direct');
  pending.get('b')!(Response.json({ ok: true })); await second;
  expect(controller.getSnapshot()).toMatchObject({ active: 'backup', attempting: 'direct' });
  finishDirect(Response.json({ sessionId: null })); expect(await media).toBe(true);
  expect(controller.getSnapshot()).toMatchObject({ active: 'direct', attempting: null });
});

it.each([502, 504])('fails over a business read once after gateway HTTP %s', async status => {
  const send = vi.fn<typeof fetch>(async input => {
    const pathname = requestPath(input).pathname;
    if (pathname.endsWith('/status')) return Response.json({ sessionId: null });
    if (pathname.includes('/direct/')) return new Response('gateway', { status });
    return Response.json({ saved: true });
  });
  const controller = make(send);
  expect((await controller.fetch('/api/choirs')).status).toBe(200);
  expect(controller.getSnapshot().active).toBe('backup');
  expect(send.mock.calls.filter(([input]) => requestPath(input).pathname.endsWith('/choirs'))).toHaveLength(2);
});

it.each(['POST', 'PUT', 'DELETE'])('does not replay %s on gateway errors', async method => {
  const send = vi.fn<typeof fetch>(async () => new Response('gateway', { status: 502 }));
  expect((await make(send).fetch('/api/choirs', { method })).status).toBe(502);
  expect(send).toHaveBeenCalledTimes(1);
});

it.each(['/api/auth/get-session', '/api/auth/other', '/api/connection/status', '/api/guest/session'])('does not expand gateway replay for control request %s', async path => {
  const send = vi.fn<typeof fetch>(async () => new Response(null, { status: 502 }));
  expect((await make(send).fetch(path)).status).toBe(502);
  expect(send).toHaveBeenCalledTimes(1);
});

it('returns the last gateway response after two failures without marking fallback successful', async () => {
  const send = vi.fn<typeof fetch>(async input => requestPath(input).pathname.endsWith('/status')
    ? Response.json({ sessionId: null }) : new Response('gateway', { status: 504 }));
  const controller = make(send);
  const response = await controller.fetch('/api/choirs');
  expect(response.status).toBe(504);
  expect(await response.text()).toBe('gateway');
  expect(send.mock.calls.filter(([input]) => requestPath(input).pathname.endsWith('/choirs'))).toHaveLength(2);
  expect(controller.getSnapshot().active).toBe('direct');
  expect(controller.getSnapshot().health.backup.state).toBe('unreachable');
});

it('preserves a pinned line on HTTP 502 without fallback', async () => {
  const send = vi.fn<typeof fetch>(async () => new Response('gateway', { status: 502 }));
  const controller = make(send); controller.setMode('direct');
  expect((await controller.fetch('/api/choirs')).status).toBe(502);
  expect(send).toHaveBeenCalledTimes(1);
});
