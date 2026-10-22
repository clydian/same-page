import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { stopBetaRelease } from './frontend-release.mjs';

const A = 'a'.repeat(40), B = 'b'.repeat(40);
function catalog() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(readFileSync(new URL('../migrations/0034_release_channels.sql', import.meta.url), 'utf8'));
  const insert = db.prepare('INSERT INTO frontend_releases VALUES(?,?,?,1,1)');
  for (const id of [A, B]) insert.run(id, '0'.repeat(64), 'same-page-storage-v15-sync-v1');
  db.prepare('INSERT INTO release_channels VALUES(1,?,?,7)').run(A, B);
  const query = async (sql, params) => ({ results: db.prepare(sql).all(...params) });
  return { db, query, pointer: () => ({ ...db.prepare('SELECT * FROM release_channels').get() }) };
}

it('stops the exact beta by atomically returning it to ready stable and retains artifacts', async () => {
  const { db, query, pointer } = catalog();
  try {
    expect(await stopBetaRelease({ query, expectedBeta: B, expectedRevision: 7 })).toEqual({ stable: A, beta: A, revision: 8 });
    expect(pointer()).toEqual({ id: 1, stable: A, beta: A, revision: 8 });
    expect(db.prepare('SELECT count(*) AS n FROM frontend_releases').get().n).toBe(2);
    await expect(stopBetaRelease({ query, expectedBeta: B, expectedRevision: 7 })).rejects.toThrow('reread channels');
  } finally { db.close(); }
});

it('does not change channels after a stale request or when stable is unavailable', async () => {
  const { db, query, pointer } = catalog();
  try {
    for (const expected of [{ expectedBeta: A, expectedRevision: 7 }, { expectedBeta: B, expectedRevision: 6 }]) {
      await expect(stopBetaRelease({ query, ...expected })).rejects.toThrow('reread channels');
    }
    db.prepare('UPDATE frontend_releases SET ready=0 WHERE build_id=?').run(A);
    await expect(stopBetaRelease({ query, expectedBeta: B, expectedRevision: 7 })).rejects.toThrow('reread channels');
    expect(pointer()).toEqual({ id: 1, stable: A, beta: B, revision: 7 });
  } finally { db.close(); }
});
