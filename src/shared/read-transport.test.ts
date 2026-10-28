import { afterEach, expect, it, vi } from 'vitest';
import { publicAssetReader } from './read-transport';
const origins = { direct: 'https://main.example.test', backup: 'https://backup.example.test' };
const path = '/_releases/' + 'a'.repeat(40) + '/assets/player.js';
const verify = async (response: Response) => await response.clone().text() === 'verified';
afterEach(() => vi.useRealTimers());
it('retries the same immutable resource without credentials after a broken connection or body', async () => {
  for (const bodyFailure of [false, true]) {
    const send = vi.fn<typeof fetch>().mockImplementation(async input => {
      const request = input as Request;
      expect(request).toMatchObject({ credentials: 'omit' }); expect(request.redirect).toBe('error');
      expect(request.headers.has('authorization')).toBe(false);
      if (new URL(request.url).origin === origins.direct) {
        if (!bodyFailure) throw new TypeError('connection lost');
        return new Response(new ReadableStream({ start(controller) { controller.error(new TypeError('body interrupted')); } }));
      }
      return new Response('verified');
    });
    const read = publicAssetReader({ origin: origins.direct, origins, send });
    expect(await (await read(path, verify)).text()).toBe('verified');
    expect(send.mock.calls.map(([input]) => (input as Request).url)).toEqual([origins.direct + path, origins.backup + path]);
    await read(path, verify); // A successful fallback remains preferred for this reader.
    expect((send.mock.calls[2][0] as Request).url).toBe(origins.backup + path);
  }
});
it('bounds stalled downloads and does not wait for an operation that ignores cancellation', async () => {
  vi.useFakeTimers();
  const send = vi.fn<typeof fetch>().mockImplementationOnce(() => new Promise(() => {})).mockResolvedValue(new Response('verified'));
  const read = publicAssetReader({ origin: origins.direct, origins, send, timeoutMs: 100 });
  const result = read(path, verify);
  await vi.advanceTimersByTimeAsync(100);
  expect(await (await result).text()).toBe('verified');
  expect((send.mock.calls[0][0] as Request).signal.aborted).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});
it.each([404, 403, 500])('does not replay an HTTP %i through another route', async status => {
  const send = vi.fn<typeof fetch>().mockResolvedValue(new Response('unavailable', { status }));
  await expect(publicAssetReader({ origin: origins.direct, origins, send })(path, verify)).rejects.toThrow('public_asset_unavailable');
  expect(send).toHaveBeenCalledTimes(1);
});
it('rejects wrong bytes instead of accepting a different version from another route', async () => {
  const send = vi.fn<typeof fetch>().mockResolvedValue(new Response('other version'));
  await expect(publicAssetReader({ origin: origins.direct, origins, send })(path, verify)).rejects.toThrow('public_asset_integrity');
  expect(send).toHaveBeenCalledTimes(1);
});
it('honors caller cancellation without fallback, including during an unresponsive read', async () => {
  const controller = new AbortController();
  const send = vi.fn<typeof fetch>().mockImplementation(() => new Promise(() => {}));
  const result = publicAssetReader({ origin: origins.direct, origins, send })(path, verify, controller.signal);
  controller.abort();
  await expect(result).rejects.toMatchObject({ name: 'AbortError' });
  expect(send).toHaveBeenCalledTimes(1);
});
it('keeps mutable paths on the page origin and rejects arbitrary external origins', async () => {
  const send = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('offline'));
  const read = publicAssetReader({ origin: origins.direct, origins, send });
  for (const url of ['/api/client-release', '/sw.js', '/assets/legacy.js']) await expect(read(url, verify)).rejects.toThrow('offline');
  await expect(read('https://evil.test' + path, verify)).rejects.toThrow('invalid_public_asset_origin');
  expect(send.mock.calls.map(([input]) => new URL((input as Request).url).origin)).toEqual(Array(3).fill(origins.direct));
});
it('respects an explicitly pinned route', async () => {
  const send = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('offline'));
  const read = publicAssetReader({ origin: origins.direct, origins, send, routes: () => ['backup'] });
  await expect(read(path, verify)).rejects.toThrow('offline');
  expect(send).toHaveBeenCalledTimes(1);
  expect((send.mock.calls[0][0] as Request).url).toBe(origins.backup + path);
});
