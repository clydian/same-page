import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { it } from 'vitest';
import { readStableStorageProbe } from './verify-built-storage.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
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

it('fails closed for corrupt live data and never falls back on outages or HTTP errors', async () => {
  const reviewed = await reviewedBaseline();
  for (const change of [{ version: 2 }, { buildId: 'bad' }, { probe: 'tampered' }, { storage: '{}' }, { storageDigest: '0'.repeat(64) }]) {
    await assert.rejects(readStableStorageProbe({ reviewed, fetchImpl: async () => jsonResponse({ ...await liveBaseline(), ...change }) }));
  }
  for (const status of [401, 403, 404, 429, 500, 503]) {
    let calls = 0;
    await assert.rejects(readStableStorageProbe({ reviewed, fetchImpl: async () => { calls++; return jsonResponse({}, status); } }), /unavailable/);
    assert.equal(calls, 1);
  }
  await assert.rejects(readStableStorageProbe({ reviewed, fetchImpl: async () => { throw new Error('timeout'); } }), /timeout/);
  // Even the pre-endpoint absent-route response must stop after one request.
  let calls = 0;
  await assert.rejects(readStableStorageProbe({ reviewed, fetchImpl: async () => {
    calls++;
    return jsonResponse({ error: 'not_found' }, 404);
  } }), /unavailable/);
  assert.equal(calls, 1);
  await assert.rejects(readStableStorageProbe({ reviewed, fetchImpl: async () => jsonResponse({ huge: 'x'.repeat(4 * 1024 * 1024) }) }), /too large/);
});
