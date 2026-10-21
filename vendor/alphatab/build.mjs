import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

const { values } = parseArgs({ options: {

  version: { type: 'string' },
  output: { type: 'string' },
} });
const snapshot = path.dirname(fileURLToPath(import.meta.url));
const baseline = JSON.parse(fs.readFileSync(path.join(snapshot, 'SOURCE-MANIFEST.json')));
const upstreamCommit = baseline.upstreamCommit;
const upstreamUrl = 'https://github.com/CoderLine/alphaTab.git';
const { version } = values;
if (!values.output ||
    !/^\d+\.\d+\.\d+-samepage\.[1-9]\d*$/u.test(version ?? '')) {
  throw new Error('Use --version X.Y.Z-samepage.N --output DIR');
}
if (Number(process.versions.node.split('.')[0]) !== 24) {
  throw new Error('Use the Node 24 build baseline.');
}
const output = path.resolve(values.output);
if (fs.existsSync(output) && fs.readdirSync(output).length > 0) {
  throw new Error('Output directory must be empty; never replace an existing native artifact.');
}
fs.mkdirSync(output, { recursive: true });
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'samepage-native-package-'));
const checkout = path.join(workspace, 'checkout');
const sourceRoot = path.join(workspace, 'source');
const stage = path.join(workspace, 'package');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const capture = (command, args, cwd) => execFileSync(command, args, { cwd, encoding: 'utf8' }).trim();
const run = (command, args, cwd) => execFileSync(command, args, { cwd, stdio: 'inherit' });
console.log(`Build workspace: ${workspace}`);

// Reconstruct the public upstream plus our editable, repository-owned changes.
// A real independent .git directory is required by upstream license generation.
fs.mkdirSync(checkout);
run('git', ['init', '--quiet'], checkout);
run('git', ['remote', 'add', 'origin', upstreamUrl], checkout);
run('git', ['fetch', '--depth=1', 'origin', upstreamCommit], checkout);
run('git', ['checkout', '--detach', 'FETCH_HEAD'], checkout);
run('git', ['apply', '--binary', path.join(snapshot, 'changes.patch')], checkout);
fs.cpSync(path.join(snapshot, 'modified-source'), checkout, { recursive: true });
run('git', ['add', '--all'], checkout);
run('git', ['-c', 'user.name=Same Page', '-c', 'user.email=build@same-page.invalid',
  'commit', '--quiet', '--no-verify', '-m', `Same Page alphaTab ${version}`], checkout);
const commit = capture('git', ['rev-parse', 'HEAD'], checkout);
const tree = capture('git', ['rev-parse', `${commit}^{tree}`], checkout);
const upstreamPackage = JSON.parse(fs.readFileSync(path.join(checkout, 'packages/alphatab/package.json')));
if (!version.startsWith(`${upstreamPackage.version}-samepage.`)) {
  throw new Error('Fork version must identify the actual upstream package version.');
}

// Supply complete modified source files, not merely a private-repository link.
// The public upstream commit plus the patch restores every unchanged file.
fs.mkdirSync(path.join(sourceRoot, 'modified-source'), { recursive: true });
const changed = capture('git', ['diff', '--name-only', '--diff-filter=ACMR', upstreamCommit, commit], checkout)
  .split('\n').filter(Boolean);
