import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
const id=process.env.SAME_PAGE_BUILD_ID??process.env.GITHUB_SHA??execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
await build({entryPoints:['scripts/storage-probe-entry.ts'],outfile:process.argv[2]??'dist/release-storage-probe.js',bundle:true,format:'esm',platform:'browser',target:'es2022',define:{__SAME_PAGE_PROBE_BUILD__:JSON.stringify(id)}});
