import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Freeze shared record/schema boundaries, not every caller's implementation.
// The sealed artifact matrix separately checks actual round-trip behaviour.
export const storageContractFiles = [
  'src/client/platform/local-database.ts',
  'src/client/platform/migrate-brush-styles.ts',
  'src/client/platform/local-workspace.ts',
  'src/client/auth/logout-fence.ts',
  'src/client/reader/reading-preferences.ts',
  'src/client/annotations/push-request.ts',
  'src/shared/annotations.ts',
  'src/shared/reader-sync.ts',
  'src/shared/scores.ts',
  'src/shared/choirs.ts',
  'src/shared/drive-permissions.ts',
].sort();

export async function storageContract(cwd = process.cwd()) {
  const files = Object.fromEntries(await Promise.all(storageContractFiles.map(async file => [
    file, createHash('sha256').update(await readFile(path.join(cwd, file))).digest('hex'),
  ])));
  const lock = JSON.parse(await readFile(path.join(cwd, 'package-lock.json'), 'utf8'));
  return { contract: 'same-page-storage-v15-sync-v1', dexie: lock.packages['node_modules/dexie'].version, zod: lock.packages['node_modules/zod'].version, files };
}

export function assertStorageCompatibility(stable, candidate) {
  assert.equal(candidate.contract, 'same-page-storage-v15-sync-v1', 'unsupported storage contract');
  for (const field of ['contract', 'dexie', 'zod']) {
    assert.ok(typeof candidate[field] === 'string' && candidate[field].length > 0, `missing ${field}`);
    assert.equal(candidate[field], stable[field], `storage compatibility changed: ${field}`);
  }
  // Earlier sealed baselines include UI and every migration. Preserve their
  // original bytes/digest and compare only these explicit shared boundaries.
  for (const file of storageContractFiles) {
    assert.match(candidate.files?.[file] ?? '', /^[a-f0-9]{64}$/, `missing storage boundary: ${file}`);
    assert.equal(candidate.files[file], stable.files?.[file], `storage compatibility changed: ${file}`);
  }
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await writeFile('dist/release-storage.json',JSON.stringify(await storageContract()));
