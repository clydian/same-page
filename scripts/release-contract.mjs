import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
export const storageFiles = ['src/client/platform/local-database.ts','src/client/platform/migrate-brush-styles.ts','src/shared/annotations.ts','src/client/annotations/sync.ts','src/client/annotations/push-request.ts','worker/annotations/routes.ts'];
export async function storageContract(cwd = process.cwd()) {
  const graph = await build({ entryPoints: storageFiles.map(f=>path.join(cwd,f)), bundle:true, write:false, outdir:'/tmp/same-page-contract-unused', packages:'external', platform:'browser', metafile:true });
  const dependencies = Object.keys(graph.metafile.inputs).map(f=>path.relative(cwd,path.resolve(f)));
  const inputs = [...new Set([...dependencies,...(await readdir(path.join(cwd,'migrations'))).filter(f=>f.endsWith('.sql')).map(f=>'migrations/'+f)])].sort();
  const files = Object.fromEntries(await Promise.all(inputs.map(async file => [file, createHash('sha256').update(await readFile(path.join(cwd,file))).digest('hex')])));
  const lock = JSON.parse(await readFile(path.join(cwd,'package-lock.json'),'utf8'));
  return { contract: 'same-page-storage-v15-sync-v1', dexie: lock.packages['node_modules/dexie'].version, files };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await writeFile('dist/release-storage.json', JSON.stringify(await storageContract()));
