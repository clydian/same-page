import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

const base = 'vendor/clydian-chorus-player-0.1.19.tgz';
const current = 'vendor/clydian-chorus-player-0.1.19-samepage.1.tgz';
const members = path => execFileSync('tar', ['-tzf', path], { encoding: 'utf8' }).trim().split('\n').sort();
test('the practice artifact changes only the documented interaction seam, keeping preparation, MIDI, renderer and source-copy bytes intact', () => {
  expect(members(current)).toEqual(members(base));
  const changed = members(base).filter(name => !execFileSync('tar', ['-xOf', base, name]).equals(execFileSync('tar', ['-xOf', current, name])));
  expect(changed).toEqual(['package/dist/playback-measures.d.ts', 'package/dist/playback-measures.js', 'package/dist/session.d.ts', 'package/dist/session.js', 'package/package.json']);
  const hash = createHash('sha256').update(readFileSync(current)).digest('hex');
  expect(readFileSync('vendor/chorus-player-0.1.19-samepage.1.md', 'utf8')).toContain(`Tarball SHA-256: \`${hash}\``);
});
