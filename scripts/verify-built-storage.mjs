import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyRelease } from './release-artifact.mjs';
import { assertStorageCompatibility } from './release-contract.mjs';
import { verifyReleaseContract } from './verify-release-contract.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');

export async function readReviewedStorageProbe(directory, reviewed) {
  const seal = await readFile(path.join(directory, 'release.json'));
  assert.equal(digest(seal), reviewed.sealDigest, 'reviewed baseline seal changed');
  const manifest = JSON.parse(seal);
  assert.equal(manifest.sha, reviewed.buildId, 'reviewed baseline source mismatch');
  assert.equal(String(manifest.runId), String(reviewed.runId), 'reviewed baseline run mismatch');
  const readSealed = async file => {
    const bytes = await readFile(path.join(directory, file));
    assert.equal(digest(bytes), manifest.files[file], `reviewed baseline bytes changed: ${file}`);
    return bytes;
  };
  const storage = JSON.parse(await readSealed('dist/release-storage.json'));
  assertStorageCompatibility(reviewed.storage, storage);
  const bytes = await readSealed('dist/release-storage-probe.js');
  return { id: reviewed.buildId, bytes, digest: digest(bytes) };
}

export async function verifyBuiltStorage({ cwd = process.cwd(), baselineDirectory, sha }) {
  // Consume the original build-job bytes. Never rebuild a sealed SHA here.
  const manifest = await verifyRelease({ cwd, sha });
  const reviewed = await verifyReleaseContract(cwd);
  const stable = await readReviewedStorageProbe(baselineDirectory, reviewed);
  const storage = JSON.parse(await readFile(path.join(cwd, 'dist/release-storage.json'), 'utf8'));
  assertStorageCompatibility(reviewed.storage, storage);
  const bytes = await readFile(path.join(cwd, 'dist/release-storage-probe.js'));
  assert.equal(digest(bytes), manifest.files['dist/release-storage-probe.js']);
  const { verifyArtifactStorage } = await import('./verify-release-storage.mjs');
  const report = await verifyArtifactStorage({ stable, candidate: { id: sha, bytes, digest: digest(bytes) } });
  const output = path.join(cwd, 'artifacts/verification/release-storage');
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, 'reviewed-baseline.json'), JSON.stringify(report, null, 2));
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [baselineDirectory, sha] = process.argv.slice(2);
  assert.ok(baselineDirectory && sha, 'usage: verify-built-storage.mjs BASELINE_DIRECTORY SHA');
  console.log(JSON.stringify(await verifyBuiltStorage({ baselineDirectory, sha })));
}
