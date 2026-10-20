import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
const before = 'vendor/clydian-chorus-player-0.1.19-samepage.5.tgz';
const after = 'vendor/clydian-chorus-player-0.1.19-samepage.6.tgz';
const native = 'vendor/coderline-alphatab-1.8.4-samepage.7.tgz';
const content = (file, name) => execFileSync('tar', ['-xOf', file, name]);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const members = file => execFileSync('tar', ['-tzf', file], { encoding: 'utf8' }).trim().split('\n').filter(n => n.endsWith('.js'));

test('tenuto display upgrade leaves every player runtime module byte exact', () => {
  expect(members(after)).toEqual(members(before));
  expect(members(after)).toHaveLength(22);
  for (const name of members(before)) expect(content(after, name).equals(content(before, name)), name).toBe(true);
});
test('tenuto native package binds source, peer, MPL and unchanged audio implementation', () => {
  const manifest = JSON.parse(readFileSync('vendor/alphatab-1.8.4-samepage.7.manifest.json'));
  const previous = JSON.parse(readFileSync('vendor/alphatab-1.8.4-samepage.6.manifest.json'));
  const player = JSON.parse(content(after, 'package/package.json'));
  const pkg = JSON.parse(content(native, 'package/package.json'));
  const wrapper = JSON.parse(readFileSync('vendor/chorus-player-0.1.19-samepage.6.manifest.json'));
  expect(hash(readFileSync(native))).toBe(manifest.artifactSha256);
  expect(hash(readFileSync(after))).toBe(wrapper.playerSha256);
  expect(player.peerDependencies['@coderline/alphatab']).toBe(pkg.version);
  expect(pkg.version).toBe('1.8.4-samepage.7');
  expect(pkg.samePageSource.sourceCommit).toBe('afe9089e99ed6044a1dc0030c14a149be44ddcd6');
  expect(hash(content(native, 'package/' + manifest.sourceArchive))).toBe(manifest.sourceSha256);
  expect(content(native, 'package/LICENSE').toString()).toContain('Mozilla Public License');
  expect(content(native, 'package/LICENSE.header').length).toBeGreaterThan(0);
  const changed = Object.keys(manifest.modifiedSource).filter(p => previous.modifiedSource[p] !== manifest.modifiedSource[p]).sort();
  expect(changed).toEqual([
    "PROTOTYPE-TENUTO-PLACEMENT.md",
    "packages/alphatab/src/generated/model/NoteCloner.ts",
    "packages/alphatab/src/generated/model/NoteSerializer.ts",
    "packages/alphatab/src/importer/MusicXmlImporter.ts",
    "packages/alphatab/src/model/Note.ts",
    "packages/alphatab/src/model/TenutoPlacement.ts",
    "packages/alphatab/src/model/_barrel.ts",
    "packages/alphatab/src/rendering/glyphs/AccentuationGlyph.ts",
    "packages/alphatab/src/rendering/glyphs/ScoreBeatGlyph.ts",
    "packages/alphatab/test/rendering/MusicXmlTenutoPlacement.test.ts"
]);
  for (const path of Object.keys(previous.modifiedSource).filter(p => /synth|worklet|audio/i.test(p))) {
    expect(manifest.modifiedSource[path], path).toBe(previous.modifiedSource[path]);
  }
});
