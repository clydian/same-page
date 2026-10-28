import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUCKET, digest, previewCleanup, applyCleanup, cleanupReport } from './frontend-cleanup.mjs';
import { releaseOperation, releaseRequest, readReleaseObject } from './release-request.mjs';

const workflow = '.github/workflows/frontend-cleanup.yml';
const repository = 'clydian/same-page';
const sourceSHA = () => execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();

export function assertApplyEnvironment(env) {
  assert.equal(env.GITHUB_ACTIONS, 'true', 'Apply must run in the manual production workflow');
  assert.equal(env.GITHUB_REPOSITORY, repository);
  assert.equal(env.GITHUB_EVENT_NAME, 'workflow_dispatch');
  assert.equal(env.GITHUB_REF, 'refs/heads/main');
  assert.equal(env.GITHUB_WORKFLOW_REF, `${repository}/${workflow}@refs/heads/main`);
}

export function validatePreviewRun(run, artifacts, source) {
  assert.equal(run.repository?.full_name, repository);
  assert.equal(run.head_repository?.full_name, repository);
  assert.equal(run.path, workflow);
  assert.equal(run.event, 'workflow_dispatch');
  assert.equal(run.head_branch, 'main');
  assert.equal(run.head_sha, source, 'Preview controls differ from this main revision');
  assert.equal(run.status, 'completed');
  assert.equal(run.conclusion, 'success');
  const matches = artifacts.filter(item => item.name === `frontend-cleanup-plan-${run.id}-${run.run_attempt}` && !item.expired);
  assert.equal(matches.length, 1, 'Exactly one successful preview artifact is required');
  const artifact = matches[0];
  assert.equal(artifact.workflow_run?.head_sha, source);
  assert.match(artifact.digest ?? '', /^sha256:[a-f0-9]{64}$/);
  assert.ok(Number.isSafeInteger(artifact.id) && artifact.id > 0);
  return artifact.id;
}

async function validateRun() {
  assertApplyEnvironment(process.env);
  const id = process.env.PREVIEW_RUN_ID;
  assert.match(id ?? '', /^[1-9]\d*$/);
  const get = async suffix => {
    const response = await fetch(`https://api.github.com/repos/${repository}/actions/runs/${id}${suffix}`, {
      headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(30000),
    });
    assert.ok(response.ok, `Preview provenance check failed (HTTP ${response.status})`);
    return response.json();
  };
  const [run, listing] = await Promise.all([get(''), get('/artifacts?per_page=100')]);
  assert.ok(listing.total_count <= 100, 'Unexpected preview artifact count');
  assert.equal(String(run.id), id);
  const artifactId = validatePreviewRun(run, listing.artifacts, sourceSHA());
  await appendFile(process.env.GITHUB_OUTPUT, `artifact_id=${artifactId}\n`);
}

