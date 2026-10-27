import { afterEach, expect, it, vi } from 'vitest';
import { ConnectionController } from './controller';
import { observeHealth } from './sampling';

const origins = { direct: 'https://app.test', backup: 'https://alt.test' };
const make = (send: typeof fetch) => new ConnectionController({ origins, pageOrigin: origins.direct, send });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it('samples only health, keeps bounded discrete history, and never changes manual routing or identity', async () => {
  const send = vi.fn<typeof fetch>(async () => Response.json({ status: 'ok' }));
  const controller = make(send);
  controller.setMode('backup');
  for (let i = 0; i < 24; i++) await controller.sample(new AbortController().signal);
  expect(send).toHaveBeenCalledTimes(48);
  expect(send.mock.calls.every(([url, init]) => String(url).endsWith('/health') && !init?.method)).toBe(true);
  expect(controller.getSnapshot()).toMatchObject({ active: 'backup', identity: { direct: 'unknown', backup: 'unknown' } });
  expect(controller.getSnapshot().samples.direct).toHaveLength(20);
  send.mockImplementation(async url => Response.json(String(url).endsWith('/status') ? { sessionId: null } : { ok: true }));
  await controller.fetch('/api/scores');
  expect(controller.getSnapshot().samples.direct).toHaveLength(20);
});

it('bounds slow headers and bodies, coalesces rounds, and ignores cancelled or old identity responses', async () => {
  vi.useFakeTimers();
  vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => {
    const timeout = new AbortController();
    setTimeout(() => timeout.abort(new DOMException('deadline', 'TimeoutError')), ms);
    return timeout.signal;
  });
  const send = vi.fn<typeof fetch>(() => new Promise(() => {}));
  const controller = make(send);
  const abort = new AbortController();
  const first = controller.sample(abort.signal);
  expect(controller.sample(abort.signal)).toBe(first);
  await vi.advanceTimersByTimeAsync(3000);
  await first;
  expect(controller.getSnapshot().samples.direct[0].state).toBe('unreachable');
  send.mockImplementation(async () => ({ ok: true, json: () => new Promise(() => {}) }) as Response);
  const body = controller.sample(abort.signal);
  await vi.advanceTimersByTimeAsync(3000); await body;
  expect(controller.getSnapshot().samples.backup).toHaveLength(2);
  const old = controller.sample(abort.signal);
  controller.invalidateIdentity('new');
  await vi.advanceTimersByTimeAsync(3000); await old;
  expect(controller.getSnapshot().samples.backup).toHaveLength(2);
  const cancelled = controller.sample(abort.signal); abort.abort(); await cancelled;
  expect(controller.getSnapshot().samples.backup).toHaveLength(2);
});

it('schedules after completion, slows stable rounds, stops on close and refreshes after visibility resumes', async () => {
  vi.useFakeTimers();
  const visibility = new EventTarget() as Document;
  Object.defineProperty(visibility, 'hidden', { value: false, writable: true });
  const send = vi.fn<typeof fetch>(async () => Response.json({ status: 'ok' }));
  const controller = make(send);
  const stop = observeHealth(controller, visibility);
  await vi.advanceTimersByTimeAsync(0); expect(send).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(20_000); expect(send).toHaveBeenCalledTimes(6);
  await vi.advanceTimersByTimeAsync(29_999); expect(send).toHaveBeenCalledTimes(6);
  await vi.advanceTimersByTimeAsync(1); expect(send).toHaveBeenCalledTimes(8);
  Object.defineProperty(visibility, 'hidden', { value: true }); visibility.dispatchEvent(new Event('visibilitychange'));
  await vi.advanceTimersByTimeAsync(120_000); expect(send).toHaveBeenCalledTimes(8);
  Object.defineProperty(visibility, 'hidden', { value: false }); visibility.dispatchEvent(new Event('visibilitychange'));
  await vi.advanceTimersByTimeAsync(0); expect(send).toHaveBeenCalledTimes(10);
  stop(); await vi.advanceTimersByTimeAsync(120_000); expect(send).toHaveBeenCalledTimes(10);
  const stopAgain = observeHealth(controller, visibility);
  await vi.advanceTimersByTimeAsync(0); expect(send).toHaveBeenCalledTimes(12); stopAgain();
});

it('does not overlap pending rounds when hidden and reopened rapidly', async () => {
  vi.useFakeTimers();
  const send = vi.fn<typeof fetch>((_url, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })));
  const controller = make(send);
  const visibility = new EventTarget() as Document;
  Object.defineProperty(visibility, 'hidden', { value: false, writable: true });
  const stop = observeHealth(controller, visibility);
  await vi.advanceTimersByTimeAsync(1000); expect(send).toHaveBeenCalledTimes(2);
  Object.defineProperty(visibility, 'hidden', { value: true }); visibility.dispatchEvent(new Event('visibilitychange'));
  Object.defineProperty(visibility, 'hidden', { value: false }); visibility.dispatchEvent(new Event('visibilitychange'));
  await vi.advanceTimersByTimeAsync(0); expect(send).toHaveBeenCalledTimes(4);
  stop();
  const again = observeHealth(controller, visibility);
  await vi.advanceTimersByTimeAsync(0); expect(send).toHaveBeenCalledTimes(6);
  again(); await vi.advanceTimersByTimeAsync(0);
  expect(controller.getSnapshot().samples.direct).toHaveLength(0);
});

it('does not turn a transient healthy sample into automatic recovery or reset business failure cooldown', async () => {
  let healthy = true;
  const controller = make(async () => healthy ? Response.json({ status: 'ok' }) : Promise.reject(new TypeError('offline')));
  controller.reportFailure('direct'); controller.setMode('auto');
  await controller.sample(new AbortController().signal);
  expect(controller.getSnapshot().active).toBe('backup');
  healthy = false; await controller.sample(new AbortController().signal);
  expect(controller.getSnapshot().active).toBe('backup');
  expect(controller.getSnapshot().health.direct.state).toBe('unreachable');
  expect(controller.getSnapshot().samples.direct.map(sample => sample.state)).toEqual(['reachable', 'unreachable']);
});
