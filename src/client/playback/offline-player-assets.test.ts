import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { offlinePlayerAssetsReady, prepareOfflinePlayerAssets } from './offline-player-assets';

let respond: (value: unknown) => void;
let worker: { postMessage: ReturnType<typeof vi.fn> };
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('MessageChannel', class {
    port1 = { onmessage: null as null | ((event: { data: unknown }) => void), close: vi.fn() };
    port2 = { reply: (data: unknown) => this.port1.onmessage?.({ data }) };
  });
  worker = { postMessage: vi.fn((_message, ports) => { respond = ports[0].reply; }) };
  vi.stubGlobal('navigator', { serviceWorker: { getRegistration: async () => ({ active: worker }) } });
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('page_must_not_download_player'); }));
  vi.stubGlobal('caches', { open: vi.fn(() => { throw new Error('page_must_not_duplicate_player'); }) });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it('uses the matching complete release receipt without a second download or player cache', async () => {
  const ready = offlinePlayerAssetsReady();
  await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalled());
  expect(worker.postMessage.mock.calls[0][0]).toEqual({ type: 'SAME_PAGE_PLAYBACK_READY', buildId: 'development' });
  respond({ buildId: 'development' });
  expect(await ready).toBe(true);
  expect(fetch).not.toHaveBeenCalled(); expect(caches.open).not.toHaveBeenCalled();
});
it.each([null, { buildId: 'previous' }])('rejects missing or other-build readiness: %j', async reply => {
  const ready = offlinePlayerAssetsReady();
  await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalled());
  respond(reply); expect(await ready).toBe(false);
});
it('audits again on each independent read rather than trusting a permanent ready flag', async () => {
  worker.postMessage.mockImplementation((_message, ports) => ports[0].reply({ buildId: 'development' }));
  expect(await offlinePlayerAssetsReady()).toBe(true);
  worker.postMessage.mockImplementation((_message, ports) => ports[0].reply(null));
  expect(await offlinePlayerAssetsReady()).toBe(false);
  await expect(prepareOfflinePlayerAssets()).rejects.toThrow('playback_assets_incomplete');
});
it('bounds an unresponsive worker and handles absent registration or postMessage failure', async () => {
  const ready = offlinePlayerAssetsReady();
  await vi.advanceTimersByTimeAsync(20_001); expect(await ready).toBe(false);
  worker.postMessage.mockImplementation(() => { throw new Error('closing'); });
  expect(await offlinePlayerAssetsReady()).toBe(false);
  vi.stubGlobal('navigator', {}); expect(await offlinePlayerAssetsReady()).toBe(false);
});
it('cancellation stops this caller without preventing a later readiness check', async () => {
  const controller = new AbortController();
  const pending = prepareOfflinePlayerAssets(controller.signal);
  const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalled());
  controller.abort(); await rejected;
  respond({ buildId: 'development' });
  worker.postMessage.mockImplementation((_message, ports) => ports[0].reply({ buildId: 'development' }));
  await prepareOfflinePlayerAssets();
});
