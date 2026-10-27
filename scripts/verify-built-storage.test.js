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