async function cloudflareStore() {
  const account = process.env.CLOUDFLARE_ACCOUNT_ID, token = process.env.CLOUDFLARE_API_TOKEN;
  assert.match(account ?? '', /^[a-f0-9]{32}$/, 'Cloudflare account required');
  assert.ok(token, 'Cloudflare API token required');
  const config = JSON.parse(await readFile('wrangler.jsonc', 'utf8'));
  const db = config.d1_databases.find(item => item.binding === 'DB').database_id;
  const query = async (sql, params = []) => {
    const data = await releaseRequest('Cleanup catalog read', `https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${db}/query`, {
      init: { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ sql, params }) },
      retryRead: true,
      read: async response => { assert.ok(response.ok, `Catalog read failed (HTTP ${response.status})`); return response.json(); },
    });
    assert.equal(data.success, true, 'Catalog read rejected');
    assert.equal(data.result[0].success, true, 'Catalog SQL failed');
    return data.result[0].results;
  };
  const sdk = createRequire(new URL('../android/package.json', import.meta.url))('@aws-sdk/client-s3');
  const { deriveR2Credentials } = await import('../android/publish.mjs');
  const client = new sdk.S3Client({
    credentials: await deriveR2Credentials(account, token), region: 'auto', endpoint: `https://${account}.r2.cloudflarestorage.com`,
    requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED',
    maxAttempts: 1,
  });
  const send = (command, retryRead = false) => releaseOperation('R2 cleanup operation',
    signal => client.send(command, { abortSignal: signal }), { retryRead, timeoutMs: 60000 });
  return {
    async catalog() {
      // The revision is read before and after all related rows; mixed snapshots fail closed.
      const sql = 'SELECT stable,beta,revision FROM release_channels WHERE id=1';
      const channels = (await query(sql))[0];
      assert.ok(channels, 'Channels not initialized');
      const releases = await query('SELECT build_id,manifest_digest,contract,ready FROM frontend_releases WHERE build_id IN (?,?) ORDER BY build_id', [channels.stable, channels.beta]);
      const proof = (await query('SELECT report_digest FROM release_compatibility WHERE candidate=? AND stable=?', [channels.beta, channels.stable]))[0] ?? null;
      assert.deepEqual((await query(sql))[0], channels, 'Channels changed while reading catalog');
      return { channels, releases, proof };
    },
    async list(cursor) {
      const result = await send(new sdk.ListObjectsV2Command({ Bucket: BUCKET, ContinuationToken: cursor, MaxKeys: 1000 }), true);
      if (result.IsTruncated) assert.ok(result.NextContinuationToken, 'Truncated R2 response without cursor');
      return {
        objects: (result.Contents ?? []).map(item => ({ key: item.Key, bytes: item.Size, etag: item.ETag })),
        cursor: result.IsTruncated ? result.NextContinuationToken : undefined,
      };
    },
    async get(Key) {
      const object = await readReleaseObject(Key, signal => client.send(new sdk.GetObjectCommand({ Bucket: BUCKET, Key }), { abortSignal: signal }));
      return object ? Buffer.from(await object.arrayBuffer()) : null;
    },
    async deleteBatch(keys) {
      const result = await send(new sdk.DeleteObjectsCommand({ Bucket: BUCKET, Delete: { Objects: keys.map(Key => ({ Key })), Quiet: false } }));
      return { deleted: (result.Deleted ?? []).map(item => item.Key), errors: (result.Errors ?? []).map(item => ({ key: item.Key, code: item.Code })) };
    },
  };
}

async function main() {
  const [mode = 'preview', directory = 'artifacts/frontend-cleanup'] = process.argv.slice(2);
  if (mode === 'validate-run') return validateRun();
  assert.ok(['preview', 'apply'].includes(mode), 'Expected preview or apply');
  if (mode === 'apply') assertApplyEnvironment(process.env);
  const source = sourceSHA();
  // Fail on plan digest before opening production credentials.
  let plan;
  if (mode === 'apply') {
    const bytes = await readFile(path.join(directory, 'plan.json'));
    assert.match(process.env.PLAN_SHA256 ?? '', /^[a-f0-9]{64}$/, 'Reviewed plan SHA256 required');
    assert.equal(digest(bytes), process.env.PLAN_SHA256, 'Reviewed plan digest mismatch');
    plan = JSON.parse(bytes);
  }
  const store = await cloudflareStore();
  await mkdir(directory, { recursive: true });
  if (mode === 'preview') {
    plan = await previewCleanup(store, source);
    const bytes = JSON.stringify(plan, null, 2) + '\n';
    const report = cleanupReport(plan) + `\nplan.json SHA256: ${digest(bytes)}\n`;
    await writeFile(path.join(directory, 'plan.json'), bytes, { flag: 'wx' });
    await writeFile(path.join(directory, 'report.md'), report);
    console.log(report);
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, report);
  } else {
    const journal = state => writeFile(path.join(directory, 'apply-result.json'), JSON.stringify(state, null, 2) + '\n');
    await applyCleanup(store, plan, { source, journal });
    console.log('Reviewed historical objects removed; both current releases verified.');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(`Frontend cleanup stopped: ${error.message}`); process.exitCode = 1; });
}
