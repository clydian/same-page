// Historical samepage.3 artifact reproducer; current player development uses packages/player.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
const { values } = parseArgs({ options: { output: { type: 'string' } } });
if (!values.output || Number(process.versions.node.split('.')[0]) !== 24) throw new Error('Use Node24 and --output NEW_EMPTY_DIR');
const sha = b => createHash('sha256').update(b).digest('hex');
const source = path.resolve('vendor/clydian-chorus-player-0.1.19-samepage.2.tgz');
const patch = path.resolve('vendor/patches/chorus-player-0.1.19-samepage.3-source-directions.patch');
const expected = '7d51d40634864959276e8619333d7332331792cab33e63f0fa92885c4ea91e12';
if (sha(fs.readFileSync(source)) !== expected) throw new Error('Unexpected current-player base artifact');
const output = path.resolve(values.output);
if (fs.existsSync(output) && fs.readdirSync(output).length) throw new Error('Use a fresh output directory');
fs.mkdirSync(output, { recursive: true });
const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'samepage-source-directions-player-'));
execFileSync('tar', ['-xzf', source, '-C', staging]);
execFileSync('patch', ['-p1', '-d', staging, '-i', patch], { stdio: 'inherit' });
const pkg = JSON.parse(fs.readFileSync(path.join(staging, 'package/package.json')));
if (pkg.version !== '0.1.19-samepage.3' || pkg.peerDependencies['@coderline/alphatab'] !== '1.8.4-samepage.4') throw new Error('Unexpected patched package identity');
const result = JSON.parse(execFileSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', output], { cwd: path.join(staging, 'package'), encoding: 'utf8' }))[0];
const artifact = path.join(output, result.filename);
fs.writeFileSync(path.join(output, 'player-source-directions-manifest.json'), JSON.stringify({
    version: pkg.version, nativePeer: pkg.peerDependencies['@coderline/alphatab'], baseArtifactSha256: expected,
    patchSha256: sha(fs.readFileSync(patch)), artifact: result.filename, artifactSha256: sha(fs.readFileSync(artifact)), integrity: result.integrity,
    node: process.version, scope: 'Display-only authored text and wedge projection after playback dynamics; preserves practice extensions and AudioWorklet compatible exact peer.'
}, null, 2) + '\n');
console.log(JSON.stringify({ artifact, sha256: sha(fs.readFileSync(artifact)), staging }));
