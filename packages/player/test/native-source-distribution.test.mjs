import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const actualNative = path.dirname(path.dirname(require.resolve('@coderline/alphatab')));
const nativePackage = JSON.parse(fs.readFileSync(path.join(actualNative, 'package.json')));
const playerPackage = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url)));
const actualScript = fileURLToPath(new URL('../scripts/copy-native-source.mjs', import.meta.url));
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'player-source-copy-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const native = path.join(root, 'node_modules/@coderline/alphatab');
  const player = path.join(root, 'player');
  fs.mkdirSync(path.join(native, 'dist'), { recursive: true });
  fs.mkdirSync(path.join(player, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(native, 'dist/alphaTab.js'), '');
  fs.writeFileSync(path.join(native, 'package.json'), JSON.stringify(nativePackage));
  fs.writeFileSync(path.join(player, 'package.json'), JSON.stringify(playerPackage));
  for (const name of [nativePackage.samePageSource.archive, 'LICENSE', 'LICENSE.header']) {
    fs.copyFileSync(path.join(actualNative, name), path.join(native, name));
  }
  const script = path.join(player, 'scripts/copy-native-source.mjs');
  fs.copyFileSync(actualScript, script);
  const output = path.join(root, 'public-source');
  return { native, player, output, run: () => spawnSync(process.execPath, [script, '--output', output], { encoding: 'utf8' }) };
}
test('source copy binds installed archive hashes, keeps old snapshots and is repeatable', t => {
  const f = fixture(t), first = f.run();
  assert.equal(first.status, 0, first.stderr);
  const report = JSON.parse(first.stdout);
  assert.equal(createHash('sha256').update(fs.readFileSync(report.archive)).digest('hex'), report.sha256);
  fs.writeFileSync(path.join(f.output, 'old-version.tgz'), 'preserved');
  assert.equal(f.run().status, 0);
  assert.equal(fs.readFileSync(path.join(f.output, 'old-version.tgz'), 'utf8'), 'preserved');
});
test('source copy refuses an altered public snapshot without replacing it', t => {
  const f = fixture(t), first = f.run();
  assert.equal(first.status, 0, first.stderr);
  const archive = JSON.parse(first.stdout).archive;
  fs.writeFileSync(archive, 'altered');
  const next = f.run();
  assert.notEqual(next.status, 0);
  assert.match(next.stderr, /Refusing to replace/);
  assert.equal(fs.readFileSync(archive, 'utf8'), 'altered');
});
test('source copy rejects corrupted installed sources before writing output', t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.native, nativePackage.samePageSource.archive), 'altered');
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /checksum mismatch/);
  assert.equal(fs.existsSync(f.output), false);
});
test('source copy rejects a native version that differs from the player peer', t => {
  const f = fixture(t), invalid = structuredClone(playerPackage);
  invalid.peerDependencies['@coderline/alphatab'] = '1.8.4';
  fs.writeFileSync(path.join(f.player, 'package.json'), JSON.stringify(invalid));
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /exact player peer/);
  assert.equal(fs.existsSync(f.output), false);
});