const modifiedSource = {};
for (const relative of changed) {
  const target = path.join(sourceRoot, 'modified-source', relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const bytes = execFileSync('git', ['show', `${commit}:${relative}`], { cwd: checkout });
  fs.writeFileSync(target, bytes);
  modifiedSource[relative] = hash(bytes);
}
fs.writeFileSync(path.join(sourceRoot, 'changes.patch'), execFileSync('git', ['diff', '--binary', upstreamCommit, commit], { cwd: checkout }));
for (const name of ['LICENSE', 'LICENSE.header']) {
  fs.copyFileSync(path.join(checkout, 'packages/alphatab', name), path.join(sourceRoot, name));
}
const provenance = { upstreamUrl, upstreamCommit, sourceCommit: commit, sourceTree: tree,
  packageName: upstreamPackage.name, packageVersion: version, modifiedSource };
fs.writeFileSync(path.join(sourceRoot, 'SOURCE-MANIFEST.json'), JSON.stringify(provenance, null, 2) + '\n');
fs.writeFileSync(path.join(sourceRoot, 'README.md'), `# Same Page alphaTab source changes\n\nThis is a modified alphaTab build, not an upstream release. alphaTab remains MPL-2.0; original notices and complete modified files are included.\n\nPublic upstream: ${upstreamUrl}\nUpstream commit: ${upstreamCommit}\nSource commit identifier: ${commit}\nSource tree: ${tree}\n\nTo rebuild, clone the public upstream, check out the upstream commit, apply changes.patch, and verify modified-source against SOURCE-MANIFEST.json. Use an independent clone with a real .git directory. With Node 24 run npm ci --ignore-scripts, npm run build, npm run build-vite and npm run build-webpack. The package preparation step is the upstream packages/alphatab/scripts/prepack.mts. Builds preserve upstream license banners.\n\nThe source tree and file hashes identify the code. Build timestamps and local Git metadata can change output bytes; this does not assert bit-for-bit reproducible bundles. The distributable package checksum must be verified separately.\n`);
const sourceFile = `alphatab-source-${commit}.tgz`;
if (fs.existsSync(path.join(output, sourceFile))) throw new Error('Source output already exists; choose a fresh output directory.');
run('tar', ['-czf', path.join(output, sourceFile), '-C', sourceRoot, '.'], workspace);
const sourceSha256 = hash(fs.readFileSync(path.join(output, sourceFile)));

run('npm', ['ci', '--ignore-scripts'], checkout);
run('npm', ['run', 'build'], checkout);
run('npm', ['run', 'build-vite'], checkout);
run('npm', ['run', 'build-webpack'], checkout);
// Generated public APIs must already belong to the reviewed source snapshot.
// Ignored build-version metadata may vary, but tracked runtime source may not.
run('git', ['diff', '--exit-code', 'HEAD', '--', 'packages/alphatab/src'], checkout);
run('npm', ['exec', '--workspace=packages/alphatab', '--', 'tsx', 'scripts/prepack.mts'], checkout);
const packageRoot = path.join(checkout, 'packages/alphatab');
fs.mkdirSync(stage);
fs.cpSync(path.join(packageRoot, 'dist'), path.join(stage, 'dist'), { recursive: true });
for (const name of ['LICENSE', 'LICENSE.header', 'README.md']) {
  fs.copyFileSync(path.join(packageRoot, name), path.join(stage, name));
}
fs.copyFileSync(path.join(output, sourceFile), path.join(stage, sourceFile));
const packedPackage = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json')));
packedPackage.version = version;
packedPackage.private = true;
packedPackage.samePageSource = { ...provenance, modifiedSource: undefined, archive: sourceFile, sha256: sourceSha256 };
packedPackage.files = ['dist', 'LICENSE', 'LICENSE.header', 'README.md', 'SAMEPAGE-FORK.md', sourceFile];
delete packedPackage.devDependencies;
delete packedPackage.scripts;
fs.writeFileSync(path.join(stage, 'package.json'), JSON.stringify(packedPackage, null, 2) + '\n');
fs.writeFileSync(path.join(stage, 'SAMEPAGE-FORK.md'), `# Modified alphaTab for Same Page\n\nVersion: ${version}\nSource commit: ${commit}\nSource archive: ${sourceFile}\nSource archive SHA-256: ${sourceSha256}\n\nOriginal authorship and MPL-2.0 notices are retained. This package is not published to the upstream npm scope. Consumers install this local artifact as the shared native renderer; the player requires its exact version as a peer. Hosts must also make the enclosed source archive available at a stable, versioned public URL and retain its license notices when distributing the runtime.\n`);
const packed = JSON.parse(capture('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', output], stage))[0];
const artifact = path.join(output, packed.filename);
const manifest = { ...provenance, sourceArchive: sourceFile, sourceSha256,
  artifact: packed.filename, artifactSha256: hash(fs.readFileSync(artifact)),
  artifactIntegrity: packed.integrity, artifactBytes: fs.statSync(artifact).size,
  node: process.versions.node, packageFiles: packed.files.map(file => file.path) };
fs.writeFileSync(path.join(output, 'native-package-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({ artifact, sha256: manifest.artifactSha256, sourceFile, sourceSha256 }, null, 2));
console.log('Build workspace retained for inspection; this command did not publish or change dependency manifests.');
