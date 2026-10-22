import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { output: { type: 'string' } } });
if (!values.output) throw new Error('Use --output PATH to the host public source directory.');
const require = createRequire(import.meta.url);
const nativeRoot = path.dirname(path.dirname(require.resolve('@coderline/alphatab')));
const nativePackage = JSON.parse(fs.readFileSync(path.join(nativeRoot, 'package.json')));
const playerPackage = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../package.json', import.meta.url))));
const source = nativePackage.samePageSource;
if (nativePackage.version !== playerPackage.peerDependencies?.['@coderline/alphatab'] ||
    source?.packageVersion !== nativePackage.version ||
    !/^[a-f0-9]{40}$/u.test(source?.sourceCommit ?? '') ||
    !/^[a-f0-9]{64}$/u.test(source?.sha256 ?? '') ||
    source.archive !== `alphatab-source-${source.sourceCommit}.tgz`) {
  throw new Error('The installed native package does not match the exact player peer and source manifest.');
}
const archive = fs.readFileSync(path.join(nativeRoot, source.archive));
const digest = createHash('sha256').update(archive).digest('hex');
if (digest !== source.sha256) throw new Error('Native source archive checksum mismatch.');
const output = path.resolve(values.output);
const stem = `${source.sourceCommit}-${digest}`;
const archiveName = `${stem}.tgz`;
const manifestName = `${stem}.json`;
const licenseName = `${stem}-LICENSE.txt`;
const noticesName = `${stem}-LICENSE.header.txt`;
const manifest = JSON.stringify({ schemaVersion: 1, packageName: nativePackage.name, packageVersion: nativePackage.version,
  upstreamUrl: source.upstreamUrl, upstreamCommit: source.upstreamCommit,
  sourceCommit: source.sourceCommit, sourceTree: source.sourceTree,
  archive: archiveName, sha256: digest, license: licenseName, notices: noticesName }, null, 2) + '\n';
const files = new Map([
  [archiveName, archive], [manifestName, Buffer.from(manifest)],
  [licenseName, fs.readFileSync(path.join(nativeRoot, 'LICENSE'))],
  [noticesName, fs.readFileSync(path.join(nativeRoot, 'LICENSE.header'))],
]);
// Preflight all outputs. Existing source snapshots are immutable and are never
// removed when another native version is installed or when a build reruns.
for (const [name, bytes] of files) {
  const target = path.join(output, name);
  if (fs.existsSync(target) && !fs.readFileSync(target).equals(bytes)) {
    throw new Error(`Refusing to replace an existing native source file: ${name}`);
  }
}
fs.mkdirSync(output, { recursive: true });
for (const [name, bytes] of files) {
  const target = path.join(output, name);
  if (!fs.existsSync(target)) fs.writeFileSync(target, bytes, { flag: 'wx' });
}
console.log(JSON.stringify({ archive: path.join(output, archiveName), manifest: path.join(output, manifestName), sha256: digest }));
