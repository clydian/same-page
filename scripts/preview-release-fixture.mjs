import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
const run = promisify(execFile);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

// Browser regressions consume the original sealed production bytes via ASSETS.
// Seed only the isolated bridge catalog needed by their real release-permission
// checks. Publishing/R2 asset integrity has its own full release integration suite.
export async function preparePreviewRelease({ cwd, statePath, configPath, config }) {
  const identity = JSON.parse(await readFile(path.join(cwd, 'dist/client/build.json'), 'utf8'));
  if (identity.assetBase === '/') return;
  const id = identity.buildId;
  if (!/^[a-f0-9]{40}$/.test(id) || identity.assetBase !== `/_releases/${id}/`) throw new Error('invalid_preview_release');
  const index = await readFile(path.join(cwd, 'dist/client/index.html'));
  const seal = JSON.stringify({ buildId: id, contract: 'same-page-storage-v15-sync-v1',
    storageDigest: hash(await readFile(path.join(cwd, 'dist/release-storage.json'))),
    probeDigest: hash(await readFile(path.join(cwd, 'dist/release-storage-probe.js'))),
    files: { 'index.html': { sha256: hash(index), bytes: index.length, contentType: 'text/html' } } });
  const sealPath = path.join(statePath, 'preview-release.json');
  await writeFile(sealPath, seal);
  const schema = (await readFile(path.join(cwd, 'migrations/0034_release_channels.sql'), 'utf8'))
    .split('CREATE TABLE release_compatibility')[0].replaceAll('CREATE TABLE ', 'CREATE TABLE IF NOT EXISTS ');
  const sqlPath = path.join(statePath, 'preview-release.sql');
  await writeFile(sqlPath, `${schema}\nINSERT OR IGNORE INTO frontend_releases VALUES('${id}','${hash(seal)}','same-page-storage-v15-sync-v1',1,1);\nINSERT OR IGNORE INTO release_channels VALUES(1,'${id}','${id}',1);`);
  const wrangler = path.join(cwd, 'node_modules/.bin/wrangler');
  const options = { cwd, timeout: 60000, maxBuffer: 1024 * 1024 };
  const local = ['--config', configPath, '--local', '--persist-to', statePath];
  await run(wrangler, ['d1', 'execute', config.d1_databases.find(db => db.binding === 'DB').database_name, ...local, '--file', sqlPath, '--json'], options);
  const bucket = config.r2_buckets.find(bucket => bucket.binding === 'FRONTEND_RELEASES').bucket_name;
  await run(wrangler, ['r2', 'object', 'put', `${bucket}/releases/${id}/sealed.json`, ...local, '--file', sealPath], options);
}
