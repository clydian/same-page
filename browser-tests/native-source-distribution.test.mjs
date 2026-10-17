import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import { startStorageFixture } from './storage-fixture.mjs';

test('built host publicly serves the exact installed native sources and notices', { timeout: 60000 }, async t => {
  const directory = 'public/third-party/alphatab';
  const names = (await readdir(directory)).filter(name => name.endsWith('.json'));
  assert.ok(names.length > 0);
  const fixture = await startStorageFixture();
  t.after(() => fixture.stop());
  for (const name of names) {
    const expected = JSON.parse(await readFile(`${directory}/${name}`, 'utf8'));
    const response = await fetch(`${fixture.origin}/third-party/alphatab/${name}`);
    assert.equal(response.status, 200);
    const manifest = await response.json();
    assert.deepEqual(manifest, expected);
    for (const file of [manifest.archive, manifest.license, manifest.notices]) {
      const response = await fetch(`${fixture.origin}/third-party/alphatab/${file}`);
      assert.equal(response.status, 200);
      const bytes = Buffer.from(await response.arrayBuffer());
      assert.deepEqual(bytes, await readFile(`${directory}/${file}`));
      if (file === manifest.archive) assert.equal(createHash('sha256').update(bytes).digest('hex'), manifest.sha256);
    }
  }
});
