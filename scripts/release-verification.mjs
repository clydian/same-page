import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { releaseRequest } from './release-request.mjs';

// A later attempt must not be overwritten by an earlier job finishing late.
export async function recordVerification({ query, sha, runId, attempt, status, manifestDigest, now = Date.now() }) {
  assert.match(sha ?? '', /^[a-f0-9]{40}$/);
  assert.ok(Number.isSafeInteger(runId) && runId > 0);
  assert.ok(Number.isSafeInteger(attempt) && attempt > 0);
  assert.ok(['running', 'success', 'failure', 'cancelled'].includes(status));
  if (status !== 'running') assert.match(manifestDigest ?? '', /^[a-f0-9]{64}$/, 'finished checks require the tested manifest digest');
  const result = await query(`INSERT INTO release_verification(build_id,manifest_digest,run_id,attempt,status,updated_at)
    SELECT build_id,manifest_digest,?,?,?,? FROM frontend_releases WHERE build_id=? AND ready=1
      AND (? IS NULL OR manifest_digest=?)
    ON CONFLICT(build_id) DO UPDATE SET manifest_digest=excluded.manifest_digest,run_id=excluded.run_id,
      attempt=excluded.attempt,status=excluded.status,updated_at=excluded.updated_at
    WHERE excluded.run_id > release_verification.run_id OR
      (excluded.run_id = release_verification.run_id AND excluded.attempt > release_verification.attempt) OR
      (excluded.run_id = release_verification.run_id AND excluded.attempt = release_verification.attempt
       AND release_verification.status = 'running' AND excluded.status <> 'running')`,
  [runId, attempt, status, now, sha, manifestDigest ?? null, manifestDigest ?? null]);
  assert.ok(result?.meta && Number.isInteger(result.meta.changes), 'verification write response missing');
  return result.meta.changes;
}

async function main() {
  const [sha, status, manifestDigest] = process.argv.slice(2);
  const account = process.env.CLOUDFLARE_ACCOUNT_ID, token = process.env.CLOUDFLARE_API_TOKEN;
  assert.match(account ?? '', /^[a-f0-9]{32}$/); assert.ok(token);
  const config = JSON.parse(await readFile('wrangler.jsonc', 'utf8'));
  const db = config.d1_databases[0].database_id;
  const query = async (sql, params) => {
    const data = await releaseRequest('Release verification write', `https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${db}/query`, {
      init: { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ sql, params }) },
      timeoutMs: 30000,
      read: async response => { assert.ok(response.ok, `verification write failed (HTTP ${response.status})`); return response.json(); },
    });
    assert.ok(data.success, 'verification write rejected'); return data.result[0];
  };
  const changes = await recordVerification({ query, sha, status, manifestDigest, runId: Number(process.env.GITHUB_RUN_ID), attempt: Number(process.env.GITHUB_RUN_ATTEMPT) });
  assert.equal(changes, 1, 'verification was stale, release missing, or tested artifact differs from the admitted release');
  console.log(`Recorded advisory verification for ${sha}: ${status}; changed=${changes}`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
