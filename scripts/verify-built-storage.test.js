import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { it } from 'vitest';
import { readReviewedStorageProbe } from './verify-built-storage.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function fixture(run) {
  const directory = await mkdtemp(path.join(tmpdir(), 'same-page-reviewed-probe-'));
  try {
    const reviewed = JSON.parse(await readFile(new URL('./release-storage-baseline.json', import.meta.url), 'utf8'));
    const files = { 'dist/release-storage.json': JSON.stringify(reviewed.storage), 'dist/release-storage-probe.js': 'export const sourceBuild = "synthetic fixture";' };
    await mkdir(path.join(directory, 'dist'));
    for (const [name, body] of Object.entries(files)) await writeFile(path.join(directory, name), body);
    const manifest = { sha: reviewed.buildId, runId: String(reviewed.runId), files: Object.fromEntries(Object.entries(files).map(([name, body]) => [name, hash(body)])) };
    const seal = JSON.stringify(manifest);
    await writeFile(path.join(directory, 'release.json'), seal);
    await run({ directory, reviewed: { ...reviewed, sealDigest: hash(seal) }, manifest });
  } finally { await rm(directory, { recursive: true, force: true }); }
}

it('accepts only the reviewed original probe bytes and source identity', () => fixture(async ({ directory, reviewed }) => {
  const probe = await readReviewedStorageProbe(directory, reviewed);
  assert.equal(probe.id, reviewed.buildId);
  assert.equal(probe.digest, hash(probe.bytes));
}));

it('rejects a replaced seal even if it describes internally consistent new bytes', () => fixture(async ({ directory, reviewed, manifest }) => {
  await writeFile(path.join(directory, 'release.json'), JSON.stringify({ ...manifest, sha: 'f'.repeat(40) }));
  await assert.rejects(readReviewedStorageProbe(directory, reviewed), /baseline seal changed/);
}));

it('rejects probe or storage bytes modified after sealing', async () => {
  for (const file of ['dist/release-storage-probe.js', 'dist/release-storage.json']) await fixture(async ({ directory, reviewed }) => {
    await writeFile(path.join(directory, file), 'modified');
    await assert.rejects(readReviewedStorageProbe(directory, reviewed), /baseline bytes changed/);
  });
});

it('rejects a different baseline source, workflow run, or storage boundary', async () => {
  for (const change of [{ buildId: 'f'.repeat(40) }, { runId: 1 }, { storage: { contract: 'unsupported' } }]) await fixture(async ({ directory, reviewed }) => {
    await assert.rejects(readReviewedStorageProbe(directory, { ...reviewed, ...change }), /baseline source mismatch|baseline run mismatch|storage compatibility changed/);
  });
});

// The permanent source is current stable, never a build-specific Actions URL.
async function reviewedBaseline() {
  return JSON.parse(await readFile(new URL('./release-storage-baseline.json', import.meta.url), 'utf8'));
}
async function liveBaseline(buildId = 'b'.repeat(40)) {
  const reviewed = await reviewedBaseline();
  const storage = JSON.stringify(reviewed.storage), probe = `export const sourceBuild = '${buildId}';`;
  return { version: 1, buildId, storage, probe, storageDigest: hash(storage), probeDigest: hash(probe) };
}
const jsonResponse = (data, status = 200) => new Response(JSON.stringify(data), { status });

it('reads the replacement stable automatically and sends no credentials', async () => {
  const { readStableStorageProbe } = await import('./verify-built-storage.mjs');
  const reviewed = await reviewedBaseline();
  for (const buildId of ['b'.repeat(40), 'c'.repeat(40)]) {
    const result = await readStableStorageProbe({ reviewed, fetchImpl: async (url, options) => {
      assert.equal(url.href, 'https://samepage.clyapps.com/api/release-storage-baseline');
      assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error');
      assert.equal(options.cache, 'no-store'); assert.equal(options.headers, undefined);
      return jsonResponse(await liveBaseline(buildId));
    } });
    assert.equal(result.id, buildId); assert.equal(result.source, 'current-stable');
  }
});

it('uses the original bootstrap bytes only for an absent route and the exact current stable', async () => {
  const { readStableStorageProbe } = await import('./verify-built-storage.mjs');
  const reviewed = await reviewedBaseline();
  const result = await readStableStorageProbe({ reviewed, fetchImpl: async url =>
    url.pathname.endsWith('/client-release')
      ? jsonResponse({ channel: 'stable', target: reviewed.buildId, contract: reviewed.storage.contract })
      : jsonResponse({ error: 'not_found' }, 404),
  });
  assert.equal(result.id, reviewed.buildId); assert.equal(result.source, 'bootstrap');
  assert.equal(result.bytes.length, 1103154);
});

it('fails closed for corrupt live data and never falls back on outages or HTTP errors', async () => {
  const { readStableStorageProbe } = await import('./verify-built-storage.mjs');
  const reviewed = await reviewedBaseline();
  for (const change of [{ version: 2 }, { buildId: 'bad' }, { probe: 'tampered' }, { storage: '{}' }, { storageDigest: '0'.repeat(64) }]) {
    await assert.rejects(readStableStorageProbe({ reviewed, fetchImpl: async () => jsonResponse({ ...await liveBaseline(), ...change }) }));
  }
  for (const status of [401, 403, 429, 500, 503]) {
    let calls = 0;
    await assert.rejects(readStableStorageProbe({ reviewed, fetchImpl: async () => { calls++; return jsonResponse({}, status); } }), /unavailable/);
    assert.equal(calls, 1);
  }
  await assert.rejects(readStableStorageProbe({ reviewed, fetchImpl: async () => { throw new Error('timeout'); } }), /timeout/);
  await assert.rejects(readStableStorageProbe({ reviewed, fetchImpl: async () => jsonResponse({ error: 'release_unavailable' }, 404) }), /unexpected baseline 404/);
  await assert.rejects(readStableStorageProbe({ reviewed, fetchImpl: async () => jsonResponse({ huge: 'x'.repeat(4 * 1024 * 1024) }) }), /too large/);
});

it('refuses the bootstrap after stable promotion, beta selection or unverifiable state', async () => {
  const { readStableStorageProbe } = await import('./verify-built-storage.mjs');
  const reviewed = await reviewedBaseline();
  const selection = { channel: 'stable', target: reviewed.buildId, contract: reviewed.storage.contract };
  for (const change of [{ target: 'b'.repeat(40) }, { channel: 'beta' }, { contract: 'changed' }]) {
    await assert.rejects(readStableStorageProbe({ reviewed, fetchImpl: async url => url.pathname.endsWith('/client-release')
      ? jsonResponse({ ...selection, ...change }) : jsonResponse({ error: 'not_found' }, 404) }));
  }
  await assert.rejects(readStableStorageProbe({ reviewed, fetchImpl: async url => url.pathname.endsWith('/client-release')
    ? jsonResponse({}, 503) : jsonResponse({ error: 'not_found' }, 404) }), /cannot verify bootstrap/);
});
