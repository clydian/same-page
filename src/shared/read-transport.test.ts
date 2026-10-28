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
it.each([401, 403, 404, 409, 429, 500, 503])('does not replay an HTTP %i through another route', async status => {
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

it('never treats a validator TypeError as a network failure', async () => {
  const send = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ buildId: 'a'.repeat(40), entries: [null] }));
  const { parsePlaybackManifest } = await import('./playback-assets');
  const read = publicAssetReader({ origin: origins.direct, origins, send });
  await expect(read(path, async response => {
    parsePlaybackManifest(await response.json(), 'a'.repeat(40));
    return true;
  })).rejects.toThrow('public_asset_integrity');
  expect(send).toHaveBeenCalledTimes(1);
});

it('rejects resource paths belonging to another release or playback build while retaining legacy paths', async () => {
  const { parsePlaybackManifest } = await import('./playback-assets');
  const id = 'a'.repeat(40), other = 'b'.repeat(40);
  const entry = (url: string) => ({url,bytes:1,integrity:'sha256-'+ 'A'.repeat(43)+'='});
  const paths = ['/assets/musicxml-player-one.js','/assets/prepare.worker-one.js',`/playback/${id}/soundfont/sonivox.sf2`];
  const manifest = {buildId:id,entries:paths.map(entry)};
  expect(parsePlaybackManifest(manifest,id)).toEqual(manifest);
  expect(() => parsePlaybackManifest({...manifest,entries:paths.map(url=>entry(`/_releases/${other}${url}`))},id)).toThrow('invalid_playback_manifest');
  expect(() => parsePlaybackManifest({...manifest,entries:[...manifest.entries.slice(0,2),entry(`/playback/${other}/soundfont/sonivox.sf2`)]},id)).toThrow('invalid_playback_manifest');
  const fixed = {...manifest,entries:paths.map(url=>entry(`/_releases/${id}${url}`))};
  expect(parsePlaybackManifest(fixed,id)).toEqual(fixed);
});

it('does not retry validator implementation errors through another origin', async () => {
  const send = vi.fn<typeof fetch>().mockImplementation(async () => new Response('verified'));
  await expect(publicAssetReader({ origin: origins.direct, origins, send })(path, async () => { throw new TypeError('invalid structure'); })).rejects.toThrow('public_asset_integrity');
  expect(send).toHaveBeenCalledTimes(1);
});

it.each([502, 504])('tries the alternate immutable route once for HTTP %i', async status => {
  const send = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('gateway', { status })).mockResolvedValueOnce(new Response('verified'));
  const response = await publicAssetReader({ origin: origins.direct, origins, send })(path, verify);
  expect(await response.text()).toBe('verified');
  expect(send).toHaveBeenCalledTimes(2);
});

it('reserves the remaining manifest budget after headers succeed but the body stalls', async () => {
  vi.useFakeTimers();
  const caller = new AbortController();
  let cancelled = false;
  const send = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode('partial')); },
    cancel() { cancelled = true; },
  }))).mockResolvedValueOnce(new Response('verified'));
  const read = publicAssetReader({ origin: origins.direct, origins, send });
  const outcome = read(path, verify, caller.signal, 'manifest').then(response => response.text(), error => error);
  try {
    await vi.advanceTimersByTimeAsync(6000);
    expect(send).toHaveBeenCalledTimes(2);
    expect(cancelled).toBe(true);
    expect(await outcome).toBe('verified');
    expect(vi.getTimerCount()).toBe(0);
  } finally { caller.abort(); await outcome; }
});

it('abandons a body with no progress for ten seconds and cancels the old stream', async () => {
  vi.useFakeTimers();
  const caller = new AbortController();
  let cancelled = false;
  const send = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(new ReadableStream({ cancel() { cancelled = true; } })))
    .mockResolvedValueOnce(new Response('verified'));
  const outcome = publicAssetReader({ origin: origins.direct, origins, send })(path, verify, caller.signal).then(response => response.text(), error => error);
  try {
    await vi.advanceTimersByTimeAsync(10_000);
    expect(send).toHaveBeenCalledTimes(2);
    expect(cancelled).toBe(true);
    expect(await outcome).toBe('verified');
  } finally { caller.abort(); await outcome; }
});

