import { describe, expect, it } from 'vitest';
import { readFile, mkdtemp, mkdir, copyFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { digest, inventory, previewCleanup, applyCleanup, cleanupReport, BUCKET } from './frontend-cleanup.mjs';
import { approvedBuilds, cutoff, snapshotProtected, switches } from './frontend-cleanup-609.mjs';
import { readAdmissionAudit } from './frontend-cleanup-audit.mjs';
import { assertApplyEnvironment, readCleanupCatalog, validatePreviewRun } from './frontend-cleanup-cli.mjs';

const stable = 'a'.repeat(40), beta = 'b'.repeat(40), other = 'c'.repeat(40), source = 'd'.repeat(40);
const [old, history, previous, recent, unverified] = approvedBuilds;
const earlier = cutoff - 1000;
function fixture({ same = false, oldCount = 2 } = {}) {
  const data = new Map(), metadata = new Map(), modified = new Map();
  const put = (key, body) => data.set(key, Buffer.from(body));
  const manifests = new Map();
  const releases = [];
  for (const id of [stable, beta, history, previous]) {
    const files = Object.fromEntries(['index.html', 'sw.js', 'build.json', 'shell-manifest.json', 'manifest.webmanifest', 'assets/player.js'].map(file => {
      const body = Buffer.from(`${id}/${file}`);
      put(`releases/${id}/${file}`, body);
      return [file, { sha256: digest(body), bytes: body.length, contentType: 'text/plain' }];
    }));
    const manifest = { buildId: id, contract: 'same-page-storage-v15-sync-v1', files, storageDigest: digest('storage'), probeDigest: digest('probe') };
    manifests.set(id, manifest);
    for (const file of ['sealed.json', 'claim.json']) put(`releases/${id}/${file}`, JSON.stringify(manifest));
    put(`releases/${id}/storage.json`, 'storage');
    put(`releases/${id}/storage-probe.js`, 'probe');
    releases.push({ build_id: id, ready: 1, contract: manifest.contract, manifest_digest: digest(JSON.stringify(manifest)), published_at: earlier });
  }
  const proof = JSON.stringify({ version: 1, passed: true, stable, candidate: beta, stableProbe: digest('probe'), candidateProbe: digest('probe'), engines: ['chromium', 'webkit'] });
  if (!same) put(`compatibility/${beta}/${stable}.json`, proof);
  put('legacy/assets/old.js', 'shared');
  put(`legacy-claims/${old}.json`, 'audit');
  put(`compatibility/${old}/${stable}.json`, 'audit');
  put('unrecognized/file', 'unknown');
  put('releases/malformed/file', 'unknown');
  put(`releases/${old}/../malformed.js`, 'unknown');
  put(`releases/${other}/index.html`, 'not approved');
  put(`releases/${recent}/index.html`, 'recent');
  put(`releases/${unverified}/index.html`, 'unconfirmed');
  modified.set(`releases/${recent}/index.html`, cutoff);
  for (const id of [old, recent]) releases.push({
    build_id: id, ready: 1, contract: releases[0].contract, manifest_digest: digest(id), published_at: earlier,
  });
  for (let i = 0; i < oldCount; i++) put(`releases/${old}/${i}.js`, 'old');
  const catalog = {
    channels: { stable, beta: same ? stable : beta, revision: 96 },
    releases, proof: same ? null : { report_digest: digest(proof) },
    promotions: [{ previous_stable: history, expected_beta: stable, expected_revision: 75 }],
    audit: { barriers: [{ admittedAt: cutoff - 500 }], recent: [{ build: beta }, { build: previous }], eligible: [...approvedBuilds] },
  };
  const batches = [];
  const store = {
    async catalog() { return structuredClone(catalog); },
    async get(key) { const body = data.get(key); return body ? { body, sha256: metadata.has(key) ? metadata.get(key) : digest(body) } : null; },
    async list(cursor) {
      const objects = [...data].sort(([a], [b]) => a.localeCompare(b, 'en')).map(([key, bytes]) => ({ key, bytes: bytes.length, etag: digest(bytes), lastModified: modified.get(key) ?? earlier }));
      const offset = Number(cursor ?? 0), limit = 7;
      return { objects: objects.slice(offset, offset + limit), cursor: offset + limit < objects.length ? String(offset + limit) : undefined };
    },
    async deleteBatch(keys) { batches.push(keys); keys.forEach(key => data.delete(key)); return { deleted: keys, errors: [] }; },
  };
  return { store, data, put, catalog, batches, manifests, metadata, modified };
}

describe('one-off frontend release cleanup', () => {
  it('paginates the entire inventory, previews exact historical objects and preserves current/shared/audit resources', async () => {
    const f = fixture(), plan = await previewCleanup(f.store, source);
    expect(plan.bucket).toBe(BUCKET);
    expect(plan.objects).toHaveLength(f.data.size);
    expect(plan.objects.filter(item => item.disposition === 'delete').map(item => item.key)).toEqual([`releases/${old}/0.js`, `releases/${old}/1.js`]);
    expect(plan.objects.find(item => item.key === 'legacy/assets/old.js').disposition).toBe('review');
    expect(f.batches).toEqual([]);
    expect(cleanupReport(plan)).toContain('2 objects / 6 bytes');
  });
  it('supports identical stable/beta without requiring a self-proof', async () => {
    const f = fixture({ same: true });
    const plan = await previewCleanup(f.store, source);
    expect(plan.verify).toEqual([stable, beta, history, previous].sort());
    await applyCleanup(f.store, plan, { source });
    expect(f.data.has(`releases/${stable}/sw.js`)).toBe(true);
  });
  it('deletes batches and verifies both current releases after cleanup', async () => {
    const f = fixture({ oldCount: 1001 }), plan = await previewCleanup(f.store, source), journal = [];
    const result = await applyCleanup(f.store, plan, { source, journal: async value => journal.push(structuredClone(value)) });
    expect(f.batches.map(batch => batch.length)).toEqual([500, 500, 1]);
    expect(result.deleted).toHaveLength(1001);
    expect(journal.at(-1).complete).toBe(true);
    expect([...f.data.keys()].filter(key => key.startsWith(`releases/${old}/`))).toEqual([`releases/${old}/../malformed.js`]);
    expect(f.data.has('legacy/assets/old.js')).toBe(true);
  });
  it.each(['sw.js', 'storage.json', 'storage-probe.js', 'claim.json', 'sealed.json'])('refuses corrupted protected %s before deleting', async file => {
    const f = fixture(), plan = await previewCleanup(f.store, source);
    f.put(`releases/${stable}/${file}`, 'corrupt');
    await expect(applyCleanup(f.store, plan, { source })).rejects.toThrow();
    expect(f.batches).toHaveLength(0);
    await expect(previewCleanup(f.store, source)).rejects.toThrow();
  });
  it.each([undefined, 'incorrect'])('rejects intact bytes with missing or wrong serving metadata: %s', async value => {
    const f = fixture(), plan = await previewCleanup(f.store, source);
    f.metadata.set(`releases/${stable}/sw.js`, value);
    await expect(previewCleanup(f.store, source)).rejects.toThrow('serving metadata mismatch');
    await expect(applyCleanup(f.store, plan, { source })).rejects.toThrow('serving metadata mismatch');
    expect(f.batches).toHaveLength(0);
  });
  it('refuses missing/current incompatible proof and unready catalog entries', async () => {
    const f = fixture();
    f.catalog.proof = null;
    await expect(previewCleanup(f.store, source)).rejects.toThrow('proof missing');
    f.catalog.releases[0].ready = 0;
    await expect(previewCleanup(f.store, source)).rejects.toThrow('not ready');
  });
  it.each(['added', 'replaced', 'rewritten', 'retained missing', 'channels'])('stops on changed production state: %s', async change => {
    const f = fixture(), plan = await previewCleanup(f.store, source);
    if (change === 'added') f.put(`releases/${old}/new.js`, 'new');
    if (change === 'replaced') f.put(`releases/${old}/0.js`, 'replacement');
    if (change === 'rewritten') f.modified.set(`releases/${old}/0.js`, cutoff);
    if (change === 'retained missing') f.data.delete('legacy/assets/old.js');
    if (change === 'channels') f.catalog.channels.revision++;
    await expect(applyCleanup(f.store, plan, { source })).rejects.toThrow();
    expect(f.batches).toHaveLength(0);
  });
  it('rechecks channel revision before each delete batch', async () => {
    const f = fixture({ oldCount: 501 }), plan = await previewCleanup(f.store, source);
    const deleteBatch = f.store.deleteBatch;
    f.store.deleteBatch = async keys => { const result = await deleteBatch(keys); f.catalog.channels.revision++; return result; };
    await expect(applyCleanup(f.store, plan, { source })).rejects.toThrow('Channels/catalog changed');
    expect(f.batches).toHaveLength(1);
    expect(f.data.has(`releases/${old}/99.js`)).toBe(true);
  });
  it('records partial deletion errors, stops, and safely resumes the same reviewed plan', async () => {
    const f = fixture(), plan = await previewCleanup(f.store, source), journal = [];
    const deleteBatch = f.store.deleteBatch;
    f.store.deleteBatch = async keys => {
      await deleteBatch(keys.slice(0, 1));
      return { deleted: keys.slice(0, 1), errors: [{ key: keys[1], code: 'AccessDenied' }] };
    };
    await expect(applyCleanup(f.store, plan, { source, journal: async state => journal.push(structuredClone(state)) })).rejects.toThrow('Partial R2 deletion');
    expect(journal.at(-1).lastBatch.errors[0].code).toBe('AccessDenied');
    f.store.deleteBatch = deleteBatch;
    expect((await applyCleanup(f.store, plan, { source })).complete).toBe(true);
  });
  it('can resume after a lost successful deletion response', async () => {
    const f = fixture(), plan = await previewCleanup(f.store, source), original = f.store.deleteBatch;
    f.store.deleteBatch = async keys => { await original(keys); throw new Error('connection lost'); };
    await expect(applyCleanup(f.store, plan, { source })).rejects.toThrow('connection lost');
    f.store.deleteBatch = original;
    expect((await applyCleanup(f.store, plan, { source })).complete).toBe(true);
  });
  it.each(['bucket', 'source', 'classification', 'keep'])('rejects tampered plan %s', async change => {
    const f = fixture(), plan = await previewCleanup(f.store, source);
    if (change === 'bucket') plan.bucket = 'same-page-production-scores';
    if (change === 'source') plan.source = old;
    if (change === 'classification') plan.objects.find(item => item.disposition === 'keep').disposition = 'delete';
    if (change === 'keep') plan.keep = [old];
    await expect(applyCleanup(f.store, plan, { source })).rejects.toThrow();
    expect(f.batches).toHaveLength(0);
  });
  it('keeps every promotion endpoint, previous Beta, recent write and off-list version through apply', async () => {
    const f = fixture();
    const missingStable = snapshotProtected[1];
    f.catalog.promotions.unshift({ previous_stable: missingStable, expected_beta: history, expected_revision: 71 });
    const plan = await previewCleanup(f.store, source);
    expect(plan.missingHistory).toEqual([missingStable]);
    expect(plan.decisions.find(entry => entry.build === recent).reason).toBe('recent-or-unknown-write');
    expect(plan.decisions.find(entry => entry.build === unverified).reason).toBe('release-unverified');
    await applyCleanup(f.store, plan, { source });
    expect(f.batches.flat()).toEqual([`releases/${old}/0.js`, `releases/${old}/1.js`]);
    for (const id of [stable, beta, history, previous, other, recent, unverified]) {
      expect(f.data.has(`releases/${id}/index.html`)).toBe(true);
    }
  });
  it('stops when candidate objects exceed the approved snapshot totals', async () => {
    const f = fixture(), list = f.store.list;
    f.store.list = async cursor => {
      const result = await list(cursor);
      for (const object of result.objects) {
        if (object.key === `releases/${old}/0.js`) object.bytes = 2_428_556_714;
      }
      return result;
    };
    await expect(previewCleanup(f.store, source)).rejects.toThrow('Candidate inventory exceeds');
  });
  it('preserves a candidate with no readmission proof even when its registration is old', async () => {
    const f = fixture();
    f.catalog.audit.eligible = f.catalog.audit.eligible.filter(id => id !== old);
    const plan = await previewCleanup(f.store, source);
    expect(plan.decisions.find(entry => entry.build === old).reason).toBe('readmission-not-excluded');
    await applyCleanup(f.store, plan, { source });
    expect(f.batches).toEqual([]);
  });
  it('stops the next batch on Stable promotion even if inventory and current Beta stay unchanged', async () => {
    const f = fixture({ oldCount: 501 }), plan = await previewCleanup(f.store, source);
    const deleteBatch = f.store.deleteBatch;
    f.store.deleteBatch = async keys => {
      const result = await deleteBatch(keys);
      f.catalog.promotions.push({ previous_stable: stable, expected_beta: beta, expected_revision: 96 });
      f.catalog.channels = { stable: beta, beta, revision: 97 };
      return result;
    };
    await expect(applyCleanup(f.store, plan, { source })).rejects.toThrow('Channels/catalog changed');
    expect(f.batches).toHaveLength(1);
  });
  it('stops on an unrecognized live Beta or an incomplete Stable chain', async () => {
    const f = fixture();
    f.catalog.channels.beta = unverified;
    await expect(previewCleanup(f.store, source)).rejects.toThrow('Current Beta does not match');
    f.catalog.channels.beta = beta;
    f.catalog.promotions.unshift({ previous_stable: other, expected_beta: unverified, expected_revision: 70 });
    await expect(previewCleanup(f.store, source)).rejects.toThrow('Stable promotion chain is incomplete');
  });
  it('reads both promotion endpoints and the exact eligible registrations from D1 schema', async () => {
    const db = new DatabaseSync(':memory:');
    try {
      db.exec('CREATE TABLE user(id TEXT PRIMARY KEY); CREATE TABLE session(id TEXT, user_id TEXT, expires_at INTEGER); CREATE TABLE user_lifecycle(user_id TEXT)');
      db.exec(await readFile(new URL('../migrations/0034_release_channels.sql', import.meta.url), 'utf8'));
      const f = fixture();
      for (const row of f.catalog.releases) {
        db.prepare('INSERT INTO frontend_releases VALUES (?,?,?,?,?)').run(row.build_id, row.manifest_digest, row.contract, earlier, row.ready);
      }
      db.prepare('INSERT INTO release_channels VALUES (1,?,?,95)').run(history, stable);
      db.prepare('INSERT INTO release_compatibility VALUES (?,?,?,?,?)').run(stable, history, digest('test'), digest('test'), digest('proof'));
      db.exec("INSERT INTO user VALUES ('operator'); INSERT INTO release_operators VALUES ('operator'); INSERT INTO session VALUES ('session','operator',99)");
      db.prepare('INSERT INTO release_promotions VALUES (?,?,?,?,?,?,?)').run('id', 'operator', 'session', stable, 95, history, 1);
      const result = await readCleanupCatalog((sql, params = []) => db.prepare(sql).all(...params).map(row => ({ ...row })),
        async () => f.catalog.audit, approvedBuilds);
      expect(result.promotions).toEqual([{ previous_stable: history, expected_beta: stable, expected_revision: 95 }]);
      expect(result.releases.map(row => row.build_id)).toEqual(expect.arrayContaining([history, stable, previous, old]));
    } finally { db.close(); }
  });
  it('fails closed on listing failures, duplicate keys and repeated cursors', async () => {
    const f = fixture();
    f.store.list = async () => { throw new Error('page unavailable'); };
    await expect(inventory(f.store)).rejects.toThrow('page unavailable');
    f.store.list = async () => ({ objects: [{ key: 'x', bytes: 1, etag: 'x', lastModified: earlier }], cursor: 'same' });
    await expect(inventory(f.store)).rejects.toThrow('Duplicate');
    f.store.list = async () => ({ objects: [], cursor: 'same' });
    await expect(inventory(f.store)).rejects.toThrow('did not advance');
  });
  it('rejects unsafe sealed file paths even when the catalog digest matches', async () => {
    const f = fixture(), manifest = f.manifests.get(stable);
    manifest.files['../escape'] = { bytes: 1, sha256: digest('x') };
    const bytes = JSON.stringify(manifest);
    f.put(`releases/${stable}/sealed.json`, bytes);
    f.catalog.releases[0].manifest_digest = digest(bytes);
    await expect(previewCleanup(f.store, source)).rejects.toThrow();
  });
});

const run = { id: 12, run_attempt: 2, repository: { full_name: 'clydian/same-page' }, head_repository: { full_name: 'clydian/same-page' }, path: '.github/workflows/frontend-cleanup.yml', event: 'workflow_dispatch', head_branch: 'main', head_sha: source, status: 'completed', conclusion: 'success' };
const artifact = { id: 45, name: 'frontend-cleanup-plan-12-2', expired: false, workflow_run: { head_sha: source }, digest: `sha256:${'f'.repeat(64)}` };
describe('manual cleanup workflow provenance', () => {
  it('accepts only the exact successful main preview attempt', () => {
    expect(validatePreviewRun(run, [artifact], source)).toBe(45);
    for (const change of [{ event: 'pull_request' }, { head_branch: 'other' }, { head_sha: old }, { conclusion: 'failure' }, { path: '.github/workflows/ci.yml' }, { run_attempt: 3 }, { head_repository: { full_name: 'fork/same-page' } }]) {
      expect(() => validatePreviewRun({ ...run, ...change }, [artifact], source)).toThrow();
    }
    expect(() => validatePreviewRun(run, [{ ...artifact, expired: true }], source)).toThrow();
  });
  it('rejects local apply and untrusted refs/workflows', () => {
    const env = { GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'clydian/same-page', GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/main', GITHUB_WORKFLOW_REF: 'clydian/same-page/.github/workflows/frontend-cleanup.yml@refs/heads/main' };
    expect(() => assertApplyEnvironment(env)).not.toThrow();
    for (const key of Object.keys(env)) expect(() => assertApplyEnvironment({ ...env, [key]: 'wrong' })).toThrow();
  });
  it('boots provenance validation before dependencies exist on a clean runner', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'cleanup-bootstrap-'));
    try {
      await mkdir(path.join(root, 'scripts'));
      for (const file of ['frontend-cleanup-cli.mjs', 'release-request.mjs']) {
        await copyFile(new URL(file, import.meta.url), path.join(root, 'scripts', file));
      }
      const result = spawnSync(process.execPath, ['scripts/frontend-cleanup-cli.mjs', 'validate-run'], { cwd: root, encoding: 'utf8', env: {} });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('Apply must run in the manual production workflow');
      expect(result.stderr).not.toContain('ERR_MODULE_NOT_FOUND');
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it('has no automatic trigger and shares the production deployment lock', async () => {
    const workflow = await readFile(new URL('../.github/workflows/frontend-cleanup.yml', import.meta.url), 'utf8');
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).not.toMatch(/^  (?:push|schedule|pull_request):/m);
    expect(workflow).toContain('group: same-page-production');
    expect(workflow).toContain('default: preview');
    expect(workflow).toContain('environment: production');
    expect(workflow).toContain('digest-mismatch: error');
    expect(workflow).toContain('deployments: read');
    expect(workflow).toContain('fetch-depth: 0');
  });
});

describe('#609 admission audit', () => {
  const repository = 'clydian/same-page';
  const first = { id: switches[0].deployment, build: switches[0].build, run: '11', time: cutoff - 4000 };
  const second = { id: switches[1].deployment, build: switches[1].build, run: '12', time: cutoff - 2000 };

  function releaseAudit(records, { betaConclusion = {}, headBranch = 'main', ledgerEntries = records } = {}) {
    const iso = time => new Date(time).toISOString();
    const get = async path => {
      if (path.startsWith('/deployments?')) return ledgerEntries.map(({ id, build, run, time }) => ({
        id, sha: build, ref: build, environment: 'production-release', production_environment: true, created_at: iso(time),
        payload: { artifact: `release-${build}`, runId: run },
      }));
      const { id, build, run, time } = records.find(item => path.includes(`/runs/${item.run}`));
      if (!path.includes('/jobs?')) return {
        id: Number(run), head_sha: build, head_branch: headBranch, event: 'push',
        repository: { full_name: repository }, head_repository: { full_name: repository }, path: '.github/workflows/ci.yml',
      };
      const job = shift => ({
        name: 'deploy', run_id: Number(run), run_attempt: shift ? 1 : 2, head_sha: build,
        steps: [
          { name: 'Admit release under production lock', started_at: iso(time + shift - 1), completed_at: iso(time + shift + 1) },
          { name: 'Admit verified frontend to beta', status: 'completed', conclusion: betaConclusion[id] ?? 'success', completed_at: iso(time + shift + 2) },
        ],
      });
      return { total_count: 2, jobs: [job(-30), job(0)] };
    };
    return readAdmissionAudit(get, repository, (ancestor, descendant) => ancestor !== descendant && ancestor !== unverified);
  }

  it('ties the switches to the correct attempts and excludes a formerly admitted SHA if recorded again', async () => {
    const again = { id: 13, build: old, run: '13', time: cutoff + 1000 };
    const audit = await releaseAudit([again, second, first], { betaConclusion: { 13: 'skipped' } });
    expect(audit.barriers.map(entry => entry.attempt)).toEqual([2, 2]);
    expect(audit.recent.map(entry => entry.build)).toEqual([second.build, first.build]);
    expect(audit.eligible).toContain(history);
    expect(audit.eligible).not.toContain(old);
    expect(audit.eligible).not.toContain(unverified);
  });

  it('stops when the oldest switch, trusted workflow, or recent admission result is uncertain', async () => {
    await expect(releaseAudit([second, first], { ledgerEntries: [second] })).rejects.toThrow('Incomplete production release ledger');
    await expect(releaseAudit([second, first], { headBranch: 'other' })).rejects.toThrow();
    const ambiguous = { id: 13, build: old, run: '13', time: cutoff + 1000 };
    await expect(releaseAudit([ambiguous, second, first], { betaConclusion: { 13: 'failure' } }))
      .rejects.toThrow('may have changed the channel without confirmation');
  });
});
