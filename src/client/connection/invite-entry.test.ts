import { afterEach, expect, it, vi } from 'vitest';
import { enterDrive } from '../auth/drive-entry';
import { ConnectionController } from './controller';

const origins = { direct: 'https://app.same-page.test', backup: 'https://alt.same-page.test' };
const choir = { id: 'invited-drive', name: '受邀云盘', guestAdmissionMode: 'invite' as const };
const success = () => Response.json({ choir, entryKind: 'admission' });
const path = (input: RequestInfo | URL) => new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url).pathname;
const pending = (signal: AbortSignal) => new Promise<Response>((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
function partial(signal: AbortSignal) {
  return new Response(new ReadableStream({ start(controller) {
    controller.enqueue(new TextEncoder().encode('{"choir":'));
    signal.addEventListener('abort', () => controller.error(signal.reason), { once: true });
  } }), { headers: { 'content-type': 'application/json' } });
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it.each(['headers', 'body'])('邀请码进入在直连 %s 卡住后换备用，完整读取结果后继续进入', async stage => {
  vi.useFakeTimers();
  const cancel = new AbortController();
  const send = vi.fn<typeof fetch>(async (input, init) => path(input).includes('/direct/')
    ? stage === 'headers' ? pending(init!.signal!) : partial(init!.signal!) : success());
  const controller = new ConnectionController({ origins, pageOrigin: origins.direct, send });
  vi.stubGlobal('fetch', controller.fetch);
  let result: Awaited<ReturnType<typeof enterDrive>> | undefined;
  const request = enterDrive({ admission: 'invite', joinCode: 'ABCDEFGH' }, false, cancel.signal).then(value => { result = value; });
  try {
    await vi.advanceTimersByTimeAsync(4001);
    expect(result).toEqual({ kind: 'enter', choir });
    expect(controller.getSnapshot().active).toBe('backup');
    expect(send.mock.calls.map(([input]) => path(input))).toEqual(['/api/_entry/direct/guest/session', '/api/_entry/backup/guest/session']);
    expect(send.mock.calls.every(([, init]) => JSON.parse(init!.body as string).joinCode === 'ABCDEFGH')).toBe(true);
  } finally { cancel.abort(); await request; }
});

it('两条验证线路都不响应时结束等待', async () => {
  vi.useFakeTimers();
  const cancel = new AbortController();
  const send = vi.fn<typeof fetch>(async (_input, init) => pending(init!.signal!));
  const controller = new ConnectionController({ origins, pageOrigin: origins.direct, send });
  vi.stubGlobal('fetch', controller.fetch);
  let result: Awaited<ReturnType<typeof enterDrive>> | undefined;
  const request = enterDrive({ admission: 'invite', joinCode: 'ABCDEFGH' }, false, cancel.signal).then(value => { result = value; });
  try {
    await vi.advanceTimersByTimeAsync(9001);
    expect(result).toMatchObject({ kind: 'failed', restart: false });
    expect(send).toHaveBeenCalledTimes(2);
  } finally { cancel.abort(); await request; }
});

it.each([400, 403, 429, 503])('验证返回 %s 时保留业务错误，不切线重试', async status => {
  const send = vi.fn<typeof fetch>(async () => new Response(null, { status }));
  const controller = new ConnectionController({ origins, pageOrigin: origins.direct, send });
  vi.stubGlobal('fetch', controller.fetch);
  expect(await enterDrive({ admission: 'invite', joinCode: 'ABCDEFGH' }, false)).toMatchObject({ kind: 'failed' });
  expect(send).toHaveBeenCalledTimes(1);
});

it('手动固定直连时验证超时也不尝试备用', async () => {
  vi.useFakeTimers();
  const send = vi.fn<typeof fetch>(async (_input, init) => pending(init!.signal!));
  const controller = new ConnectionController({ origins, pageOrigin: origins.direct, send });
  controller.setMode('direct');
  vi.stubGlobal('fetch', controller.fetch);
  const request = enterDrive({ admission: 'invite', joinCode: 'ABCDEFGH' }, false);
  await vi.advanceTimersByTimeAsync(4001);
  expect(await request).toMatchObject({ kind: 'failed', restart: false, message: expect.stringContaining('连接超时') });
  expect(send).toHaveBeenCalledTimes(1);
});

it('调用方取消时结束不配合取消的请求，也不尝试备用', async () => {
  const send = vi.fn<typeof fetch>(() => new Promise(() => undefined));
  const controller = new ConnectionController({ origins, pageOrigin: origins.direct, send });
  vi.stubGlobal('fetch', controller.fetch);
  const cancel = new AbortController();
  const request = enterDrive({ admission: 'invite', joinCode: 'ABCDEFGH' }, false, cancel.signal);
  cancel.abort();
  expect(await request).toMatchObject({ kind: 'failed', restart: false });
  expect(send).toHaveBeenCalledTimes(1);
  expect(controller.getSnapshot().health.direct.state).toBe('unknown');
});

it('完整但无效的响应不当成网络故障重试', async () => {
  const send = vi.fn<typeof fetch>(async () => Response.json({ choir: { id: 'missing-fields' } }));
  const controller = new ConnectionController({ origins, pageOrigin: origins.direct, send });
  vi.stubGlobal('fetch', controller.fetch);
  expect(await enterDrive({ admission: 'invite', joinCode: 'ABCDEFGH' }, false)).toMatchObject({ kind: 'failed' });
  expect(send).toHaveBeenCalledTimes(1);
});

it('验证后已登录用户的后续状态读取也受九秒总预算约束', async () => {
  vi.useFakeTimers();
  const send = vi.fn<typeof fetch>(async input => path(input).endsWith('/guest/session') ? success() : new Promise(() => undefined));
  const controller = new ConnectionController({ origins, pageOrigin: origins.direct, send });
  vi.stubGlobal('fetch', controller.fetch);
  const request = enterDrive({ admission: 'invite', joinCode: 'ABCDEFGH' }, true);
  await vi.advanceTimersByTimeAsync(9001);
  expect(await request).toMatchObject({ kind: 'failed', restart: false, message: expect.stringContaining('连接超时') });
  expect(send.mock.calls.every(([input]) => !path(input).endsWith('/join-current-guest'))).toBe(true);
});

it('过期登录转为明确的访客进入后，两路准备继续且不带旧身份', async () => {
  const changedIdentity = vi.fn();
  const send = vi.fn<typeof fetch>(async input => path(input).endsWith('/connection/status') ? Response.json({ sessionId: null }) : success());
  const controller = new ConnectionController({ origins, pageOrigin: origins.direct, send, sessionId: 'expired', changedIdentity });
  vi.stubGlobal('fetch', controller.fetch);
  expect(await enterDrive({ admission: 'invite', joinCode: 'ABCDEFGH' }, false)).toEqual({ kind: 'enter', choir });
  expect(changedIdentity).toHaveBeenCalledWith(null);
  expect(controller.getSnapshot().identity.direct).toBe('ready');
  expect(new URL(controller.nativeEndpoint('/api/choirs/invited-drive/files')).searchParams.get('_sp_session')).toBe('none');
  const backup = send.mock.calls.find(([input]) => path(input) === '/api/_entry/backup/guest/session');
  expect(backup).toBeDefined();
  expect(backup![1]!.signal!.aborted).toBe(false);
});

it('Request 对象的验证正文能在备用线路原样重发', async () => {
  const bodies: string[] = [];
  const send = vi.fn<typeof fetch>(async (input, init) => {
    bodies.push(await (input as Request).text());
    if (path(input).includes('/direct/')) throw new TypeError('network');
    expect(init!.signal!.aborted).toBe(false);
    return success();
  });
  const controller = new ConnectionController({ origins, pageOrigin: origins.direct, send });
  const body = JSON.stringify({ admission: 'invite', joinCode: 'ABCDEFGH' });
  const request = new Request(`${origins.direct}/api/guest/session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
  const response = await controller.fetch(request);
  expect(await response.json()).toEqual({ choir, entryKind: 'admission' });
  expect(bodies).toEqual([body, body]);
});

it('已取消的新验证不打断正在进行的有效验证', async () => {
  let finish!: (value: Response) => void;
  const send = vi.fn<typeof fetch>(() => new Promise(resolve => { finish = resolve; }));
  const controller = new ConnectionController({ origins, pageOrigin: origins.direct, send });
  const first = controller.fetch('/api/guest/session', { method: 'POST', body: '{}' });
  await expect(controller.fetch('/api/guest/session', { method: 'POST', body: '{}', signal: AbortSignal.abort() })).rejects.toMatchObject({ name: 'AbortError' });
  finish(success());
  expect((await first).ok).toBe(true);
});

it('迟到的旧访客清理不能再删除新准入的备用凭证', async () => {
  let finishCleanup!: (value: Response) => void;
  const send = vi.fn<typeof fetch>(async (_input, init) => init?.method === 'DELETE'
    ? new Promise(resolve => { finishCleanup = resolve; }) : success());
  const controller = new ConnectionController({ origins, pageOrigin: origins.direct, send });
  const cancel = new AbortController();
  const oldCleanup = controller.fetch('/api/guest/session', { method: 'DELETE', signal: cancel.signal });
  cancel.abort();
  expect((await controller.fetch('/api/guest/session', { method: 'POST', body: '{}' })).ok).toBe(true);
  finishCleanup(new Response(null, { status: 204 }));
  await oldCleanup;
  expect(send.mock.calls.map(([input, init]) => `${init?.method} ${path(input)}`)).toEqual([
    'DELETE /api/_entry/direct/guest/session', 'POST /api/_entry/direct/guest/session', 'POST /api/_entry/backup/guest/session',
  ]);
});