it('allows a slow body to continue while bytes arrive within the idle deadline', async () => {
  vi.useFakeTimers();
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  const send = vi.fn<typeof fetch>().mockResolvedValue(new Response(new ReadableStream({ start(controller) { stream = controller; } })));
  const outcome = publicAssetReader({ origin: origins.direct, origins, send })(path, async response => await response.text() === 'abc');
  for (const character of 'abc') {
    await vi.advanceTimersByTimeAsync(6000);
    stream.enqueue(new TextEncoder().encode(character));
    await vi.advanceTimersByTimeAsync(0);
  }
  stream.close();
  expect(await (await outcome).text()).toBe('abc');
  expect(send).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

it('keeps two stalled manifest bodies within one fifteen-second budget', async () => {
  vi.useFakeTimers();
  let cancelled = 0;
  const send = vi.fn<typeof fetch>().mockImplementation(async () => new Response(new ReadableStream({ cancel() { cancelled++; } })));
  const outcome = publicAssetReader({ origin: origins.direct, origins, send })(path, verify, undefined, 'manifest').then(() => null, error => error);
  await vi.advanceTimersByTimeAsync(6000);
  expect(send).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(9000);
  expect(await outcome).toMatchObject({ name: 'TimeoutError' });
  expect(cancelled).toBe(2);
  expect(vi.getTimerCount()).toBe(0);
});

it('lets a pinned manifest use the full budget without scheduling another route', async () => {
  vi.useFakeTimers();
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  const send = vi.fn<typeof fetch>().mockResolvedValue(new Response(new ReadableStream({ start(controller) { stream = controller; } })));
  const outcome = publicAssetReader({ origin: origins.direct, origins, send, routes: () => ['direct'] })(path, verify, undefined, 'manifest').then(response => response, error => error);
  await vi.advanceTimersByTimeAsync(12_000);
  stream.enqueue(new TextEncoder().encode('verified')); stream.close();
  expect(await (await outcome).text()).toBe('verified');
  expect(send).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

it('does not treat empty chunks as download progress or await a stalled cancel', async () => {
  vi.useFakeTimers();
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  let cancelled = false;
  const send = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(new ReadableStream({
    start(controller) { stream = controller; },
    cancel() { cancelled = true; return new Promise(() => {}); },
  }))).mockResolvedValueOnce(new Response('verified'));
  const outcome = publicAssetReader({ origin: origins.direct, origins, send })(path, verify);
  await vi.advanceTimersByTimeAsync(6000);
  stream.enqueue(new Uint8Array());
  await vi.advanceTimersByTimeAsync(4000);
  expect(await (await outcome).text()).toBe('verified');
  expect(cancelled).toBe(true);
  expect(send).toHaveBeenCalledTimes(2);
});

it('cancels the active body immediately on caller cancellation without fallback', async () => {
  const caller = new AbortController();
  let cancelled = false;
  const send = vi.fn<typeof fetch>().mockResolvedValue(new Response(new ReadableStream({ cancel() { cancelled = true; } })));
  const outcome = publicAssetReader({ origin: origins.direct, origins, send })(path, verify, caller.signal).then(() => null, error => error);
  await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
  await Promise.resolve();
  caller.abort();
  expect(await outcome).toMatchObject({ name: 'AbortError' });
  await vi.waitFor(() => expect(cancelled).toBe(true));
  expect(send).toHaveBeenCalledTimes(1);
});

it.each([502, 504])('keeps a pinned gateway HTTP %i on its chosen line', async status => {
  const send = vi.fn<typeof fetch>().mockImplementation(async () => new Response('gateway', { status }));
  await expect(publicAssetReader({ origin: origins.direct, origins, send, routes: () => ['direct'] })(path, verify)).rejects.toThrow('public_asset_unavailable');
  expect(send).toHaveBeenCalledTimes(1);
});
