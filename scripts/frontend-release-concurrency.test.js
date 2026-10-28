import { expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { uploadFrontend, verifyOnlineFrontend } from './frontend-release.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sha = 'a'.repeat(40);
function deferred() {
 let resolve;
 const promise = new Promise(done => { resolve = done; });
 return { promise, resolve };
}
async function artifact(run) {
 const cwd = await mkdtemp(path.join(tmpdir(), 'release-parallel-'));
 try {
  await mkdir(path.join(cwd, 'dist/client/assets'), { recursive: true });
  const files = {};
  for (let i = 0; i < 9; i++) {
   const file = `assets/${i}.js`, body = `sealed file ${i}`;
   files[file] = { sha256: hash(body), bytes: Buffer.byteLength(body), contentType: 'text/javascript' };
   await writeFile(path.join(cwd, 'dist/client', file), body);
  }
  const contract = { contract: 'same-page-storage-v15-sync-v1' };
  await writeFile(path.join(cwd, 'dist/release-storage-probe.js'), 'probe');
  const manifest = { buildId: sha, files, contract: contract.contract, storageDigest: hash(JSON.stringify(contract)), probeDigest: hash('probe') };
  await run({ cwd, manifest, contract });
 } finally { await rm(cwd, { recursive: true, force: true }); }
}

it('uploads four files at a time, retains every readback and writes the seal last', () => artifact(async options => {
 const gate = deferred(), stored = new Map(), readback = [], writes = [];
 let active = 0, peak = 0;
 const bucket = {
  async put(key, body) {
   if (key.endsWith('/sealed.json')) expect(readback.filter(key => key.includes('/assets/'))).toHaveLength(9);
   writes.push(key); stored.set(key, Buffer.from(body)); return {};
  },
  async get(key) {
   if (key.includes('/assets/')) {
    active++; peak = Math.max(peak, active);
    try { await gate.promise; } finally { active--; }
   }
   readback.push(key);
   return { arrayBuffer: async () => stored.get(key) };
  },
 };
 const operation = uploadFrontend({ ...options, bucket });
 try {
  // Wait for the barrier rather than assuming filesystem scheduling speed.
  await vi.waitFor(() => expect(active).toBe(4), { timeout: 2000, interval: 5 });
  expect(writes[0]).toBe(`releases/${sha}/claim.json`);
  expect(writes.some(key => key.endsWith('/sealed.json'))).toBe(false);
 } finally { gate.resolve(); await operation; }
 expect(peak).toBe(4);
 expect(writes.at(-1)).toBe(`releases/${sha}/sealed.json`);
 expect(readback).toHaveLength(writes.length);
}));

it('drains in-flight uploads after a hash failure and never seals a partial release', () => artifact(async options => {
 const gate = deferred(), fail = deferred(), entered = deferred(), stored = new Map(), writes = [];
 let settled = false, blocked = 0;
 const bucket = {
  async put(key, body) { writes.push(key); stored.set(key, Buffer.from(body)); return {}; },
  async get(key) {
   if (key.endsWith('/assets/0.js')) { entered.resolve(); await fail.promise; return { arrayBuffer: async () => Buffer.from('wrong bytes') }; }
   if (key.includes('/assets/')) { blocked++; await gate.promise; }
   return { arrayBuffer: async () => stored.get(key) };
  },
 };
 const outcome = uploadFrontend({ ...options, bucket }).then(() => ({ ok: true }), error => ({ error })).finally(() => { settled = true; });
 try {
  await entered.promise;
  await vi.waitFor(() => expect(blocked).toBe(3), { timeout: 2000, interval: 5 });
  fail.resolve();
  await setImmediate();
  expect(settled).toBe(false);
 } finally { fail.resolve(); gate.resolve(); }
 expect((await outcome).error?.message).toContain('collision');
 expect(writes.filter(key => key.includes('/assets/')).length).toBeLessThanOrEqual(4);
 expect(writes.some(key => key.endsWith('/sealed.json'))).toBe(false);
}));

it('bounds online verification through full body consumption, after backend identity succeeds', async () => {
 const gate = deferred(), calls = [], bytes = 'candidate';
 let active = 0, peak = 0;
 const files = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`assets/${i}.js`, { sha256: hash(bytes) }]));
 const operation = verifyOnlineFrontend({ origin: 'https://example.test', sha, files, fetchImpl: async url => {
  calls.push(url.pathname);
  if (url.pathname === '/api/health') return Response.json({ buildId: sha });
  active++; peak = Math.max(peak, active);
  return { status: 200, async arrayBuffer() { try { await gate.promise; return Buffer.from(bytes); } finally { active--; } } };
 }});
 try {
  await setImmediate();
  expect(calls[0]).toBe('/api/health');
  expect(active).toBe(4);
 } finally { gate.resolve(); await operation; }
 expect(peak).toBe(4);
 expect(calls).toHaveLength(10);
});

it('waits for active HTTP bodies on integrity failure and stops scheduling further files', async () => {
 const gate = deferred(), calls = [], bytes = 'candidate';
 const files = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`assets/${i}.js`, { sha256: hash(bytes) }]));
 let settled = false;
 const outcome = verifyOnlineFrontend({ origin: 'https://example.test', sha, files, fetchImpl: async url => {
  if (url.pathname === '/api/health') return Response.json({ buildId: sha });
  calls.push(url.pathname);
  return { status: 200, async arrayBuffer() { if (!url.pathname.endsWith('/0.js')) await gate.promise; return Buffer.from('corrupt'); } };
 }}).then(() => ({ ok: true }), error => ({ error })).finally(() => { settled = true; });
 try { await setImmediate(); expect(settled).toBe(false); }
 finally { gate.resolve(); }
 expect((await outcome).error?.message).toContain('candidate resource hash mismatch');
 expect(calls).toHaveLength(4);
});
