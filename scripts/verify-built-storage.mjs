import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyRelease } from './release-artifact.mjs';
import { assertStorageCompatibility } from './release-contract.mjs';
import { verifyReleaseContract } from './verify-release-contract.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');

const origin = 'https://samepage.clyapps.com';
const maxBaselineBytes = 4 * 1024 * 1024;

async function boundedJson(response) {
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    assert.ok(size <= maxBaselineBytes, 'storage baseline response too large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

// Stable promotion already atomically changes the authoritative D1 pointer.
// Read it through a narrow public API instead of mirroring it into more storage.
export async function readStableStorageProbe({ reviewed, fetchImpl = fetch }) {
  const get = pathname => fetchImpl(new URL(pathname, origin), {
    redirect: 'error', credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(30_000),
  });
  const response = await get('/api/release-storage-baseline');
  assert.equal(response.status, 200, 'stable storage baseline unavailable');
  const baseline = await boundedJson(response);
  assert.equal(baseline.version, 1, 'unsupported storage baseline');
  assert.match(baseline.buildId ?? '', /^[a-f0-9]{40}$/);
  assert.match(baseline.probeDigest ?? '', /^[a-f0-9]{64}$/);
  assert.match(baseline.storageDigest ?? '', /^[a-f0-9]{64}$/);
  assert.equal(typeof baseline.probe, 'string');
  assert.equal(typeof baseline.storage, 'string');
  assert.equal(digest(baseline.probe), baseline.probeDigest, 'stable probe digest mismatch');
  assert.equal(digest(baseline.storage), baseline.storageDigest, 'stable storage digest mismatch');
  assertStorageCompatibility(reviewed.storage, JSON.parse(baseline.storage));
  return { id: baseline.buildId, bytes: Buffer.from(baseline.probe), digest: baseline.probeDigest, source: 'current-stable' };
}

export async function verifyBuiltStorage({ cwd = process.cwd(), sha, fetchImpl = fetch }) {
  // Consume the original build-job bytes. Never rebuild a sealed SHA here.
  const manifest = await verifyRelease({ cwd, sha });
  const reviewed = await verifyReleaseContract(cwd);
  const stable = await readStableStorageProbe({ reviewed, fetchImpl });
  const storage = JSON.parse(await readFile(path.join(cwd, 'dist/release-storage.json'), 'utf8'));
  assertStorageCompatibility(reviewed.storage, storage);
  const bytes = await readFile(path.join(cwd, 'dist/release-storage-probe.js'));
  assert.equal(digest(bytes), manifest.files['dist/release-storage-probe.js']);
  const { verifyArtifactStorage } = await import('./verify-release-storage.mjs');
  const report = await verifyArtifactStorage({ stable, candidate: { id: sha, bytes, digest: digest(bytes) } });
  const output = path.join(cwd, 'artifacts/verification/release-storage');
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, 'reviewed-baseline.json'), JSON.stringify({ ...report, baselineSource: stable.source }, null, 2));
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [sha] = process.argv.slice(2);
  assert.ok(sha, 'usage: verify-built-storage.mjs SHA');
  console.log(JSON.stringify(await verifyBuiltStorage({ sha })));
}
