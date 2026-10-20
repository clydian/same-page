import { afterEach, expect, test, vi } from 'vitest';
import { observeShellLifecycleCalls } from './shell-lifecycle-observation.mjs';
afterEach(() => vi.unstubAllGlobals());
function fixture() {
  const records = [], receiver = [], argument = [], promise = Promise.resolve(true);
  class Registration { unregister(...args) { receiver.push(this); argument.push(args); return promise; } update() { return promise; } }
  class Container { register() { return promise; } }
  vi.stubGlobal('ServiceWorkerRegistration', Registration); vi.stubGlobal('ServiceWorkerContainer', Container);
  vi.stubGlobal('navigator', { serviceWorker: { addEventListener() {} } }); vi.stubGlobal('location', { pathname: '/about' });
  vi.stubGlobal('__ownedShellProbe', async record => { records.push(record); });
  observeShellLifecycleCalls('__ownedShellProbe');
  return { records, receiver, argument, promise, Registration, Container };
}
test('fixture observer preserves native receiver, exact arguments and promise identity', async () => {
  const f = fixture(), registration = new f.Registration(), value = {};
  expect(registration.unregister(value)).toBe(f.promise); expect(f.receiver).toEqual([registration]); expect(f.argument).toEqual([[value]]);
  expect(await f.promise).toBe(true); await Promise.resolve();
  expect(f.records.map(value => value.call ?? value.resolved)).toEqual(['unregister', 'unregister']);
});
test('fixture observer preserves rejection and does not create an unhandled rejection', async () => {
  const reason = new Error('owned rejection'); class Registration { update() { return Promise.reject(reason); } }
  vi.stubGlobal('ServiceWorkerRegistration', Registration); vi.stubGlobal('ServiceWorkerContainer', undefined);
  vi.stubGlobal('navigator', { serviceWorker: { addEventListener() {} } }); vi.stubGlobal('location', { pathname: '/about' });
  const records = []; vi.stubGlobal('__ownedShellProbe', async record => { records.push(record); });
  observeShellLifecycleCalls('__ownedShellProbe'); await expect(new Registration().update()).rejects.toBe(reason); await Promise.resolve();
  expect(records.at(-1)).toMatchObject({ rejected: 'update', error: 'Error: owned rejection' });
});
test('fixture observer logging failure cannot replace the native result', async () => {
  const f = fixture(); vi.stubGlobal('__ownedShellProbe', () => { throw new Error('observer failure'); });
  expect(new f.Registration().unregister()).toBe(f.promise); await f.promise;
});
