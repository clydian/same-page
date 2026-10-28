import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { recordVerification } from './release-verification.mjs';

it('records only admitted releases and prevents old or late attempts from overwriting a newer result', async () => {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(readFileSync(new URL('../migrations/0034_release_channels.sql', import.meta.url), 'utf8'));
  db.exec(readFileSync(new URL('../migrations/0038_release_verification.sql', import.meta.url), 'utf8'));
  const sha = 'a'.repeat(40), digest = 'b'.repeat(64);
  db.prepare('INSERT INTO frontend_releases VALUES(?,?,?,?,?)').run(sha,digest,'same-page-storage-v15-sync-v1',1,0);
  const query = async (sql, params) => ({ meta: { changes: Number(db.prepare(sql).run(...params).changes) } });
  const write = (runId, attempt, status, manifestDigest = digest) => recordVerification({query,sha,runId,attempt,status,manifestDigest,now:100});
  try {
    expect(await write(10,1,'running')).toBe(0);
    db.prepare('UPDATE frontend_releases SET ready=1').run();
    expect(await write(10,1,'running')).toBe(1);
    expect(await write(10,1,'success','c'.repeat(64))).toBe(0);
    expect(await write(10,2,'running')).toBe(1);
    expect(await write(10,1,'success')).toBe(0);
    expect(await write(10,2,'failure')).toBe(1);
    expect(await write(10,2,'success')).toBe(0);
    expect(await write(11,1,'success')).toBe(1);
    expect(db.prepare('SELECT status,run_id,attempt,manifest_digest FROM release_verification').get()).toMatchObject({ status:'success',run_id:11,attempt:1,manifest_digest:digest });
  } finally { db.close(); }
});
