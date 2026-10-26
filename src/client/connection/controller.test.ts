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

it.each([401, 403, 404, 409, 429, 502, 503])('does not change route for an HTTP %s response', async status => {
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
    return Response.json({ sessionId: 'expected' });
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
  const send = vi.fn<typeof fetch>(async (_input, init) => {
    expect(new Headers(init?.headers).get('X-Same-Page-Session')).toBe('expected');
    return Response.json({ error: 'entry_identity_conflict' }, { status: 409, headers: { 'X-Same-Page-Entry-Conflict': '1' } });
  });
  const controller = make(send, { sessionId: 'expected' });
  // A native file uses the same non-secret guard; it is not an auth token.
  expect(controller.nativeEndpoint('/api/file')).toContain('/connection/unprepared');
  expect((await controller.fetch('/api/auth/get-session')).status).toBe(409);
  expect(controller.getSnapshot().identity.direct).toBe('conflict');
});
