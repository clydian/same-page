import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertStorageCompatibility, storageContract } from "./release-contract.mjs";

// The reviewed baseline comes from an original, verified stable release artifact.
// Deployment still compares with the actual stable target under its production lock.
export async function verifyReleaseContract(cwd = process.cwd()) {
  const baseline = JSON.parse(await readFile(path.join(cwd, "scripts/release-storage-baseline.json"), "utf8"));
  assert.match(baseline.buildId ?? "", /^[a-f0-9]{40}$/);
  assert.match(baseline.sealDigest ?? "", /^[a-f0-9]{64}$/, "reviewed baseline seal digest required");
  assert.ok(Number.isSafeInteger(baseline.runId) && baseline.runId > 0);
  assert.ok(Number.isSafeInteger(baseline.artifactId) && baseline.artifactId > 0);
  assertStorageCompatibility(baseline.storage, await storageContract(cwd));
  const manifest = JSON.parse(await readFile(path.join(cwd, "package.json"), "utf8"));
  for (const name of ["dexie", "zod"]) {
    assert.equal(manifest.dependencies[name], baseline.storage[name],
      `Pin ${name} to the reviewed storage version; upgrades require a compatibility bridge`);
  }
  return baseline;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const baseline = await verifyReleaseContract();
  console.log(`Storage contract matches reviewed baseline ${baseline.buildId} (CI ${baseline.runId}, artifact ${baseline.artifactId})`);
}
