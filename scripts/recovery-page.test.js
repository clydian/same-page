import { runInNewContext } from 'node:vm';
import { afterEach, expect, test, vi } from 'vitest';
import { recoveryPage } from '../service-worker/recovery-page.ts';

afterEach(() => vi.useRealTimers());

// Execute the exact script served by the worker. No business database is opened
// by the recovery page; only its browser protocol and navigation are simulated.
function fixture() {
  vi.useFakeTimers();
  const button = { disabled: false }, status = { textContent: '' };
  const reload = vi.fn(), messages = [], ports = [];
  class Channel {
    constructor() {
      this.port1 = { onmessage: null, close: vi.fn() };
      this.port2 = { postMessage: data => this.port1.onmessage?.({ data }) };
      ports.push(this.port1);
    }
  }
  const worker = reply => ({ postMessage(message, [port]) {
    messages.push(message);
    reply?.(message, port);
  } });
  const registration = { update: vi.fn(async () => {}), waiting: null, installing: null };
  const serviceWorker = { getRegistration: vi.fn(async () => registration), addEventListener: vi.fn(), controller: null };
  // This is the worker's fixed template, not HTML from a request. Extract its
  // single script by exact delimiters rather than treating a regex as a parser.
  const start = recoveryPage.indexOf('<script>') + '<script>'.length;
  const end = recoveryPage.lastIndexOf('</script>');
  runInNewContext(recoveryPage.slice(start, end), {
    document: { getElementById: id => id === 'retry' ? button : status },
    navigator: { serviceWorker }, location: { reload },
    Date, setTimeout, clearTimeout, MessageChannel: Channel,
  });
  return { button, status, reload, registration, serviceWorker, messages, ports, worker };
}

test('a stalled update releases recovery within its existing twenty-second deadline and ignores late completion', async () => {
  const f = fixture(), oldUpdate = Promise.withResolvers();
  f.registration.update.mockReturnValueOnce(oldUpdate.promise);
  const first = f.button.onclick();
  await vi.advanceTimersByTimeAsync(20_000);
  expect(f.button.disabled).toBe(false);
  expect(f.status.textContent).toContain('重试');
  expect(f.reload).not.toHaveBeenCalled();
  await first;
  await f.button.onclick();
  expect(f.reload).toHaveBeenCalledTimes(1);
  oldUpdate.resolve();
  await vi.advanceTimersByTimeAsync(0);
  expect(f.reload).toHaveBeenCalledTimes(1);
  expect(f.messages).toEqual([]);
});

test('a stalled registration lookup also releases the recovery button', async () => {
  const f = fixture();
  f.serviceWorker.getRegistration.mockReturnValue(new Promise(() => {}));
  const pending = f.button.onclick();
  await vi.advanceTimersByTimeAsync(20_000);
  expect(f.button.disabled).toBe(false);
  expect(f.reload).not.toHaveBeenCalled();
  await pending;
});

test('a candidate veto never reloads or bypasses the safe-update protocol', async () => {
  const f = fixture();
  f.registration.waiting = { state: 'installed', ...f.worker((message, port) => {
    port.postMessage(message.type === 'SAME_PAGE_SHELL_IDENTITY' ? { buildId: 'candidate' } : { safe: false });
  }) };
  await f.button.onclick();
  expect(f.messages.map(message => message.type)).toEqual(['SAME_PAGE_SHELL_IDENTITY', 'SAME_PAGE_SAFE_UPDATE']);
  expect(f.messages[1].requested).toBe(true);
  expect(f.reload).not.toHaveBeenCalled();
  expect(f.button.disabled).toBe(false);
  expect(f.status.textContent).toContain('保存其他窗口');
});

test('handover and identity share the overall deadline, rather than starting a fresh timeout', async () => {
  const f = fixture();
  f.registration.update.mockImplementation(() => new Promise(resolve => setTimeout(resolve, 19_000)));
  f.registration.waiting = { state: 'installed', ...f.worker((message, port) => {
    if (message.type === 'SAME_PAGE_SHELL_IDENTITY') port.postMessage({ buildId: 'candidate' });
  }) };
  const pending = f.button.onclick();
  await vi.advanceTimersByTimeAsync(20_000);
  await pending;
  expect(f.messages.map(message => message.type)).toEqual(['SAME_PAGE_SHELL_IDENTITY', 'SAME_PAGE_SAFE_UPDATE']);
  expect(f.button.disabled).toBe(false);
  expect(f.reload).not.toHaveBeenCalled();
  expect(f.ports.every(port => port.close.mock.calls.length === 1)).toBe(true);
});

test('an approved handover reloads only after the controller confirms the candidate identity', async () => {
  const f = fixture();
  f.registration.waiting = { state: 'installed', ...f.worker((message, port) => {
    port.postMessage(message.type === 'SAME_PAGE_SHELL_IDENTITY' ? { buildId: 'candidate' } : { safe: true });
  }) };
  f.serviceWorker.controller = f.worker((_message, port) => port.postMessage({ buildId: 'candidate' }));
  await f.button.onclick();
  expect(f.messages.map(message => message.type)).toEqual(['SAME_PAGE_SHELL_IDENTITY', 'SAME_PAGE_SAFE_UPDATE', 'SAME_PAGE_SHELL_IDENTITY']);
  expect(f.reload).toHaveBeenCalledTimes(1);
});

test('late candidate identity after timeout cannot request activation during another attempt', async () => {
  const f = fixture();
  let reply;
  f.registration.waiting = { state: 'installed', ...f.worker((_message, port) => { reply = port; }) };
  const pending = f.button.onclick();
  await vi.advanceTimersByTimeAsync(10_000);
  await pending;
  expect(f.button.disabled).toBe(false);
  f.registration.waiting = null;
  await f.button.onclick();
  reply.postMessage({ buildId: 'late-candidate' });
  await vi.advanceTimersByTimeAsync(0);
  expect(f.messages.map(message => message.type)).toEqual(['SAME_PAGE_SHELL_IDENTITY']);
  expect(f.reload).toHaveBeenCalledTimes(1);
  expect(f.ports.every(port => port.close.mock.calls.length === 1)).toBe(true);
});

test('an elapsed deadline between identity and handover never sends an activation request', async () => {
  const f = fixture(), started = Date.now();
  f.registration.waiting = { state: 'installed', ...f.worker((message, port) => {
    if (message.type === 'SAME_PAGE_SHELL_IDENTITY') {
      vi.setSystemTime(started + 19_999);
      port.postMessage({ buildId: 'candidate' });
      // Let within accept the in-time reply, then cross the deadline before
      // the caller continues. The browser message itself stays ordinary data.
      queueMicrotask(() => queueMicrotask(() => vi.setSystemTime(started + 20_001)));
    } else port.postMessage({ safe: true });
  }) };
  await f.button.onclick();
  expect(f.messages.map(message => message.type)).toEqual(['SAME_PAGE_SHELL_IDENTITY']);
  expect(f.button.disabled).toBe(false);
  expect(f.reload).not.toHaveBeenCalled();
});
