import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { verifyRelease } from './release-artifact.mjs';
import { assertStorageCompatibility } from './release-contract.mjs';
import { verifyReleaseContract } from './verify-release-contract.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');

const origin = 'https://samepage.clyapps.com';
const maxBaselineBytes = 4 * 1024 * 1024;

export function verifyReviewedStorageFiles(files, reviewed) {
  const seal = files['release.json'];
  assert.equal(digest(seal), reviewed.sealDigest, 'reviewed baseline seal changed');
  const manifest = JSON.parse(seal);
  assert.equal(manifest.sha, reviewed.buildId, 'reviewed baseline source mismatch');
  assert.equal(String(manifest.runId), String(reviewed.runId), 'reviewed baseline run mismatch');
  for (const file of ['dist/release-storage.json', 'dist/release-storage-probe.js']) {
    assert.equal(digest(files[file]), manifest.files[file], `reviewed baseline bytes changed: ${file}`);
  }
  assertStorageCompatibility(reviewed.storage, JSON.parse(files['dist/release-storage.json']));
  const bytes = Buffer.from(files['dist/release-storage-probe.js']);
  return { id: reviewed.buildId, bytes, digest: digest(bytes) };
}

export async function readReviewedStorageProbe(directory, reviewed) {
  const files = {};
  for (const file of ['release.json', 'dist/release-storage.json', 'dist/release-storage-probe.js']) {
    files[file] = await readFile(path.join(directory, file));
  }
  return verifyReviewedStorageFiles(files, reviewed);
}

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
export async function readStableStorageProbe({ cwd = process.cwd(), reviewed, fetchImpl = fetch }) {
  const get = pathname => fetchImpl(new URL(pathname, origin), {
    redirect: 'error', credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(30_000),
  });
  const response = await get('/api/release-storage-baseline');
  if (response.status === 404) {
    assert.equal((await boundedJson(response)).error, 'not_found', 'unexpected baseline 404');
    // One-time bridge for this PR before its Worker endpoint is deployed. Never
    // conceal outages/corruption or use this older probe after stable changes.
    const selectionResponse = await get('/api/client-release');
    assert.equal(selectionResponse.status, 200, 'cannot verify bootstrap stable');
    const selection = await boundedJson(selectionResponse);
    assert.equal(selection.channel, 'stable', 'bootstrap must select stable');
    assert.equal(selection.target, reviewed.buildId, 'bootstrap no longer matches current stable');
    assert.equal(selection.contract, reviewed.storage.contract, 'bootstrap storage contract changed');
    const compressed = await readFile(path.join(cwd, 'scripts/fixtures/storage-bootstrap.json.gz'));
    const files = JSON.parse(gunzipSync(compressed, { maxOutputLength: maxBaselineBytes }));
    return { ...verifyReviewedStorageFiles(files, reviewed), source: 'bootstrap' };
  }
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
  const stable = await readStableStorageProbe({ cwd, reviewed, fetchImpl });
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
