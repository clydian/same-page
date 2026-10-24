import { expect, it } from 'vitest';
import { releaseRequest } from './release-request.mjs';

it('recovers a timed out token verification without changing endpoint or exposing credentials', async () => {
 const calls = [], warnings = [];
 const result = await releaseRequest('Cloudflare user token verification', 'https://example.test/verify', {
  init: { headers: { Authorization: 'Bearer private-token' } },
  fetchImpl: async (url, init) => {
   calls.push({ url, init });
   if (calls.length === 1) throw new DOMException('private-token', 'TimeoutError');
   return Response.json({ active: true });
  }, read: response => response.json(), retryRead: true, sleep: async () => {}, warn: message => warnings.push(message),
 });
 expect(result).toEqual({ active: true });
 expect(calls).toHaveLength(2);
 expect(calls[0].init.signal).not.toBe(calls[1].init.signal);
 expect(warnings.join()).toContain('Cloudflare user token verification');
 expect(warnings.join()).not.toContain('private-token');
});

it('retries a failed response body, with a fresh request and full byte verification by its caller', async () => {
 let calls = 0;
 const bytes = await releaseRequest('candidate asset', 'https://example.test/asset', {
  retryRead: true, sleep: async () => {}, warn: () => {},
  fetchImpl: async () => ++calls === 1 ? new Response(new ReadableStream({ start(controller) { controller.error(new TypeError('terminated')); } })) : new Response('sealed bytes'),
  read: response => response.arrayBuffer(),
 });
 expect(new TextDecoder().decode(bytes)).toBe('sealed bytes');
 expect(calls).toBe(2);
});

it.each([429, 500, 502, 503, 504])('retries transient HTTP %s on an explicitly safe read', async status => {
 let calls = 0;
 await releaseRequest('catalog read', 'https://example.test/query', {
  init: { method: 'POST' }, retryRead: true, sleep: async () => {}, warn: () => {},
  fetchImpl: async () => ++calls === 1 ? new Response('private body', { status }) : Response.json({ ok: true }),
  read: response => response.json(),
 });
 expect(calls).toBe(2);
});

it.each([400, 401, 403, 404])('returns permanent HTTP %s for caller validation without retry', async status => {
 let calls = 0;
 const result = await releaseRequest('token read', 'https://example.test', {
  retryRead: true, fetchImpl: async () => { calls++; return new Response(null, { status }); }, read: response => response.status,
 });
 expect(result).toBe(status); expect(calls).toBe(1);
});

it('fails closed after three attempts with safe request context', async () => {
 let calls = 0;
 await expect(releaseRequest('candidate soundfont', 'https://example.test', {
  retryRead: true, sleep: async () => {}, warn: () => {},
  fetchImpl: async () => { calls++; throw new DOMException('secret', 'TimeoutError'); }, read: response => response.text(),
 })).rejects.toThrow('candidate soundfont failed after 3 attempts (TimeoutError)');
 expect(calls).toBe(3);
});

it('never retries a mutation when its response is lost', async () => {
 let calls = 0;
 await expect(releaseRequest('catalog write', 'https://example.test/query', {
  init: { method: 'POST' }, fetchImpl: async () => { calls++; throw new TypeError('secret'); }, read: response => response.json(),
 })).rejects.toThrow('catalog write failed after 1 attempt (TypeError)');
 expect(calls).toBe(1);
});

it('does not retry invalid JSON or caller integrity checks', async () => {
 let calls = 0;
 await expect(releaseRequest('catalog read', 'https://example.test', {
  retryRead: true, fetchImpl: async () => { calls++; return new Response('secret'); }, read: response => response.json(),
 })).rejects.toThrow('catalog read failed after 1 attempt (SyntaxError)');
 expect(calls).toBe(1);
});

it('keeps the timeout active through a real HTTP response body', async () => {
 const { createServer } = await import('node:http');
 const { once } = await import('node:events');
 let calls = 0;
 const server = createServer((_request, response) => {
  calls++;
  response.writeHead(200);
  if (calls === 1) { response.write('unfinished'); return; }
  response.end('complete bytes');
 });
 server.listen(0, '127.0.0.1');
 await once(server, 'listening');
 try {
  const bytes = await releaseRequest('candidate download', `http://127.0.0.1:${server.address().port}`, {
   retryRead: true, timeoutMs: 100, sleep: async () => {}, warn: () => {}, read: response => response.text(),
  });
  expect(bytes).toBe('complete bytes'); expect(calls).toBe(2);
 } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

it('retries complete R2 reads after body failure and labels persistent SDK failures', async () => {
 const {readReleaseObject} = await import('./release-request.mjs');
 const {Readable} = await import('node:stream');
 let calls = 0;
 const object = await readReleaseObject('releases/sha/sealed.json', async () => {
  calls++;
  const Body = calls === 1 ? new Readable({read() { this.destroy(Object.assign(new Error('secret'), {code:'ECONNRESET'})); }}) : Readable.from(['sealed bytes']);
  return {Body};
 }, {sleep:async () => {},warn:() => {}});
 expect(new TextDecoder().decode(await object.arrayBuffer())).toBe('sealed bytes');
 expect(calls).toBe(2);
 await expect(readReleaseObject('compatibility/report.json', async () => {
  throw Object.assign(new Error('private token'), {$metadata:{httpStatusCode:503}});
 }, {sleep:async () => {},warn:() => {}})).rejects.toThrow('R2 release object compatibility/report.json failed after 3 attempts (HTTP 503)');
 expect(await readReleaseObject('missing', async () => { throw {$metadata:{httpStatusCode:404}}; })).toBeNull();
});

it('destroys a stalled R2 SDK body on deadline before a complete retry', async () => {
 const {readReleaseObject} = await import('./release-request.mjs');
 const {Readable} = await import('node:stream');
 let calls = 0, stalled;
 const object = await readReleaseObject('storage-probe.js', async () => {
  calls++;
  const Body = calls === 1 ? (stalled = new Readable({read() {}})) : Readable.from(['complete']);
  return {Body};
 }, {timeoutMs:50,sleep:async () => {},warn:() => {}});
 expect(stalled.destroyed).toBe(true);
 expect(calls).toBe(2);
 expect(new TextDecoder().decode(await object.arrayBuffer())).toBe('complete');
});

it('safely destroys SDK bodies that arrive after their request deadline', async () => {
 const {readReleaseObject} = await import('./release-request.mjs');
 const {Readable} = await import('node:stream');
 let calls = 0, late;
 const object = await readReleaseObject('late-seal', async () => {
  if (++calls === 1) {
   await new Promise(resolve => setTimeout(resolve, 20));
   late = Readable.from(['stale']);
   return {Body:late};
  }
  return {Body:Readable.from(['complete'])};
 }, {timeoutMs:5,sleep:async () => new Promise(resolve => setTimeout(resolve, 30)),warn:() => {}});
 expect(late.destroyed).toBe(true);
 expect(new TextDecoder().decode(await object.arrayBuffer())).toBe('complete');
 expect(calls).toBe(2);
});
