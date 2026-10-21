import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ShellRecovery } from './shell-recovery';
import { holdUpdate, setUpdateRoute } from './update-safety';

let reply: unknown;
let recovery: ShellRecovery;
let reload: ReturnType<typeof vi.fn<() => void>>;
beforeEach(() => {
  vi.useFakeTimers(); sessionStorage.clear();
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { controller: {
    postMessage: (_message: unknown, ports: { receive: (data: unknown) => void }[]) => ports[0].receive(reply),
  } } });
  vi.stubGlobal('MessageChannel', class {
    port1 = { onmessage: null as ((event: { data: unknown }) => void) | null, close: vi.fn() };
    port2 = { receive: (data: unknown) => this.port1.onmessage?.({ data }) };
  });
  setUpdateRoute('/drives'); vi.advanceTimersByTime(3001);
  reply = { available: false, activeReady: true, activeBuild: 'abcdef1' };
  reload = vi.fn<() => void>(); recovery = new ShellRecovery(reload);
});
afterEach(() => { recovery.dispose(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it('defers a lost-shell reload until guarded navigation leaves the reader and local work finishes', async () => {
  setUpdateRoute('/choirs/test/scores/score');
  const release = holdUpdate();
  await recovery.check(); recovery.tick(); expect(reload).not.toHaveBeenCalled();
  setUpdateRoute('/choirs/test'); vi.advanceTimersByTime(3001);
  recovery.tick(); expect(reload).not.toHaveBeenCalled();
  release(); recovery.tick(); expect(reload).toHaveBeenCalledOnce();
  recovery.tick(); expect(reload).toHaveBeenCalledOnce();
});
it('does not reload an intact shell or a missing shell without a verified active replacement', async () => {
  reply = { available: true, activeReady: true, activeBuild: 'abcdef1' };
  await recovery.check(); expect(reload).not.toHaveBeenCalled();
  reply = { available: false, activeReady: false, activeBuild: 'abcdef1' };
  await recovery.check(); recovery.tick(); expect(reload).not.toHaveBeenCalled();
});
it('records the recovery attempt before reloading so another page lifetime cannot loop', async () => {
  await recovery.check(); expect(reload).toHaveBeenCalledOnce();
  expect(sessionStorage.getItem('same-page-shell-recovery:abcdef1')).toBe('attempted');
  recovery.dispose(); recovery = new ShellRecovery(reload);
  await recovery.check(); recovery.tick(); expect(reload).toHaveBeenCalledOnce();
});
it('does not refresh offline or in a hidden window', async () => {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
  await recovery.check(); expect(reload).not.toHaveBeenCalled();
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
  recovery.tick(); expect(reload).not.toHaveBeenCalled();
});
it('does not turn an unresponsive legacy worker into permission to reload', async () => {
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { controller: { postMessage() {} } } });
  const checking = recovery.check();
  await vi.advanceTimersByTimeAsync(1501); await checking;
  expect(reload).not.toHaveBeenCalled();
});
